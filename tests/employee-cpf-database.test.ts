import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const ids = {
  owner: "20000000-0000-4000-8000-000000000001",
  other: "20000000-0000-4000-8000-000000000002",
  alfa: "20000000-0000-4000-8000-000000000003",
  beta: "20000000-0000-4000-8000-000000000004",
  external: "20000000-0000-4000-8000-000000000005",
  ana: "20000000-0000-4000-8000-000000000006",
  bia: "20000000-0000-4000-8000-000000000007",
  externalEmployee: "20000000-0000-4000-8000-000000000008",
};

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    alter default privileges in schema public grant all on tables to anon,authenticated;
    grant usage on schema auth,public to authenticated,anon;
    grant execute on function auth.uid() to authenticated,anon;
  `);
  const migrations = (await readdir("supabase/migrations"))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const cpfMigration = migrations.find((file) =>
    file.endsWith("_employee_cpf.sql"),
  );
  assert.ok(cpfMigration);
  for (const file of migrations.filter((file) => file < cpfMigration))
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  await db.query("insert into auth.users values ($1),($2)", [
    ids.owner,
    ids.other,
  ]);
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    ids.owner,
  ]);
  await db.query(
    "insert into public.empresas(id,nome) values($1,'Alfa'),($2,'Beta')",
    [ids.alfa, ids.beta],
  );
  await db.query(
    "insert into public.funcionarios(id,empresa_id,nome,cargo,horario_contratual,carga_semanal_minutos,matricula) values($1,$2,'Ana','Assistente','08:00-12:00;13:00-17:24',2520,'A01'),($3,$4,'Bia','Analista','09:00-15:00',1800,'B01')",
    [ids.ana, ids.alfa, ids.bia, ids.beta],
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    ids.other,
  ]);
  await db.query("insert into public.empresas(id,nome) values($1,'Externa')", [
    ids.external,
  ]);
  await db.query(
    "insert into public.funcionarios(id,empresa_id,nome) values($1,$2,'Outra conta')",
    [ids.externalEmployee, ids.external],
  );
  await db.exec("reset role");
  const legacy = (
    await db.query("select * from public.funcionarios order by id")
  ).rows;
  const logCount = (
    await db.query<{ count: number }>(
      "select count(*)::integer as count from public.log_alteracoes",
    )
  ).rows[0].count;
  await db.exec(await readFile(`supabase/migrations/${cpfMigration}`, "utf8"));
  return { db, legacy, logCount };
}

test("CPF opcional preserva o legado e persiste somente dígitos ou ausência", async () => {
  const { db, legacy, logCount } = await setup();
  try {
    const upgraded = (
      await db.query<{ cpf: string | null }>(
        "select * from public.funcionarios order by id",
      )
    ).rows;
    assert.deepEqual(
      upgraded.map(({ cpf, ...employee }) => {
        assert.equal(cpf, null);
        return employee;
      }),
      legacy,
    );
    assert.equal(
      (
        await db.query<{ count: number }>(
          "select count(*)::integer as count from public.log_alteracoes",
        )
      ).rows[0].count,
      logCount,
    );
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      ids.owner,
    ]);
    await db.query("update public.funcionarios set cpf=$1 where id=$2", [
      "01234567890",
      ids.ana,
    ]);
    const saved = (
      await db.query<{ cpf: string }>(
        "select cpf from public.funcionarios where id=$1",
        [ids.ana],
      )
    ).rows[0];
    assert.equal(saved.cpf, "01234567890");
    for (const invalid of ["", "123", "012.345.678-90", "0123456789x"])
      await assert.rejects(
        db.query("update public.funcionarios set cpf=$1 where id=$2", [
          invalid,
          ids.ana,
        ]),
        /funcionarios_cpf_formato/i,
      );
    const created = (
      await db.query<{ cpf: string | null }>(
        "insert into public.funcionarios(empresa_id,nome,cpf) values($1,'Nova com CPF',$2),($1,'Nova sem CPF',null) returning cpf",
        [ids.alfa, "01234567890"],
      )
    ).rows;
    assert.deepEqual(
      created.map((row) => row.cpf),
      ["01234567890", null],
    );
    await db.query("update public.funcionarios set cpf=null where id=$1", [
      ids.ana,
    ]);
    assert.equal(
      (
        await db.query<{ cpf: string | null }>(
          "select cpf from public.funcionarios where id=$1",
          [ids.ana],
        )
      ).rows[0].cpf,
      null,
    );
  } finally {
    await db.close();
  }
});

test("CPF permanece no funcionário e preserva isolamento e vínculos entre contas e empresas", async () => {
  const { db } = await setup();
  try {
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      ids.owner,
    ]);
    await db.query("update public.funcionarios set cpf=$1 where id=$2", [
      "01234567890",
      ids.ana,
    ]);
    await db.query("update public.funcionarios set cpf=$1 where id=$2", [
      "98765432100",
      ids.bia,
    ]);
    assert.deepEqual(
      (
        await db.query<{ id: string; cpf: string }>(
          "select id,cpf from public.funcionarios where empresa_id=$1",
          [ids.beta],
        )
      ).rows,
      [{ id: ids.bia, cpf: "98765432100" }],
    );
    assert.equal(
      (
        await db.query("select cpf from public.funcionarios where id=$1", [
          ids.externalEmployee,
        ])
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query(
          "update public.funcionarios set cpf=$1 where id=$2 returning id",
          ["01234567890", ids.externalEmployee],
        )
      ).rows.length,
      0,
    );
    await assert.rejects(
      db.query("update public.funcionarios set empresa_id=$1 where id=$2", [
        ids.beta,
        ids.ana,
      ]),
      /Transferência exige fluxo próprio/i,
    );
    await assert.rejects(
      db.query(
        "insert into public.funcionarios(empresa_id,nome,cpf) values($1,'Vínculo indevido',$2)",
        [ids.external, "01234567890"],
      ),
      /Empresa indisponível|foreign key|row-level security/i,
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      ids.other,
    ]);
    assert.equal(
      (
        await db.query("select cpf from public.funcionarios where id=$1", [
          ids.ana,
        ])
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query(
          "update public.funcionarios set cpf=$1 where id=$2 returning id",
          ["98765432100", ids.ana],
        )
      ).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});
