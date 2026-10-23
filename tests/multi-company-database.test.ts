import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const ids = {
  owner: "10000000-0000-4000-8000-000000000001",
  other: "10000000-0000-4000-8000-000000000002",
  alfa: "10000000-0000-4000-8000-000000000003",
  beta: "10000000-0000-4000-8000-000000000004",
  ana: "10000000-0000-4000-8000-000000000005",
  bia: "10000000-0000-4000-8000-000000000006",
  globalModel: "10000000-0000-4000-8000-000000000007",
  alfaModel: "10000000-0000-4000-8000-000000000008",
  betaModel: "10000000-0000-4000-8000-000000000009",
  schedule: "10000000-0000-4000-8000-000000000010",
  betaSchedule: "10000000-0000-4000-8000-000000000011",
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
  // Start with actual pre-upgrade rows, not fixtures already using the new schema.
  for (const file of migrations.filter(
    (file) => !file.endsWith("_company_administration.sql"),
  ))
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  await db.query("insert into auth.users values ($1),($2)", [
    ids.owner,
    ids.other,
  ]);
  await db.exec(
    `set role authenticated; select set_config('request.jwt.claim.sub','${ids.owner}',false)`,
  );
  await db.query(
    "insert into public.empresas(id,nome,cnpj,cidade,uf) values ($1,'Alfa','11222333000181','Recife','PE'),($2,'Beta','04252011000110','Natal','RN')",
    [ids.alfa, ids.beta],
  );
  await db.query(
    "insert into public.funcionarios(id,empresa_id,nome,carga_semanal_minutos) values($1,$2,'Ana',1800),($3,$4,'Bia',2400)",
    [ids.ana, ids.alfa, ids.bia, ids.beta],
  );
  await db.query(
    "insert into public.modelos_jornada(id,empresa_id,nome,tipo) values($1,null,'Referência comum','5x2'),($2,$3,'Modelo Alfa','personalizado'),($4,$5,'Modelo Beta','6x1')",
    [ids.globalModel, ids.alfaModel, ids.alfa, ids.betaModel, ids.beta],
  );
  await db.query("select public.salvar_escalas($1::jsonb)", [
    JSON.stringify([
      {
        id: ids.schedule,
        empresa_id: ids.alfa,
        funcionario_id: ids.ana,
        modelo_id: ids.alfaModel,
        mes: "2026-12-01",
        nome_funcionario: "Ana",
        dias: [
          {
            data: "2026-12-01",
            intervalos: [{ start: "08:00", end: "12:00" }],
            folga: false,
            feriado: null,
            observacao: "Original",
          },
        ],
      },
    ]),
  ]);
  await db.exec("reset role");
  for (const file of migrations.filter((file) =>
    file.endsWith("_company_administration.sql"),
  ))
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  await db.exec("set role authenticated");
  return db;
}

test("migração multiempresa preserva legado e permite completar identificação depois", async () => {
  const db = await setup();
  try {
    const companies = await db.query<{
      id: string;
      nome: string;
      situacao: string;
      nome_fantasia: string;
    }>(
      "select id,nome,situacao,nome_fantasia from public.empresas order by nome",
    );
    assert.equal(companies.rows.length, 2);
    assert.deepEqual(
      companies.rows.map((row) => [row.nome, row.situacao, row.nome_fantasia]),
      [
        ["Alfa", "ativa", ""],
        ["Beta", "ativa", ""],
      ],
    );
    assert.equal(
      (await db.query("select * from public.funcionarios")).rows.length,
      2,
    );
    assert.equal(
      (await db.query("select * from public.escalas")).rows.length,
      1,
    );
    assert.equal(
      (
        await db.query<{ observacao: string }>(
          "select observacao from public.escala_dias",
        )
      ).rows[0].observacao,
      "Original",
    );
    assert.ok(
      (
        await db.query<{ empresa_id: string | null }>(
          "select empresa_id from public.log_alteracoes",
        )
      ).rows.every((row) => row.empresa_id === null),
    );
    const legacyDates = (
      await db.query<{ created_at: string | null; updated_at: string | null }>(
        "select created_at,updated_at from public.funcionarios where id=$1",
        [ids.ana],
      )
    ).rows[0];
    assert.equal(legacyDates.created_at, null);
    assert.equal(legacyDates.updated_at, null);
    await db.exec(
      "insert into public.empresas(nome) values('Cadastro mínimo 1'),('Cadastro mínimo 2')",
    );
    assert.equal(
      (
        await db.query(
          "select id from public.empresas where cnpj='' and uf='' and cidade=''",
        )
      ).rows.length,
      2,
    );
    await assert.rejects(
      db.exec(
        "insert into public.empresas(nome,cnpj) values('Duplicada','11222333000181')",
      ),
      /duplicate key/i,
    );
    await assert.rejects(
      db.exec(
        "insert into public.empresas(nome,cep) values('CEP inválido','12')",
      ),
      /check constraint/i,
    );
  } finally {
    await db.close();
  }
});

test("padrões individuais persistem e não aceitam modelos de outra empresa do mesmo escritório", async () => {
  const db = await setup();
  try {
    await db.query(
      "update public.empresas set modelo_padrao_id=$1,carga_semanal_padrao_minutos=2520 where id=$2",
      [ids.globalModel, ids.alfa],
    );
    await db.query(
      "update public.funcionarios set modelo_padrao_id=$1,matricula='A01',setor='DP',admissao='2025-01-02',carga_diaria_minutos=360,regras_especiais='Rever CCT' where id=$2",
      [ids.alfaModel, ids.ana],
    );
    await db.query(
      "update public.empresas set modelo_padrao_id=$1 where id=$2",
      [ids.alfaModel, ids.alfa],
    );
    const ana = (
      await db.query<{
        modelo_padrao_id: string;
        carga_semanal_minutos: number;
        matricula: string;
        setor: string;
      }>(
        "select modelo_padrao_id,carga_semanal_minutos,matricula,setor from public.funcionarios where id=$1",
        [ids.ana],
      )
    ).rows[0];
    assert.equal(ana.modelo_padrao_id, ids.alfaModel);
    assert.equal(ana.carga_semanal_minutos, 1800);
    assert.equal(ana.matricula, "A01");
    assert.equal(ana.setor, "DP");
    const beta = (
      await db.query<{
        modelo_padrao_id: string | null;
        carga_semanal_minutos: number;
      }>(
        "select modelo_padrao_id,carga_semanal_minutos from public.funcionarios where id=$1",
        [ids.bia],
      )
    ).rows[0];
    assert.equal(beta.modelo_padrao_id, null);
    assert.equal(beta.carga_semanal_minutos, 2400);
    await assert.rejects(
      db.query(
        "update public.funcionarios set modelo_padrao_id=$1 where id=$2",
        [ids.betaModel, ids.ana],
      ),
      /Modelo indisponível/i,
    );
    await assert.rejects(
      db.query("update public.empresas set modelo_padrao_id=$1 where id=$2", [
        ids.betaModel,
        ids.alfa,
      ]),
      /Modelo indisponível/i,
    );
    await assert.rejects(
      db.query("update public.escalas set modelo_id=$1 where id=$2", [
        ids.betaModel,
        ids.schedule,
      ]),
      /Modelo indisponível/i,
    );
    await assert.rejects(
      db.query("update public.funcionarios set empresa_id=$1 where id=$2", [
        ids.beta,
        ids.ana,
      ]),
      /Transferência exige fluxo/i,
    );
    await assert.rejects(
      db.query("update public.modelos_jornada set empresa_id=$1 where id=$2", [
        ids.beta,
        ids.globalModel,
      ]),
      /escopo do modelo é imutável/i,
    );
    await db.query(
      "insert into public.escalas(id,empresa_id,funcionario_id,mes,nome_funcionario) values($1,$2,$3,'2026-12-01','Bia')",
      [ids.betaSchedule, ids.beta, ids.bia],
    );
    await assert.rejects(
      db.query(
        "update public.escala_dias set escala_id=$1 where escala_id=$2",
        [ids.betaSchedule, ids.schedule],
      ),
      /escala do dia não pode ser reatribuída/i,
    );
    await assert.rejects(
      db.query(
        "update public.escalas set empresa_id=$1,funcionario_id=$2 where id=$3",
        [ids.beta, ids.bia, ids.schedule],
      ),
      /não podem ser reatribuídos/i,
    );
    assert.equal(
      (
        await db.query<{ modelo_id: string }>(
          "select modelo_id from public.escalas where id=$1",
          [ids.schedule],
        )
      ).rows[0].modelo_id,
      ids.alfaModel,
    );
  } finally {
    await db.close();
  }
});

test("arquivamento preserva histórico e bloqueia operações diretas até reativação", async () => {
  const db = await setup();
  try {
    await db.query(
      "update public.empresas set situacao='arquivada' where id=$1",
      [ids.alfa],
    );
    assert.equal(
      (
        await db.query(
          "select * from public.funcionarios where empresa_id=$1",
          [ids.alfa],
        )
      ).rows.length,
      1,
    );
    assert.equal(
      (await db.query("select * from public.escala_dias")).rows.length,
      1,
    );
    await assert.rejects(
      db.query(
        "insert into public.funcionarios(empresa_id,nome) values($1,'Nova')",
        [ids.alfa],
      ),
      /inativa ou arquivada/i,
    );
    await assert.rejects(
      db.query("update public.funcionarios set cargo='Alterado' where id=$1", [
        ids.ana,
      ]),
      /inativa ou arquivada/i,
    );
    await assert.rejects(
      db.query(
        "insert into public.modelos_jornada(empresa_id,nome,tipo) values($1,'Novo','5x2')",
        [ids.alfa],
      ),
      /inativa ou arquivada/i,
    );
    await assert.rejects(
      db.query("update public.escalas set modelo_nome='Alterada' where id=$1", [
        ids.schedule,
      ]),
      /inativa ou arquivada/i,
    );
    await assert.rejects(
      db.exec("update public.escala_dias set observacao='Alterada'"),
      /inativa ou arquivada/i,
    );
    await assert.rejects(
      db.exec("delete from public.escala_dias"),
      /inativa ou arquivada/i,
    );
    await assert.rejects(
      db.query("delete from public.escalas where id=$1", [ids.schedule]),
      /permission denied/i,
    );
    await assert.rejects(
      db.query("delete from public.empresas where id=$1", [ids.alfa]),
      /permission denied/i,
    );
    await assert.rejects(
      db.query("delete from public.funcionarios where id=$1", [ids.ana]),
      /permission denied/i,
    );
    // Beta remains operational, proving archive isn't an account-wide flag.
    await db.query(
      "update public.funcionarios set cargo='Analista Beta' where id=$1",
      [ids.bia],
    );
    await db.query("update public.empresas set situacao='ativa' where id=$1", [
      ids.alfa,
    ]);
    await db.query(
      "update public.funcionarios set cargo='Analista Alfa' where id=$1",
      [ids.ana],
    );
    assert.equal(
      (
        await db.query<{ cargo: string }>(
          "select cargo from public.funcionarios where id=$1",
          [ids.ana],
        )
      ).rows[0].cargo,
      "Analista Alfa",
    );
    await db.query(
      "update public.funcionarios set situacao='inativo' where id=$1",
      [ids.ana],
    );
    await assert.rejects(
      db.query(
        "update public.escalas set modelo_nome='Nova revisão' where id=$1",
        [ids.schedule],
      ),
      /vínculo inativo/i,
    );
  } finally {
    await db.close();
  }
});

test("RLS e FKs bloqueiam IDs externos e histórico tem contexto, autor e antes/depois", async () => {
  const db = await setup();
  try {
    await db.query(
      "update public.funcionarios set cargo='Cargo novo' where id=$1",
      [ids.ana],
    );
    const log = (
      await db.query<{
        empresa_id: string;
        ator_id: string;
        antes: { cargo: string };
        depois: { cargo: string };
        campos: string[];
      }>(
        "select empresa_id,ator_id,antes,depois,campos from public.log_alteracoes where registro_id=$1 and acao='UPDATE' order by alterado_em desc limit 1",
        [ids.ana],
      )
    ).rows[0];
    assert.equal(log.empresa_id, ids.alfa);
    assert.equal(log.ator_id, ids.owner);
    assert.equal(log.antes.cargo, "");
    assert.equal(log.depois.cargo, "Cargo novo");
    assert.ok(log.campos.includes("cargo"));
    await assert.rejects(
      db.exec("delete from public.log_alteracoes"),
      /permission denied/i,
    );
    await assert.rejects(
      db.exec("select public.auditar_alteracao()"),
      /permission denied/i,
    );
    await db.exec(
      `select set_config('request.jwt.claim.sub','${ids.other}',false)`,
    );
    assert.equal(
      (await db.query("select * from public.empresas")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from public.funcionarios")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from public.log_alteracoes")).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query(
          "update public.empresas set situacao='ativa' where id=$1 returning id",
          [ids.alfa],
        )
      ).rows.length,
      0,
    );
    await assert.rejects(
      db.query(
        "insert into public.funcionarios(empresa_id,nome) values($1,'Intrusa')",
        [ids.alfa],
      ),
      /indisponível|permissão/i,
    );
    await db.exec(
      "insert into public.empresas(nome) values('Empresa autorizada B')",
    );
    const own = (
      await db.query<{ id: string }>("select id from public.empresas")
    ).rows[0].id;
    await assert.rejects(
      db.query(
        "insert into public.funcionarios(empresa_id,nome,modelo_padrao_id) values($1,'Intrusa',$2)",
        [own, ids.alfaModel],
      ),
      /Modelo indisponível/i,
    );
    await db.exec("reset role; set role anon");
    await assert.rejects(
      db.exec("select * from public.empresas"),
      /permission denied/i,
    );
    await assert.rejects(
      db.query("select public.verificar_modelo_empresa($1,$2,$3)", [
        ids.globalModel,
        ids.alfa,
        ids.owner,
      ]),
      /permission denied/i,
    );
    // Existing server-side account cleanup is not broken by the operational guards.
    await db.exec(`reset role; delete from auth.users where id='${ids.owner}'`);
    assert.equal(
      (
        await db.query("select * from public.empresas where user_id=$1", [
          ids.owner,
        ])
      ).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});
