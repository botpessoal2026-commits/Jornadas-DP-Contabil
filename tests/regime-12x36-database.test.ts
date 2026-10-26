import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const ids = {
  owner: "40000000-0000-4000-8000-000000000001",
  other: "40000000-0000-4000-8000-000000000002",
  alfa: "40000000-0000-4000-8000-000000000003",
  beta: "40000000-0000-4000-8000-000000000004",
};
const effectiveDate = "2026-10-01";
const common = { limite_diario_minutos: 504, limite_semanal_minutos: 2520 };
const special = {
  tipo_regime: "12x36",
  plantao_maximo_minutos: 720,
  descanso_minimo_minutos: 2160,
  intervalo_tratamento: "usufruido",
  intervalo_minimo_minutos: 60,
  alternancia_horas: 48,
  fundamento_tipo: "acordo_individual",
  fundamento_referencia: "Acordo escrito arquivado no vínculo da funcionária",
  comprovado: true,
};

async function asUser(db: PGlite, userId: string) {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    userId,
  ]);
}

async function insertRule(
  db: PGlite,
  value: Record<string, unknown>,
  companyId: string | null = null,
  key = "regime",
) {
  return db.query<{ id: string }>(
    `insert into public.parametros_legais
      (empresa_id,nome,chave,valor,inicio_vigencia,fonte)
     values($1,'Parâmetro de teste',$2,$3::jsonb,$4,'Documento cadastrado')
     returning id`,
    [companyId, key, JSON.stringify(value), effectiveDate],
  );
}

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    alter default privileges in schema public grant all on tables to anon,authenticated;
    grant usage on schema auth,public to authenticated,anon;
    grant execute on function auth.uid() to authenticated,anon;
  `);
  const migrations = (await readdir("supabase/migrations"))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const target = migrations.find((file) =>
    file.endsWith("_regime_12x36_scope.sql"),
  );
  assert.ok(target);
  for (const file of migrations.filter((file) => file < target))
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  await db.query("insert into auth.users values($1),($2)", [
    ids.owner,
    ids.other,
  ]);
  await asUser(db, ids.owner);
  await db.query(
    "insert into public.empresas(id,nome) values($1,'Alfa'),($2,'Beta')",
    [ids.alfa, ids.beta],
  );
  const legacyId = (await insertRule(db, common)).rows[0].id;
  const legacy = (
    await db.query<{ registro: Record<string, unknown> }>(
      "select to_jsonb(t) registro from public.parametros_legais t where id=$1",
      [legacyId],
    )
  ).rows[0].registro;
  await db.exec("reset role");
  for (const file of migrations.filter((file) => file >= target))
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  await asUser(db, ids.owner);
  return { db, legacyId, legacy };
}

test("regimes comum e 12x36 coexistem na mesma vigência por empresa sem alterar regras antigas", async () => {
  const { db, legacyId, legacy } = await setup();
  try {
    assert.deepEqual(
      (
        await db.query<{ registro: Record<string, unknown> }>(
          "select to_jsonb(t) registro from public.parametros_legais t where id=$1",
          [legacyId],
        )
      ).rows[0].registro,
      legacy,
    );
    await insertRule(db, special);
    for (const companyId of [ids.alfa, ids.beta]) {
      await insertRule(db, { ...common, tipo_regime: "comum" }, companyId);
      await insertRule(db, special, companyId);
      await assert.rejects(insertRule(db, special, companyId), {
        code: "23505",
      });
      for (const value of [common, { ...common, tipo_regime: "desconhecido" }])
        await assert.rejects(insertRule(db, value, companyId), {
          code: "23505",
        });
    }
    for (const value of [
      common,
      { ...common, tipo_regime: "comum" },
      { ...common, tipo_regime: "desconhecido" },
    ])
      await assert.rejects(insertRule(db, value), { code: "23505" });
    await assert.rejects(insertRule(db, special), { code: "23505" });
    await insertRule(db, { minutos: 660 }, null, "interjornada");
    await assert.rejects(
      insertRule(
        db,
        { minutos: 2160, tipo_regime: "12x36" },
        null,
        "interjornada",
      ),
      { code: "23505" },
    );
    await asUser(db, ids.other);
    await insertRule(db, common);
    await insertRule(db, special);
    assert.equal(
      (await db.query("select id from public.parametros_legais")).rows.length,
      2,
    );
  } finally {
    await db.close();
  }
});

test("RPC conserva os dados jurídicos do 12x36 e rejeita acesso e alteração de outro contexto", async () => {
  const { db, legacyId, legacy } = await setup();
  const payload = (value: Record<string, unknown>) => ({
    nome: "12×36 com acordo individual escrito",
    chave: "regime",
    valor: value,
    inicio_vigencia: effectiveDate,
    fonte: "CLT, art. 59-A; instrumento individual cadastrado",
    observacao: "Conferência documental registrada pelo usuário",
    confirmado: true,
  });
  const save = async (
    companyId: string,
    value: Record<string, unknown>,
    rowId: string | null = null,
  ) =>
    (
      await db.query<{ id: string }>(
        "select public.salvar_registro_empresa($1,'parametros_legais',$2::jsonb,$3) id",
        [companyId, JSON.stringify(value), rowId],
      )
    ).rows[0].id;
  try {
    await save(ids.alfa, payload(common));
    const ruleId = await save(ids.alfa, payload(special));
    await save(ids.beta, payload(special));
    const updated = {
      ...special,
      fundamento_tipo: "act",
      fundamento_referencia: "ACT 2026, cláusula 12",
    };
    await save(ids.alfa, { valor: updated }, ruleId);
    const row = (
      await db.query<{
        valor: typeof updated;
        empresa_id: string;
        confirmado: boolean;
      }>(
        "select valor,empresa_id,confirmado from public.parametros_legais where id=$1",
        [ruleId],
      )
    ).rows[0];
    assert.deepEqual(row.valor, updated);
    assert.equal(row.empresa_id, ids.alfa);
    assert.equal(row.confirmado, true);
    await assert.rejects(
      save(ids.beta, { valor: special }, ruleId),
      /Registro indisponível para esta empresa/,
    );
    await assert.rejects(
      save(ids.alfa, { ...payload(special), empresa_id: ids.beta }),
      /empresa|contexto/i,
    );
    await asUser(db, ids.other);
    assert.equal(
      (
        await db.query("select id from public.parametros_legais where id=$1", [
          ruleId,
        ])
      ).rows.length,
      0,
    );
    await assert.rejects(
      save(ids.alfa, payload(special)),
      /empresa|permissão/i,
    );
    await db.exec("set role anon");
    await assert.rejects(
      save(ids.alfa, payload(special)),
      /permission denied/i,
    );
    await asUser(db, ids.owner);
    assert.deepEqual(
      (
        await db.query<{ registro: Record<string, unknown> }>(
          "select to_jsonb(t) registro from public.parametros_legais t where id=$1",
          [legacyId],
        )
      ).rows[0].registro,
      legacy,
    );
  } finally {
    await db.close();
  }
});
