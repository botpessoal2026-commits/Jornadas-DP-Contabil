import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  automaticTeamRotation,
  teamGenerationPayload,
  applyTeamGenerationLocally,
} from "../src/lib/team-planning";
import {
  teamFixture,
  teamIds as ids,
  selectedTeam,
  normalTeamSchedule,
} from "./fixtures/team-data";

test("ativação incremental e lote misto são atômicos, preservam dados, RLS e escalas aprovadas", async () => {
  const db = new PGlite(),
    data = teamFixture();
  try {
    await db.exec(
      `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;alter default privileges in schema public grant all on tables to authenticated,anon;`,
    );
    for (const file of (await readdir("supabase/migrations"))
      .filter((name) => name.endsWith(".sql") && name < "202611180001_")
      .sort())
      await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
    await db.query("insert into auth.users values($1),($2)", [
      ids.owner,
      ids.other,
    ]);
    await db.exec(
      `set role authenticated;select set_config('request.jwt.claim.sub','${ids.owner}',false)`,
    );
    await db.query(
      "insert into public.empresas(id,nome,cct) values($1,'Empresa existente','CCT a conferir'),($2,'Outra empresa','')",
      [ids.company, ids.second],
    );
    for (const model of data.models)
      await db.query(
        "insert into public.modelos_jornada(id,empresa_id,nome,tipo,padrao,ciclo_inicio,turno) values($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb)",
        [
          model.id,
          model.empresa_id,
          model.nome,
          model.tipo,
          JSON.stringify(model.padrao),
          model.ciclo_inicio,
          JSON.stringify(model.turno),
        ],
      );
    await db.query(
      "insert into public.modelos_jornada(id,empresa_id,nome,tipo,padrao) values($1,$2,'Modelo de outra empresa','5x2','{}')",
      [ids.foreignModel, ids.second],
    );
    for (const employee of data.employees)
      await db.query(
        "insert into public.funcionarios(id,empresa_id,nome,modelo_padrao_id,situacao) values($1,$2,$3,$4,$5)",
        [
          employee.id,
          employee.empresa_id,
          employee.nome,
          employee.modelo_padrao_id,
          employee.situacao ?? "ativo",
        ],
      );
    const before = (
      await db.query<{ value: unknown }>(
        "select to_jsonb(t) value from public.empresas t where id=$1",
        [ids.company],
      )
    ).rows[0].value;
    const logCount = (await db.query("select * from public.log_alteracoes"))
      .rows.length;
    await db.exec("reset role");
    const activation = await readFile(
      "supabase/setup/ativar-planejamento-equipe.sql",
      "utf8",
    );
    await db.exec(activation);
    assert.deepEqual(
      (
        await db.query<{ value: unknown }>(
          "select to_jsonb(t)-'horario_funcionamento' value from public.empresas t where id=$1",
          [ids.company],
        )
      ).rows[0].value,
      before,
    );
    assert.equal(
      (await db.query("select * from public.log_alteracoes")).rows.length,
      logCount,
    );
    await db.exec("set role authenticated");
    const plan = automaticTeamRotation(
        data,
        ids.company,
        "2027-01",
        selectedTeam,
        "2027-01-01",
      ),
      normal = normalTeamSchedule(data),
      schedules = [...plan.schedules, normal],
      payload = teamGenerationPayload(schedules, plan);
    const call = (body = payload) =>
      db.query(
        "select public.salvar_planejamento_equipe($1,$2::jsonb,$3::jsonb)",
        [
          body.p_empresa,
          JSON.stringify(body.itens),
          JSON.stringify(body.p_revezamento),
        ],
      );
    const count = async (table: "modelos_jornada" | "escalas") =>
      (
        await db.query<{ n: number }>(
          `select count(*)::int n from public.${table}`,
        )
      ).rows[0].n;
    const failLate = structuredClone(payload);
    failLate.itens[2].modelo_id = ids.foreignModel;
    await assert.rejects(call(failLate), /modelo|Modelo|empresa/);
    assert.equal(await count("modelos_jornada"), 3);
    assert.equal(await count("escalas"), 0);
    assert.equal(
      (
        await db.query<{ id: string }>(
          "select modelo_padrao_id id from public.funcionarios where id=$1",
          [ids.employee],
        )
      ).rows[0].id,
      ids.model,
    );
    assert.equal(
      (await db.query("select * from public.log_alteracoes")).rows.length,
      logCount,
    );
    const duplicated = structuredClone(payload);
    duplicated.itens[2].funcionario_id = ids.employee;
    await assert.rejects(call(duplicated), /repetidos/);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      ids.other,
    ]);
    await assert.rejects(call(), /permissão|indisponível/);
    assert.equal(await count("escalas"), 0);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      ids.owner,
    ]);
    await call();
    assert.equal(await count("escalas"), 3);
    assert.equal(await count("modelos_jornada"), 5);
    assert.equal(
      (
        await db.query<{ id: string }>(
          "select modelo_padrao_id id from public.funcionarios where id=$1",
          [ids.normal],
        )
      ).rows[0].id,
      ids.normalModel,
    );
    const saved = applyTeamGenerationLocally(data, schedules, plan);
    const actual = (
      await db.query<{ id: string; funcionario_id: string; revisao: number }>(
        "select id,funcionario_id,revisao from public.escalas",
      )
    ).rows;
    for (const schedule of saved.schedules) {
      const row = actual.find(
        (item) => item.funcionario_id === schedule.funcionario_id,
      )!;
      schedule.id = row.id;
      schedule.revisao = row.revisao;
    }
    const next = automaticTeamRotation(
        saved,
        ids.company,
        "2027-01",
        selectedTeam,
        "2027-01-02",
      ),
      nextPayload = teamGenerationPayload(
        [...next.schedules, normalTeamSchedule(saved)],
        next,
      );
    const current = actual.find((item) => item.funcionario_id === ids.normal)!;
    const review = JSON.stringify({
      conferida: true,
      impedimentos: 0,
      fontes_pendentes: 0,
      politica_validacao: "3-niveis-v1",
      atencoes: 0,
      informativos: 0,
      atencoes_conferidas: true,
    });
    await db.query(
      "select public.alterar_status_escala($1,$2,'em_revisao',$3,'Revisão de teste',$4::jsonb)",
      [ids.company, current.id, current.revisao, review],
    );
    let revision = (
      await db.query<{ revisao: number }>(
        "select revisao from public.escalas where id=$1",
        [current.id],
      )
    ).rows[0].revisao;
    await db.query(
      "select public.alterar_status_escala($1,$2,'aprovada',$3,'Revisão de teste',$4::jsonb)",
      [ids.company, current.id, revision, review],
    );
    revision = (
      await db.query<{ revisao: number }>(
        "select revisao from public.escalas where id=$1",
        [current.id],
      )
    ).rows[0].revisao;
    nextPayload.itens.find(
      (item) => item.funcionario_id === ids.normal,
    )!.revisao_esperada = revision;
    await assert.rejects(call(nextPayload), /bloqueada/);
    assert.equal(await count("modelos_jornada"), 5);
    assert.equal(
      (
        await db.query<{ id: string }>(
          "select modelo_padrao_id id from public.funcionarios where id=$1",
          [ids.employee],
        )
      ).rows[0].id,
      plan.assignments[0].modelId,
    );
    await db.exec("reset role");
    await db.exec(activation);
    assert.equal(await count("escalas"), 3);
    assert.equal(
      (
        await db.query<{ prosecdef: boolean }>(
          "select prosecdef from pg_proc where oid='public.salvar_planejamento_equipe(uuid,jsonb,jsonb)'::regprocedure",
        )
      ).rows[0].prosecdef,
      false,
    );
    await db.exec("set role anon");
    await assert.rejects(call(), /permission denied/);
  } finally {
    await db.close();
  }
});
