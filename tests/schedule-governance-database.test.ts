import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const ids = {
  owner: "60000000-0000-4000-8000-000000000001",
  other: "60000000-0000-4000-8000-000000000002",
  company: "60000000-0000-4000-8000-000000000003",
  second: "60000000-0000-4000-8000-000000000004",
  employee: "60000000-0000-4000-8000-000000000005",
  colleague: "60000000-0000-4000-8000-000000000006",
  foreign: "60000000-0000-4000-8000-000000000007",
};
const day = {
  data: "2026-12-01",
  intervalos: [{ start: "08:00", end: "12:00" }],
  folga: false,
  feriado: null,
  observacao: "Base original",
};
const item = (changes: Record<string, unknown> = {}) => ({
  empresa_id: ids.company,
  funcionario_id: ids.employee,
  modelo_id: null,
  mes: "2026-12-01",
  nome_funcionario: "Pessoa Alfa",
  dias: [day],
  ...changes,
});
async function user(db: PGlite, id = ids.owner) {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
}
const threeLevelMigration = "20261029123937_three_level_review_attestation.sql";
const legacyAttestation = {
  conferida: true,
  impedimentos: 0,
  fontes_pendentes: 0,
};
const currentAttestation = {
  ...legacyAttestation,
  politica_validacao: "3-niveis-v1",
  atencoes: 0,
  informativos: 0,
  atencoes_conferidas: true,
};
async function setup(beforeThreeLevels = false) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    alter default privileges in schema public grant all on tables to anon,authenticated;
    grant usage on schema auth,public to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`);
  for (const file of (await readdir("supabase/migrations"))
    .filter(
      (name) =>
        name.endsWith(".sql") &&
        (!beforeThreeLevels || name < threeLevelMigration),
    )
    .sort())
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  await db.query("insert into auth.users values($1),($2)", [
    ids.owner,
    ids.other,
  ]);
  await user(db);
  await db.query(
    "insert into public.empresas(id,nome,cidade,uf) values($1,'Alfa','Recife','PE'),($2,'Beta','Petrolina','PE')",
    [ids.company, ids.second],
  );
  await db.query(
    "insert into public.funcionarios(id,empresa_id,nome) values($1,$2,'Pessoa Alfa'),($3,$2,'Colega Alfa'),($4,$5,'Pessoa Beta')",
    [ids.employee, ids.company, ids.colleague, ids.foreign, ids.second],
  );
  return db;
}
const save = (db: PGlite, items: Record<string, unknown>[]) =>
  db.query("select public.salvar_escalas_empresa($1,$2::jsonb)", [
    ids.company,
    JSON.stringify(items),
  ]);
async function current(db: PGlite) {
  return (
    await db.query<{ id: string; revisao: number; status: string }>(
      "select id,revisao,status from public.escalas where funcionario_id=$1 order by mes",
      [ids.employee],
    )
  ).rows[0];
}
async function transition(
  db: PGlite,
  status: string,
  reason = "Conferência do responsável",
  attestation: Record<string, unknown> = currentAttestation,
) {
  const row = await current(db);
  await db.query(
    "select public.alterar_status_escala($1,$2,$3,$4,$5,$6::jsonb)",
    [
      ids.company,
      row.id,
      status,
      row.revisao,
      reason,
      JSON.stringify(attestation),
    ],
  );
}

test("atestação dos três níveis exige conferência e justificativa no banco, sem bloquear informativos", async () => {
  const db = await setup();
  try {
    await save(db, [item()]);
    await transition(db, "em_revisao");
    await assert.rejects(
      transition(
        db,
        "aprovada",
        "Cliente antigo sem política",
        legacyAttestation,
      ),
      /níveis de alerta está incompleta/,
    );
    await assert.rejects(
      db.query(
        "update public.escalas set status='aprovada',conferencia=$1::jsonb where id=$2",
        [JSON.stringify(legacyAttestation), (await current(db)).id],
      ),
      /níveis de alerta está incompleta/,
    );
    const reviewed = {
      conferida: true,
      impedimentos: 0,
      fontes_pendentes: 0,
      politica_validacao: "3-niveis-v1",
      atencoes: 1,
      informativos: 3,
      atencoes_conferidas: true,
    };
    await assert.rejects(
      transition(db, "aprovada", "Curta", reviewed),
      /justificativa/,
    );
    await assert.rejects(
      db.query(
        "update public.escalas set status='aprovada',ultima_justificativa=null,conferencia=$1::jsonb where id=$2",
        [JSON.stringify(reviewed), (await current(db)).id],
      ),
      /justificativa/,
    );
    await assert.rejects(
      transition(db, "aprovada", "Conferência registrada", {
        ...reviewed,
        atencoes_conferidas: false,
      }),
      /alertas de atenção/,
    );
    await assert.rejects(
      transition(db, "aprovada", "Conferência registrada", {
        ...reviewed,
        atencoes: 0.5,
      }),
      /Contagem/,
    );
    await assert.rejects(
      transition(db, "aprovada", "Conferência registrada", {
        ...reviewed,
        informativos: "3",
      }),
      /incompleta/,
    );
    await transition(
      db,
      "aprovada",
      "Exceção conferida com documento",
      reviewed,
    );
    // Even a direct status UPDATE cannot drop the new attestation policy.
    await assert.rejects(
      transition(db, "publicada", "Tentativa sem política", legacyAttestation),
      /incompleta/,
    );
    await transition(
      db,
      "publicada",
      "Versão conferida para publicação",
      reviewed,
    );
    await transition(
      db,
      "rascunho",
      "Reabertura para novo planejamento",
      reviewed,
    );
    await transition(db, "em_revisao");
    await transition(db, "aprovada", "", {
      ...reviewed,
      atencoes: 0,
      informativos: 4,
    });
    assert.equal((await current(db)).status, "aprovada");
  } finally {
    await db.close();
  }
});

test("aprovação histórica permanece publicável, mas reaprovação após migração exige nova política", async () => {
  const db = await setup(true);
  try {
    await save(db, [item()]);
    await transition(db, "em_revisao", "", legacyAttestation);
    await transition(
      db,
      "aprovada",
      "Aprovação anterior à atualização",
      legacyAttestation,
    );
    await db.exec("reset role");
    await db.exec(
      await readFile(`supabase/migrations/${threeLevelMigration}`, "utf8"),
    );
    await user(db);
    const before = (
      await db.query<{ conferencia: unknown }>(
        "select conferencia from public.escalas",
      )
    ).rows[0].conferencia;
    assert.deepEqual(before, legacyAttestation);
    await transition(
      db,
      "publicada",
      "Publicação de aprovação histórica",
      legacyAttestation,
    );
    await transition(
      db,
      "fechada",
      "Fechamento de aprovação histórica",
      legacyAttestation,
    );
    assert.deepEqual(
      (
        await db.query<{ conferencia: unknown }>(
          "select conferencia from public.escalas",
        )
      ).rows[0].conferencia,
      legacyAttestation,
    );
    await transition(
      db,
      "rascunho",
      "Reabertura para nova aprovação",
      legacyAttestation,
    );
    await transition(db, "em_revisao", "", legacyAttestation);
    await assert.rejects(
      transition(
        db,
        "aprovada",
        "Tentativa de política antiga",
        legacyAttestation,
      ),
      /incompleta/,
    );
    await transition(db, "aprovada");
    assert.equal((await current(db)).status, "aprovada");
  } finally {
    await db.close();
  }
});

test("gravação compara revisão, detecta corrida de criação e mantém lote atômico", async () => {
  const db = await setup();
  try {
    await save(db, [item({ revisao_esperada: null })]);
    const before = await current(db);
    await save(db, [
      item({
        id: before.id,
        revisao_esperada: before.revisao,
        dias: [{ ...day, observacao: "Primeira edição" }],
      }),
    ]);
    const after = await current(db);
    assert.ok(Number(after.revisao) > Number(before.revisao));
    await assert.rejects(
      save(db, [item({ id: before.id, revisao_esperada: before.revisao })]),
      /outra sessão/,
    );
    await assert.rejects(
      save(db, [item({ revisao_esperada: null })]),
      /Já existe/,
    );
    await assert.rejects(
      db.query("select public.salvar_escalas($1::jsonb)", [
        JSON.stringify([item({ revisao_esperada: null })]),
      ]),
      /Já existe/,
    );
    await assert.rejects(
      save(db, [
        item({ id: after.id, revisao_esperada: String(after.revisao) }),
      ]),
      /Revisão esperada inválida/,
    );
    await assert.rejects(
      save(db, [
        item({
          mes: "2027-01-01",
          dias: [{ ...day, data: "2027-01-01" }],
          revisao_esperada: null,
        }),
        item({ id: before.id, revisao_esperada: before.revisao }),
      ]),
      /outra sessão/,
    );
    assert.equal(
      (await db.query("select id from public.escalas")).rows.length,
      1,
    );
    assert.equal(
      (
        await db.query<{ observacao: string }>(
          "select observacao from public.escala_dias",
        )
      ).rows[0].observacao,
      "Primeira edição",
    );
  } finally {
    await db.close();
  }
});
test("fluxo exige conferência, bloqueia edições diretas e congela versões server-side imutáveis", async () => {
  const db = await setup();
  try {
    await save(db, [item()]);
    await assert.rejects(transition(db, "publicada"), /ordem/);
    await transition(db, "em_revisao");
    await assert.rejects(
      transition(db, "aprovada", "", {
        ...currentAttestation,
        impedimentos: 1,
        fontes_pendentes: 0,
      }),
      /conferência/,
    );
    await assert.rejects(
      transition(db, "aprovada", "", {
        ...currentAttestation,
        impedimentos: 0,
        fontes_pendentes: 1,
      }),
      /conferência/,
    );
    await transition(db, "aprovada");
    await assert.rejects(
      db.exec("update public.escala_dias set observacao='Mudança direta'"),
      /bloqueada/,
    );
    await assert.rejects(save(db, [item()]), /bloqueada/);
    await db.query(
      "update public.escalas set status='publicada',conferido_por=$1,conferido_em='2000-01-01' where id=$2",
      [ids.other, (await current(db)).id],
    );
    const actor = (
      await db.query<{ conferido_por: string; conferido_em: string }>(
        "select conferido_por,conferido_em::text from public.escalas",
      )
    ).rows[0];
    assert.equal(actor.conferido_por, ids.owner);
    assert.equal(actor.conferido_em.startsWith("2000-01-01"), false);
    const versions = await db.query<{
      id: string;
      snapshot: {
        data: {
          companies: { nome: string }[];
          schedules: { dias: (typeof day)[] }[];
        };
      };
      versao: number;
    }>("select * from public.escala_versoes");
    assert.equal(versions.rows.length, 1);
    assert.equal(versions.rows[0].snapshot.data.companies[0].nome, "Alfa");
    assert.equal(
      versions.rows[0].snapshot.data.schedules[0].dias[0].observacao,
      "Base original",
    );
    await db.query(
      "update public.empresas set nome='Nome futuro' where id=$1",
      [ids.company],
    );
    await assert.rejects(
      db.exec("update public.escala_versoes set snapshot='{}'"),
      /permission denied/,
    );
    await assert.rejects(
      db.exec("delete from public.escala_versoes"),
      /permission denied/,
    );
    await transition(db, "fechada");
    await assert.rejects(transition(db, "rascunho", "Ajuste"), /10 caracteres/);
    await transition(db, "rascunho", "Reabertura autorizada para novo ajuste");
    await transition(db, "em_revisao");
    await transition(db, "aprovada");
    await transition(db, "publicada");
    const frozen = await db.query<{ versao: number; nome: string }>(
      "select versao,snapshot->'data'->'companies'->0->>'nome' nome from public.escala_versoes order by versao",
    );
    assert.deepEqual(frozen.rows, [
      { versao: 1, nome: "Alfa" },
      { versao: 2, nome: "Nome futuro" },
    ]);
    await user(db, ids.other);
    assert.equal(
      (await db.exec("select * from public.escala_versoes"))[0].rows.length,
      0,
    );
    await assert.rejects(
      db.query(
        "select public.alterar_status_escala($1,$2,'rascunho',0,'Tentativa de outra conta','{}')",
        [ids.company, (await current(db))?.id ?? versions.rows[0].id],
      ),
      /indisponível|permissão/,
    );
  } finally {
    await db.close();
  }
});

const operation = (changes: Record<string, unknown> = {}) => ({
  tipo: "ausencia",
  status: "pendente",
  titulo: "Férias programadas",
  funcionario_id: ids.employee,
  data_inicio: "2026-12-01",
  data_fim: "2026-12-03",
  payload: { categoria: "ferias", motivo: "Solicitação do funcionário" },
  ...changes,
});
const saveOperation = (
  db: PGlite,
  value: Record<string, unknown>,
  company = ids.company,
  id: string | null = null,
) =>
  db.query<{ id: string }>(
    "select public.salvar_operacao_empresa($1,$2,$3::jsonb) id",
    [company, id, JSON.stringify(value)],
  );
test("operações validam forma, pessoas/unidades, intervalos, URLs e RLS inclusive em chamadas diretas", async () => {
  const db = await setup();
  try {
    const id = (await saveOperation(db, operation())).rows[0].id;
    await assert.rejects(
      saveOperation(db, operation({ funcionario_id: ids.foreign })),
      /Funcionário/,
    );
    await assert.rejects(
      saveOperation(
        db,
        operation({
          payload: { categoria: "ferias", motivo: "", user_id: ids.other },
        }),
      ),
      /Campo não permitido/,
    );
    await assert.rejects(
      saveOperation(
        db,
        operation({
          tipo: "cobertura",
          funcionario_id: null,
          payload: {
            estabelecimento_id: null,
            setor: "",
            cargo: "",
            inicio: "22:00",
            fim: "06:00",
            minimo: 1,
            dias_semana: [1, 1],
          },
        }),
      ),
      /duplicados/,
    );
    await saveOperation(
      db,
      operation({
        tipo: "cobertura",
        funcionario_id: null,
        payload: {
          estabelecimento_id: null,
          setor: "",
          cargo: "",
          inicio: "22:00",
          fim: "06:00",
          minimo: 1,
          dias_semana: [1, 2],
        },
      }),
    );
    for (const payload of [
      {
        intervalos: Array.from({ length: 13 }, (_, index) => ({
          start: `${String(index).padStart(2, "0")}:00`,
          end: `${String(index).padStart(2, "0")}:15`,
        })),
        origem: "manual",
        observacao: "",
      },
      {
        intervalos: [
          { start: "00:00", end: "18:00" },
          { start: "18:00", end: "12:00", endDay: 1 },
        ],
        origem: "manual",
        observacao: "",
      },
    ]) {
      await assert.rejects(
        saveOperation(
          db,
          operation({ tipo: "realizado", data_fim: "2026-12-01", payload }),
        ),
        /doze|24 horas/,
      );
    }
    await assert.rejects(
      saveOperation(
        db,
        operation({
          tipo: "troca",
          data_fim: "2026-12-04",
          payload: {
            destino_funcionario_id: ids.colleague,
            data_origem: "2026-12-01",
            data_destino: "2026-12-02",
            justificativa: "Troca solicitada",
          },
        }),
      ),
      /Período/,
    );
    await assert.rejects(
      saveOperation(
        db,
        operation({
          tipo: "documento",
          funcionario_id: null,
          payload: {
            fonte: "Fonte",
            referencia: "Referência",
            url: null,
            vigencia_fim: "2026-12-02",
          },
        }),
      ),
      /Vigência/,
    );
    await assert.rejects(
      saveOperation(
        db,
        operation({
          tipo: "documento",
          funcionario_id: null,
          payload: {
            fonte: "Instrumento",
            referencia: "Referência",
            vigencia_fim: null,
            url: "javascript:alert(1)",
          },
        }),
      ),
      /HTTPS/,
    );
    await assert.rejects(
      saveOperation(
        db,
        operation({
          tipo: "realizado",
          data_fim: "2026-12-01",
          payload: {
            intervalos: [{ start: "22:00", end: "06:00", endDay: "1" }],
            origem: "manual",
            observacao: "",
          },
        }),
      ),
      /período/i,
    );
    await saveOperation(
      db,
      operation({
        tipo: "realizado",
        data_fim: "2026-12-01",
        payload: {
          intervalos: [{ start: "22:00", end: "06:00", endDay: 1 }],
          origem: "manual",
          observacao: "Informado pelo operador",
        },
      }),
    );
    await assert.rejects(
      db.query(
        "update public.registros_operacionais set empresa_id=$1 where id=$2",
        [ids.second, id],
      ),
      /imutável|empresa|contexto/i,
    );
    await user(db, ids.other);
    assert.equal(
      (await db.query("select * from public.registros_operacionais")).rows
        .length,
      0,
    );
    await assert.rejects(
      saveOperation(db, operation()),
      /indisponível|permissão/,
    );
    await db.exec("reset role; set role anon");
    await assert.rejects(
      db.exec("select * from public.registros_operacionais"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
test("importação de funcionários é insert-only, transacional e verifica duplicidades no servidor", async () => {
  const db = await setup();
  const importRows = (rows: unknown[]) =>
    db.query<{ ids: string[] }>(
      "select public.importar_funcionarios_empresa($1,$2::jsonb) ids",
      [ids.company, JSON.stringify(rows)],
    );
  try {
    const saved = await importRows([
      {
        nome: "Importada A",
        cpf: "52998224725",
        matricula: "M001",
        cargo: "DP",
      },
    ]);
    assert.equal(saved.rows[0].ids.length, 1);
    await assert.rejects(
      importRows([
        { nome: "Importada B", matricula: "M002" },
        { nome: "Duplicada", matricula: " m001 " },
      ]),
      /Matrícula já/,
    );
    assert.equal(
      (
        await db.query(
          "select id from public.funcionarios where matricula='M002'",
        )
      ).rows.length,
      0,
    );
    await assert.rejects(
      importRows([{ nome: "Duplicada CPF", cpf: "52998224725" }]),
      /CPF já/,
    );
    await assert.rejects(
      importRows([{ nome: "Tentativa de reatribuição", user_id: ids.other }]),
      /Campo não permitido/,
    );
    assert.equal(
      (
        await db.query(
          "select id from public.funcionarios where empresa_id=$1",
          [ids.company],
        )
      ).rows.length,
      3,
    );
  } finally {
    await db.close();
  }
});

test("troca aplica somente os dois dias autorizados e aprova a solicitação no mesmo lote atômico", async () => {
  const db = await setup();
  const secondDay = {
    ...day,
    data: "2026-12-02",
    intervalos: [],
    folga: true,
    observacao: "Descanso original",
  };
  try {
    await save(db, [
      item({
        modelo_nome: "",
        modelo_tipo: "personalizado",
        dias: [day, secondDay],
      }),
      item({
        funcionario_id: ids.colleague,
        nome_funcionario: "Colega Alfa",
        modelo_nome: "",
        modelo_tipo: "personalizado",
        dias: [day, secondDay],
      }),
    ]);
    const rows = await db.query<{
      id: string;
      revisao: number;
      funcionario_id: string;
    }>(
      "select id,revisao,funcionario_id from public.escalas order by funcionario_id",
    );
    const source = rows.rows.find(
      (entry) => entry.funcionario_id === ids.employee,
    )!;
    const destination = rows.rows.find(
      (entry) => entry.funcionario_id === ids.colleague,
    )!;
    const op = (
      await saveOperation(
        db,
        operation({
          tipo: "troca",
          data_fim: "2026-12-02",
          payload: {
            destino_funcionario_id: ids.colleague,
            data_origem: "2026-12-01",
            data_destino: "2026-12-02",
            justificativa: "Troca de turnos solicitada",
          },
        }),
      )
    ).rows[0].id;
    const changes = [
      item({
        id: source.id,
        revisao_esperada: source.revisao,
        modelo_nome: "",
        modelo_tipo: "personalizado",
        dias: [{ ...day, intervalos: [], folga: true }, secondDay],
      }),
      item({
        id: destination.id,
        funcionario_id: ids.colleague,
        nome_funcionario: "Colega Alfa",
        revisao_esperada: destination.revisao,
        modelo_nome: "",
        modelo_tipo: "personalizado",
        dias: [day, { ...secondDay, intervalos: day.intervalos, folga: false }],
      }),
    ];
    const apply = (items: unknown[]) =>
      db.query("select public.aplicar_troca_empresa($1,$2,$3::jsonb)", [
        ids.company,
        op,
        JSON.stringify(items),
      ]);
    const unauthorized = structuredClone(changes);
    unauthorized[0].dias[1].observacao = "Outra data não solicitada";
    await assert.rejects(apply(unauthorized), /fora da solicitação/);
    const stale = structuredClone(changes);
    Object.assign(stale[1], {
      revisao_esperada: Number(destination.revisao) + 1,
    });
    await assert.rejects(apply(stale), /outra sessão/);
    assert.equal(Number((await current(db)).revisao), Number(source.revisao));
    assert.equal(
      (
        await db.query<{ status: string }>(
          "select status from public.registros_operacionais where id=$1",
          [op],
        )
      ).rows[0].status,
      "pendente",
    );
    await apply(changes);
    assert.equal(
      (
        await db.query<{ status: string }>(
          "select status from public.registros_operacionais where id=$1",
          [op],
        )
      ).rows[0].status,
      "aprovado",
    );
    const persisted = await db.query<{
      funcionario_id: string;
      data: string;
      intervalos: unknown[];
    }>(
      "select s.funcionario_id,d.data::text,d.intervalos from public.escalas s join public.escala_dias d on d.escala_id=s.id order by s.funcionario_id,d.data",
    );
    assert.deepEqual(
      persisted.rows.find(
        (entry) =>
          entry.funcionario_id === ids.employee && entry.data === "2026-12-01",
      )?.intervalos,
      [],
    );
    assert.deepEqual(
      persisted.rows.find(
        (entry) =>
          entry.funcionario_id === ids.colleague && entry.data === "2026-12-02",
      )?.intervalos,
      day.intervalos,
    );
    await assert.rejects(apply(changes), /pendente/);
  } finally {
    await db.close();
  }
});
