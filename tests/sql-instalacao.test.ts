import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const owner = "11000000-0000-4000-8000-000000000001",
  other = "11000000-0000-4000-8000-000000000002";
test("SQL único instala tabelas/RLS, aceita nome sem alias, preserva isolamento e recusa sobrescrever banco", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}'::jsonb);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;alter default privileges in schema public grant all on tables to anon,authenticated;`,
    );
    const sql = await readFile(
      "supabase/setup/instalacao-novo-projeto.sql",
      "utf8",
    );
    await db.exec(sql);
    await db.query(
      `insert into auth.users values($1,'mariana@example.invalid','{"nome":"Mariana Costa"}'),($2,'outro@example.invalid','{}')`,
      [owner, other],
    );
    assert.equal(
      (await db.query("select * from public.nomes_login")).rows.length,
      0,
    );
    await db.exec(
      `set role authenticated;select set_config('request.jwt.claim.sub','${owner}',false)`,
    );
    await db.exec(
      `insert into public.empresas(nome,cidade,uf) values('Empresa persistente','Recife','PE')`,
    );
    await db.exec(
      `select set_config('request.jwt.claim.sub','${other}',false)`,
    );
    assert.equal(
      (await db.query("select * from public.empresas")).rows.length,
      0,
    );
    await db.exec("reset role");
    await db.exec(
      await readFile("supabase/setup/verificar-banco-existente.sql", "utf8"),
    );
    await assert.rejects(db.exec(sql), /Banco já contém tabelas/);
    await db.exec("rollback");
    assert.equal(
      (await db.query<{ nome: string }>("select nome from public.empresas"))
        .rows[0].nome,
      "Empresa persistente",
    );
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from supabase_migrations.schema_migrations",
        )
      ).rows[0].n,
      (await readdir("supabase/migrations")).filter((name) =>
        name.endsWith(".sql"),
      ).length,
    );
    await db.exec("set role anon");
    await assert.rejects(
      db.exec("select * from public.empresas"),
      /permission denied/i,
    );
  } finally {
    await db.close();
  }
});
