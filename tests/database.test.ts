import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("migration real: RLS, isolamento entre contas, auditoria e gravação atômica", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; alter default privileges in schema public grant all on tables to anon,authenticated; grant usage on schema auth,public to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`,
    );
    await db.exec(
      await readFile("supabase/migrations/202610220001_schema.sql", "utf8"),
    );
    const u1 = "00000000-0000-4000-8000-000000000001",
      u2 = "00000000-0000-4000-8000-000000000002",
      company = "00000000-0000-4000-8000-000000000003",
      employee = "00000000-0000-4000-8000-000000000004";
    await db.query("insert into auth.users values ($1),($2)", [u1, u2]);
    await db.exec(
      `set role authenticated; select set_config('request.jwt.claim.sub','${u1}',false);`,
    );
    await db.query(
      `insert into public.empresas(id,nome,cnpj,cidade,uf) values($1,'Empresa A','11222333000181','Recife','PE')`,
      [company],
    );
    await db.query(
      `insert into public.funcionarios(id,empresa_id,nome) values($1,$2,'Pessoa A')`,
      [employee, company],
    );
    await db.exec("reset role");
    await db.exec(
      await readFile(
        "supabase/migrations/20261022172216_structured_contract.sql",
        "utf8",
      ),
    );
    await db.exec("set role authenticated");
    const legacy = await db.query<{ carga_semanal_minutos: number | null }>(
      "select carga_semanal_minutos from public.funcionarios where id=$1",
      [employee],
    );
    assert.equal(legacy.rows[0].carga_semanal_minutos, null);
    await db.query(
      "update public.funcionarios set carga_semanal_minutos=1800, horario_contratual='30 h/semana' where id=$1",
      [employee],
    );
    for (const invalid of [0, -1, 10081])
      await assert.rejects(
        db.query(
          "update public.funcionarios set carga_semanal_minutos=$1 where id=$2",
          [invalid, employee],
        ),
        /check constraint/i,
      );
    await assert.rejects(
      db.exec("truncate public.empresas cascade"),
      /permission denied/i,
    );
    let log = await db.query<{ n: number }>(
      "select count(*)::int n from public.log_alteracoes",
    );
    assert.equal(log.rows[0].n, 3);
    await assert.rejects(
      db.exec(
        `insert into public.log_alteracoes(user_id,tabela,registro_id,acao) values('${u1}','empresas','${company}','INSERT')`,
      ),
      /permission denied/i,
    );
    await db.exec(`select set_config('request.jwt.claim.sub','${u2}',false)`);
    assert.equal(
      (await db.query("select carga_semanal_minutos from public.funcionarios"))
        .rows.length,
      0,
    );
    assert.equal(
      (
        await db.query(
          "update public.funcionarios set carga_semanal_minutos=2520 where id=$1 returning id",
          [employee],
        )
      ).rows.length,
      0,
    );
    const hidden = await db.query("select * from public.empresas");
    assert.equal(hidden.rows.length, 0);
    const changed = await db.query(
      "update public.empresas set nome=$1 where id=$2 returning id",
      ["Ataque", company],
    );
    assert.equal(changed.rows.length, 0);
    await assert.rejects(
      db.query(
        `insert into public.funcionarios(empresa_id,nome) values($1,'Pessoa B')`,
        [company],
      ),
      /foreign key/i,
    );
    await assert.rejects(
      db.query(
        `insert into public.empresas(user_id,nome,cnpj,cidade,uf) values($1,'Empresa B','11222333000181','Recife','PE')`,
        [u1],
      ),
      /row-level security/i,
    );
    await db.exec(`select set_config('request.jwt.claim.sub','${u1}',false)`);
    const persisted = await db.query<{
      carga_semanal_minutos: number;
      horario_contratual: string;
    }>(
      "select carga_semanal_minutos,horario_contratual from public.funcionarios where id=$1",
      [employee],
    );
    assert.equal(persisted.rows[0].carga_semanal_minutos, 1800);
    assert.equal(persisted.rows[0].horario_contratual, "30 h/semana");
    const s = {
      empresa_id: company,
      funcionario_id: employee,
      modelo_id: null,
      mes: "2026-12-01",
      nome_funcionario: "Pessoa A",
      dias: [
        {
          data: "2026-12-01",
          intervalos: [{ start: "08:00", end: "12:00" }],
          folga: false,
          feriado: null,
          observacao: "",
        },
      ],
    };
    await db.query("select public.salvar_escalas($1::jsonb)", [
      JSON.stringify([s]),
    ]);
    const count = await db.query<{ n: number }>(
      "select count(*)::int n from public.escala_dias",
    );
    assert.equal(count.rows[0].n, 1);
    await assert.rejects(
      db.query("select public.salvar_escalas($1::jsonb)", [
        JSON.stringify([
          { ...s, mes: "2027-01-01" },
          { ...s, mes: "2027-02-01", funcionario_id: u2 },
        ]),
      ]),
      /foreign key/i,
    );
    const atomic = await db.query<{ n: number }>(
      "select count(*)::int n from public.escalas",
    );
    assert.equal(atomic.rows[0].n, 1);
    await db.exec("reset role; set role anon;");
    await assert.rejects(
      db.exec("select * from public.empresas"),
      /permission denied/i,
    );
    await db.exec(`reset role; delete from auth.users where id='${u1}'`);
    const removed = await db.query<{ n: number }>(
      "select count(*)::int n from public.empresas",
    );
    assert.equal(removed.rows[0].n, 0);
  } finally {
    await db.close();
  }
});
