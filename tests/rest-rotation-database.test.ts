import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  prepareRestRotation,
  rotationPayload,
  applyRotationLocally,
} from "../src/lib/rest-rotation";
import {
  rotationFixture,
  rotationIds as ids,
  rotationSelection as selection,
} from "./fixtures/rotation-data";

test("RPC de revezamento é atômico, respeita RLS, concorrência e proteção de escalas", async () => {
  const db = new PGlite(),
    data = rotationFixture();
  try {
    await db.exec(
      `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;alter default privileges in schema public grant all on tables to authenticated,anon;`,
    );
    for (const file of (await readdir("supabase/migrations"))
      .filter((name) => name.endsWith(".sql"))
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
      "insert into public.empresas(id,nome) values($1,'Empresa Revezamento'),($2,'Outra empresa')",
      [ids.company, ids.second],
    );
    await db.query(
      "insert into public.modelos_jornada(id,empresa_id,nome,tipo,padrao,ciclo_inicio,turno) values($1,$2,$3,'12x36','{}','2027-01-01',$4::jsonb)",
      [
        ids.model,
        ids.company,
        data.models[0].nome,
        JSON.stringify(data.models[0].turno),
      ],
    );
    for (const employee of data.employees)
      await db.query(
        "insert into public.funcionarios(id,empresa_id,nome,modelo_padrao_id) values($1,$2,$3,$4)",
        [
          employee.id,
          employee.empresa_id,
          employee.nome,
          employee.modelo_padrao_id,
        ],
      );
    const plan = prepareRestRotation(
        data,
        ids.company,
        "2027-01",
        "2027-01-01",
        selection,
      ),
      payload = rotationPayload(plan);
    const call = (body = payload) =>
      db.query(
        "select public.salvar_revezamento_12x36($1,$2::date,$3::date,$4::jsonb,$5::jsonb,$6::jsonb)",
        [
          body.p_empresa,
          body.p_mes,
          body.p_referencia,
          JSON.stringify(body.p_modelos),
          JSON.stringify(body.p_vinculos),
          JSON.stringify(body.itens),
        ],
      );
    const counts = async () =>
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from public.modelos_jornada",
        )
      ).rows[0].n;
    const malformed = structuredClone(payload);
    malformed.p_modelos[1].destino.turno = [{ start: "06:00", end: "19:00" }];
    await assert.rejects(call(malformed), /preservar os horários/);
    assert.equal(await counts(), 1);
    const crossed = structuredClone(payload);
    crossed.p_vinculos[1].funcionario_id = ids.foreign;
    crossed.itens[1].funcionario_id = ids.foreign;
    await assert.rejects(call(crossed), /Funcionário indisponível/);
    assert.equal(await counts(), 1);
    const duplicate = structuredClone(payload);
    duplicate.p_vinculos[1].funcionario_id = ids.employee;
    await assert.rejects(call(duplicate), /pessoas diferentes/);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      ids.other,
    ]);
    await assert.rejects(call(), /permissão|indisponível/);
    assert.equal(await counts(), 0);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      ids.owner,
    ]);
    await call();
    assert.equal(await counts(), 3);
    const employees = await db.query<{ id: string; modelo_padrao_id: string }>(
      "select id,modelo_padrao_id from public.funcionarios where empresa_id=$1 order by id",
      [ids.company],
    );
    assert.ok(
      employees.rows.every(
        (employee) =>
          employee.modelo_padrao_id ===
          plan.assignments.find((item) => item.employeeId === employee.id)!
            .modelId,
      ),
    );
    assert.equal(
      (await db.query("select * from public.escalas")).rows.length,
      2,
    );
    assert.equal(
      (
        await db.query(
          "select * from public.log_alteracoes where tabela='funcionarios' and acao='UPDATE'",
        )
      ).rows.length,
      2,
    );
    await assert.rejects(call(), /modelo individual foi alterado/);
    const saved = applyRotationLocally(data, plan);
    const actual = await db.query<{
      id: string;
      funcionario_id: string;
      revisao: number;
    }>("select id,funcionario_id,revisao from public.escalas");
    for (const schedule of saved.schedules) {
      const row = actual.rows.find(
        (item) => item.funcionario_id === schedule.funcionario_id,
      )!;
      schedule.id = row.id;
      schedule.revisao = row.revisao;
    }
    const next = prepareRestRotation(
        saved,
        ids.company,
        "2027-01",
        "2027-01-02",
        selection,
      ),
      nextPayload = rotationPayload(next);
    await db.query(
      "update public.escalas set modelo_nome=modelo_nome||' atualizado' where id=$1",
      [actual.rows[0].id],
    );
    await assert.rejects(call(nextPayload), /outra sessão/);
    assert.equal(await counts(), 3);
    const current = (
      await db.query<{ id: string; revisao: number }>(
        "select id,revisao from public.escalas where id=$1",
        [actual.rows[0].id],
      )
    ).rows[0];
    const attestation = {
      conferida: true,
      impedimentos: 0,
      fontes_pendentes: 0,
      politica_validacao: "3-niveis-v1",
      atencoes: 0,
      informativos: 0,
      atencoes_conferidas: true,
    };
    await db.query(
      "select public.alterar_status_escala($1,$2,'em_revisao',$3,'Conferência de teste',$4::jsonb)",
      [ids.company, current.id, current.revisao, JSON.stringify(attestation)],
    );
    const revised = (
      await db.query<{ revisao: number }>(
        "select revisao from public.escalas where id=$1",
        [current.id],
      )
    ).rows[0].revisao;
    await db.query(
      "select public.alterar_status_escala($1,$2,'aprovada',$3,'Conferência de teste',$4::jsonb)",
      [ids.company, current.id, revised, JSON.stringify(attestation)],
    );
    const approved = (
      await db.query<{ revisao: number }>(
        "select revisao from public.escalas where id=$1",
        [current.id],
      )
    ).rows[0].revisao;
    nextPayload.itens.find((item) => item.id === current.id)!.revisao_esperada =
      approved;
    await assert.rejects(call(nextPayload), /bloqueada/);
    assert.equal(await counts(), 3);
    assert.equal(
      (
        await db.query<{ id: string }>(
          "select modelo_padrao_id id from public.funcionarios where id=$1",
          [ids.employee],
        )
      ).rows[0].id,
      plan.assignments[0].modelId,
    );
    const fn = (
      await db.query<{ prosecdef: boolean }>(
        "select prosecdef from pg_proc where oid='public.salvar_revezamento_12x36(uuid,date,date,jsonb,jsonb,jsonb)'::regprocedure",
      )
    ).rows[0];
    assert.equal(fn.prosecdef, false);
    await db.exec("reset role");
    await db.exec(
      await readFile(
        "supabase/migrations/202611180001_rest_rotation.sql",
        "utf8",
      ),
    );
    assert.equal(await counts(), 3);
    await db.exec("reset role; set role anon");
    await assert.rejects(call(), /permission denied/);
  } finally {
    await db.close();
  }
});
