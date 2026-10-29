import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migration = "20261029193932_internal_trigger_function_privileges.sql";
const owner = "72000000-0000-4000-8000-000000000001";
const company = "72000000-0000-4000-8000-000000000002";
const model = "72000000-0000-4000-8000-000000000003";

async function setup(providerEventTrigger: boolean) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create role service_role bypassrls; create role no_app_grants;
    create schema auth;
    create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    grant usage on schema public,auth to anon,authenticated;
    grant usage on schema public to no_app_grants;
    grant execute on function auth.uid() to anon,authenticated;
    alter default privileges in schema public grant all on tables to anon,authenticated;
    -- Production Supabase grants functions directly too. Revoking PUBLIC alone
    -- cannot remove these grants; the older fixtures did not model them.
    alter default privileges in schema public grant execute on functions to anon,authenticated;
  `);
  if (providerEventTrigger)
    await db.exec(`
      create function public.rls_auto_enable() returns event_trigger
      language plpgsql security definer set search_path='' as $$
      declare command record;
      begin
        for command in select * from pg_catalog.pg_event_trigger_ddl_commands() loop
          if command.object_type='table' and command.schema_name='public' then
            execute format('alter table %s enable row level security',command.object_identity);
          end if;
        end loop;
      end $$;
      create event trigger ensure_rls on ddl_command_end
      when tag in ('CREATE TABLE','CREATE TABLE AS','SELECT INTO')
      execute function public.rls_auto_enable();
    `);
  await db.query("insert into auth.users(id) values($1)", [owner]);
  for (const file of (await readdir("supabase/migrations"))
    .filter((name) => name.endsWith(".sql") && name < migration)
    .sort())
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  return db;
}

async function privileges(db: PGlite, fn: string) {
  return (
    await db.query<{ role: string; allowed: boolean }>(
      `select role,has_function_privilege(role,$1,'EXECUTE') as allowed
       from unnest(array['anon','authenticated','no_app_grants']) as role
       order by role`,
      [fn],
    )
  ).rows;
}

async function definition(db: PGlite, fn: string) {
  return (
    await db.query<{ definition: string }>(
      "select pg_get_functiondef($1::regprocedure) as definition",
      [fn],
    )
  ).rows[0].definition;
}

async function assertAuthenticatedAuditStillWorks(db: PGlite) {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    owner,
  ]);
  await db.query(
    "insert into public.empresas(id,nome,cidade,uf) values($1,'Empresa de teste','Recife','PE')",
    [company],
  );
  await db.query(
    "update public.empresas set nome='Empresa atualizada' where id=$1",
    [company],
  );
  await db.query(
    "insert into public.modelos_jornada(id,empresa_id,nome,tipo) values($1,$2,'Modelo de teste','5x2')",
    [model, company],
  );
  await db.query(
    "update public.modelos_jornada set nome='Modelo atualizado' where id=$1",
    [model],
  );
  await db.query("delete from public.modelos_jornada where id=$1", [model]);
  assert.deepEqual(
    (
      await db.query<{ tabela: string; acao: string; total: number }>(
        `select tabela,acao,count(*)::integer as total from public.log_alteracoes
         where user_id=$1 group by tabela,acao order by tabela,acao`,
        [owner],
      )
    ).rows,
    [
      { tabela: "empresas", acao: "INSERT", total: 1 },
      { tabela: "empresas", acao: "UPDATE", total: 1 },
      { tabela: "modelos_jornada", acao: "DELETE", total: 1 },
      { tabela: "modelos_jornada", acao: "INSERT", total: 1 },
      { tabela: "modelos_jornada", acao: "UPDATE", total: 1 },
    ],
  );
  await db.exec("reset role");
}

for (const providerEventTrigger of [false, true])
  test(`funções internas sem EXECUTE da API mantêm auditoria${providerEventTrigger ? " e event trigger de RLS" : " sem helper do provedor"}`, async () => {
    const db = await setup(providerEventTrigger);
    try {
      const functions = [
        "public.auditar_alteracao()",
        ...(providerEventTrigger ? ["public.rls_auto_enable()"] : []),
      ];
      const definitions = await Promise.all(
        functions.map((fn) => definition(db, fn)),
      );
      for (const fn of functions) {
        const before = await privileges(db, fn);
        assert.equal(before.find((row) => row.role === "anon")?.allowed, true);
        assert.equal(
          before.find((row) => row.role === "authenticated")?.allowed,
          true,
        );
      }
      await db.exec(await readFile(`supabase/migrations/${migration}`, "utf8"));
      for (const [index, fn] of functions.entries()) {
        assert.equal(await definition(db, fn), definitions[index]);
        assert.deepEqual(await privileges(db, fn), [
          { role: "anon", allowed: false },
          { role: "authenticated", allowed: false },
          { role: "no_app_grants", allowed: false },
        ]);
        for (const role of ["anon", "authenticated"]) {
          await db.exec(`set role ${role}`);
          await assert.rejects(db.query(`select ${fn}`), /permission denied/);
          await db.exec("reset role");
        }
      }
      await assertAuthenticatedAuditStillWorks(db);
      if (providerEventTrigger) {
        assert.deepEqual(
          (
            await db.query(
              "select evtenabled from pg_event_trigger where evtname='ensure_rls'",
            )
          ).rows,
          [{ evtenabled: "O" }],
        );
        await db.exec("create table public.rls_probe(id integer)");
        assert.deepEqual(
          (
            await db.query(
              "select relrowsecurity from pg_class where oid='public.rls_probe'::regclass",
            )
          ).rows,
          [{ relrowsecurity: true }],
        );
      } else {
        assert.equal(
          (
            await db.query<{ fn: string | null }>(
              "select to_regprocedure('public.rls_auto_enable()')::text as fn",
            )
          ).rows[0].fn,
          null,
        );
      }
    } finally {
      await db.close();
    }
  });

test("helper de mesmo nome com outro tipo permanece intacto", async () => {
  const db = await setup(false);
  try {
    await db.exec(`
      create function public.rls_auto_enable() returns void
      language plpgsql as $$ begin return; end $$;
    `);
    const fn = "public.rls_auto_enable()";
    const before = await definition(db, fn);
    const grants = await privileges(db, fn);
    await db.exec(await readFile(`supabase/migrations/${migration}`, "utf8"));
    assert.equal(await definition(db, fn), before);
    assert.deepEqual(await privileges(db, fn), grants);
    assert.equal(
      grants.find((row) => row.role === "authenticated")?.allowed,
      true,
    );
    assert.equal(
      (await privileges(db, "public.auditar_alteracao()")).every(
        (row) => !row.allowed,
      ),
      true,
    );
  } finally {
    await db.close();
  }
});
