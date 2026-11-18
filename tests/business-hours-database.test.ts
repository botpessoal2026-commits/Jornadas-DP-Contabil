import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { BusinessHours } from "../src/lib/types";
test("migration de funcionamento preserva registros/RLS e valida gravações por empresa no banco", async () => {
  const db = new PGlite(),
    migration = "202611180002_company_business_hours.sql";
  const owner = "82000000-0000-4000-8000-000000000001",
    other = "82000000-0000-4000-8000-000000000002",
    company = "82000000-0000-4000-8000-000000000003";
  const hours: BusinessHours = {
    semana: Object.fromEntries(
      Array.from({ length: 7 }, (_, day) => [
        String(day),
        [{ start: "07:00", end: "19:00" }],
      ]),
    ),
    minimo_funcionarios: 1,
    feriados: "seguir_semana",
  };
  try {
    await db.exec(
      `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;alter default privileges in schema public grant all on tables to authenticated,anon;`,
    );
    for (const file of (await readdir("supabase/migrations"))
      .filter((name) => name.endsWith(".sql") && name < migration)
      .sort())
      await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
    await db.query("insert into auth.users values($1),($2)", [owner, other]);
    await db.exec(
      `set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false)`,
    );
    await db.query(
      "insert into public.empresas(id,nome) values($1,'Empresa existente')",
      [company],
    );
    const before = (
      await db.query<{ value: unknown }>(
        "select to_jsonb(t) value from public.empresas t",
      )
    ).rows[0].value;
    const logs = (await db.query("select * from public.log_alteracoes")).rows
      .length;
    await db.exec("reset role");
    await db.exec(await readFile(`supabase/migrations/${migration}`, "utf8"));
    assert.deepEqual(
      (
        await db.query<{ value: unknown }>(
          "select to_jsonb(t)-'horario_funcionamento' value from public.empresas t",
        )
      ).rows[0].value,
      before,
    );
    assert.equal(
      (await db.query("select * from public.log_alteracoes")).rows.length,
      logs,
    );
    await db.exec("set role authenticated");
    const save = (value: unknown) =>
      db.query(
        "select public.salvar_registro_empresa($1,'empresas',$2::jsonb,$1)",
        [company, JSON.stringify({ horario_funcionamento: value })],
      );
    await save(hours);
    assert.deepEqual(
      (
        await db.query<{ horario_funcionamento: unknown }>(
          "select horario_funcionamento from public.empresas",
        )
      ).rows[0].horario_funcionamento,
      hours,
    );
    for (const patch of [
      { minimo_funcionarios: 0 },
      { minimo_funcionarios: 2.5 },
      { feriados: "incerto" },
      { origem: "falsa" },
    ])
      await assert.rejects(save({ ...hours, ...patch }));
    const overlap = structuredClone(hours);
    overlap.semana["6"] = [{ start: "22:00", end: "06:00", endDay: 1 }];
    overlap.semana["0"] = [{ start: "05:00", end: "12:00" }];
    await assert.rejects(save(overlap), /sobrepostos/);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      other,
    ]);
    assert.equal(
      (await db.query("select * from public.empresas")).rows.length,
      0,
    );
    await assert.rejects(save(hours), /permissão|indisponível/);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      owner,
    ]);
    assert.equal(
      (
        await db.query(
          "select * from public.log_alteracoes where 'horario_funcionamento'=any(campos)",
        )
      ).rows.length,
      1,
    );
    await save(null);
    await db.exec("reset role");
    await db.exec(await readFile(`supabase/migrations/${migration}`, "utf8"));
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from public.empresas",
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await db.query<{ rls: boolean }>(
          "select relrowsecurity rls from pg_class where oid='public.empresas'::regclass",
        )
      ).rows[0].rls,
      true,
    );
  } finally {
    await db.close();
  }
});
