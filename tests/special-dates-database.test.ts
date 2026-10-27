import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const ids = {
  owner: "50000000-0000-4000-8000-000000000001",
  other: "50000000-0000-4000-8000-000000000002",
  alfa: "50000000-0000-4000-8000-000000000003",
  beta: "50000000-0000-4000-8000-000000000004",
  employee: "50000000-0000-4000-8000-000000000005",
  colleague: "50000000-0000-4000-8000-000000000006",
  foreignEmployee: "50000000-0000-4000-8000-000000000007",
  model: "50000000-0000-4000-8000-000000000008",
  schedule: "50000000-0000-4000-8000-000000000009",
};
const regular = [{ start: "08:00", end: "12:00" }];
const event = (changes: Record<string, unknown> = {}) => ({
  nome: "Recesso administrativo",
  data_inicio: "2026-12-24",
  data_fim: "2026-12-31",
  categoria: "recesso",
  alcance: "empresa",
  funcionario_ids: [],
  recorrencia: "periodo",
  expediente: "sem_expediente",
  intervalos: [],
  observacoes: "Sem efeito automático em remuneração ou compensação",
  ativo: true,
  data_movel: false,
  ...changes,
});
const legacyDay = {
  data: "2026-12-24",
  intervalos: regular,
  folga: false,
  feriado: null,
  observacao: "Edição anterior preservada",
};
const schedule = (days: Record<string, unknown>[]) => ({
  id: ids.schedule,
  empresa_id: ids.alfa,
  funcionario_id: ids.employee,
  modelo_id: ids.model,
  mes: "2026-12-01",
  nome_funcionario: "Funcionária Alfa",
  modelo_nome: "Modelo Alfa",
  modelo_tipo: "5x2",
  dias: days,
});

async function asUser(db: PGlite, userId = ids.owner) {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    userId,
  ]);
}
async function save(
  db: PGlite,
  table: string,
  values: Record<string, unknown>,
  companyId = ids.alfa,
  id: string | null = null,
) {
  return (
    await db.query<{ id: string }>(
      "select public.salvar_registro_empresa($1,$2,$3::jsonb,$4) id",
      [companyId, table, JSON.stringify(values), id],
    )
  ).rows[0].id;
}
async function saveSchedules(db: PGlite, items: Record<string, unknown>[]) {
  return db.query("select public.salvar_escalas_empresa($1,$2::jsonb)", [
    ids.alfa,
    JSON.stringify(items),
  ]);
}
async function deleteEvent(db: PGlite, id: string, companyId = ids.alfa) {
  return db.query("select public.excluir_data_especial($1,$2)", [
    companyId,
    id,
  ]);
}
async function setup(path?: string) {
  const db = new PGlite(path);
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
    file.endsWith("_special_dates_calendar.sql"),
  );
  assert.ok(target);
  for (const file of migrations.filter((file) => file < target))
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  await db.query("insert into auth.users values($1),($2)", [
    ids.owner,
    ids.other,
  ]);
  await asUser(db);
  await db.query(
    "insert into public.empresas(id,nome,cidade,uf) values($1,'Alfa','Dormentes','PE'),($2,'Beta','Petrolina','PE')",
    [ids.alfa, ids.beta],
  );
  await db.query(
    "insert into public.funcionarios(id,empresa_id,nome) values($1,$2,'Funcionária Alfa'),($3,$2,'Colega Alfa'),($4,$5,'Funcionário Beta')",
    [ids.employee, ids.alfa, ids.colleague, ids.foreignEmployee, ids.beta],
  );
  await db.query(
    "insert into public.modelos_jornada(id,empresa_id,nome,tipo) values($1,$2,'Modelo Alfa','5x2')",
    [ids.model, ids.alfa],
  );
  await db.query("select public.salvar_escalas($1::jsonb)", [
    JSON.stringify([schedule([legacyDay])]),
  ]);
  const before = (
    await db.query<{ row: unknown }>(
      "select to_jsonb(d) row from public.escala_dias d where escala_id=$1",
      [ids.schedule],
    )
  ).rows[0].row;
  await db.exec("reset role");
  for (const file of migrations.filter((file) => file >= target))
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  await asUser(db);
  return { db, before };
}

test("migration preserva o legado e grava estabelecimentos, alcances e auditoria por empresa", async () => {
  const { db, before } = await setup();
  try {
    const day = (
      await db.query<{ row: Record<string, unknown> }>(
        "select to_jsonb(d) row from public.escala_dias d where escala_id=$1",
        [ids.schedule],
      )
    ).rows[0].row;
    const { calendario, ...rest } = day;
    assert.equal(calendario, null);
    assert.deepEqual(rest, before);
    const unit = await save(db, "estabelecimentos", {
      nome: "Filial Petrolina",
      cidade: "Petrolina",
      uf: "PE",
      ativo: true,
    });
    await save(
      db,
      "funcionarios",
      { estabelecimento_id: unit },
      ids.alfa,
      ids.employee,
    );
    const eventId = await save(
      db,
      "datas_especiais",
      event({
        estabelecimento_id: unit,
        alcance: "funcionario",
        funcionario_ids: [ids.employee],
      }),
    );
    const row = (
      await db.query<{
        funcionario_ids: string[];
        estabelecimento_id: string;
        empresa_id: string;
      }>(
        "select funcionario_ids,estabelecimento_id,empresa_id from public.datas_especiais where id=$1",
        [eventId],
      )
    ).rows[0];
    assert.deepEqual(row, {
      funcionario_ids: [ids.employee],
      estabelecimento_id: unit,
      empresa_id: ids.alfa,
    });
    await save(db, "datas_especiais", event(), ids.beta);
    assert.equal(
      (
        await db.query(
          "select id from public.datas_especiais where empresa_id=$1",
          [ids.alfa],
        )
      ).rows.length,
      1,
    );
    assert.equal(
      (
        await db.query(
          "select id from public.datas_especiais where empresa_id=$1",
          [ids.beta],
        )
      ).rows.length,
      1,
    );
    const audit = (
      await db.query<{
        empresa_id: string;
        ator_id: string;
        depois: Record<string, unknown>;
      }>(
        "select empresa_id,ator_id,depois from public.log_alteracoes where registro_id=$1 and acao='INSERT'",
        [eventId],
      )
    ).rows[0];
    assert.equal(audit.empresa_id, ids.alfa);
    assert.equal(audit.ator_id, ids.owner);
    assert.equal(audit.depois.nome, "Recesso administrativo");
    const functions = await db.query<{ prosecdef: boolean }>(
      "select prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('excluir_data_especial','salvar_registro_empresa','salvar_escalas','validar_dados_calendario_empresa','validar_calendario_dia')",
    );
    assert.ok(functions.rows.every((entry) => entry.prosecdef === false));
  } finally {
    await db.close();
  }
});

test("SQL rejeita duplicidades, datas móveis anuais, alcances inválidos e períodos reduzidos malformados", async () => {
  const { db } = await setup();
  try {
    const nextDayInterval = {
      start: "01:00",
      end: "02:00",
      startDay: 1,
      endDay: 1,
    };
    for (const key of ["startDay", "endDay"]) {
      for (const invalid of [
        "1",
        "0",
        null,
        true,
        false,
        0.5,
        1.5,
        2,
        -1,
        [],
        {},
      ])
        await assert.rejects(
          db.query("select public.validar_intervalos_calendario($1::jsonb)", [
            JSON.stringify([{ ...nextDayInterval, [key]: invalid }]),
          ]),
          /Data do período inválida/,
        );
      await assert.rejects(
        save(
          db,
          "datas_especiais",
          event({
            nome: `Período reduzido com ${key} textual`,
            expediente: "reduzido",
            intervalos: [{ ...nextDayInterval, [key]: "1" }],
          }),
        ),
        /Data do período inválida/,
      );
    }
    await db.query("select public.validar_intervalos_calendario($1::jsonb)", [
      '[{"start":"01:00","end":"02:00","startDay":1.0,"endDay":1.0}]',
    ]);
    await save(
      db,
      "datas_especiais",
      event({
        nome: "Período reduzido com indicação numérica do dia seguinte",
        expediente: "reduzido",
        intervalos: [nextDayInterval],
      }),
    );
    const selected = event({
      alcance: "selecionados",
      funcionario_ids: [ids.colleague, ids.employee],
    });
    const id = await save(db, "datas_especiais", selected);
    const idsStored = (
      await db.query<{ funcionario_ids: string[] }>(
        "select funcionario_ids from public.datas_especiais where id=$1",
        [id],
      )
    ).rows[0].funcionario_ids;
    assert.deepEqual(idsStored, [ids.employee, ids.colleague]);
    await assert.rejects(
      save(db, "datas_especiais", {
        ...selected,
        funcionario_ids: [ids.employee, ids.colleague],
      }),
      { code: "23505" },
    );
    const largeGroup = (
      await db.query<{ id: string }>(
        "insert into public.funcionarios(empresa_id,nome) select $1,'Grupo '||n from generate_series(1,300) n returning id",
        [ids.alfa],
      )
    ).rows.map((person) => person.id);
    await save(
      db,
      "datas_especiais",
      event({
        nome: "Recesso do grupo de 300 pessoas",
        alcance: "selecionados",
        funcionario_ids: largeGroup,
      }),
    );
    await assert.rejects(
      save(
        db,
        "datas_especiais",
        event({
          nome: "Recesso do grupo de 300 pessoas",
          alcance: "selecionados",
          funcionario_ids: [...largeGroup].reverse(),
        }),
      ),
      { code: "23505" },
    );
    for (const invalid of [
      { alcance: "funcionario", funcionario_ids: [] },
      { alcance: "empresa", funcionario_ids: [ids.employee] },
      { alcance: "empresa", funcionario_ids: null },
      {
        alcance: "selecionados",
        funcionario_ids: [ids.employee, ids.employee],
      },
      { data_fim: "2026-12-23" },
      { recorrencia: "unica" },
      { recorrencia: "periodo", data_fim: null },
      { recorrencia: "anual", data_movel: true },
      { categoria: "feriado_municipal", cidade: null, uf: "PE" },
      { categoria: "sem_expediente", expediente: "normal" },
      { expediente: "normal", intervalos: regular },
      { expediente: "reduzido", intervalos: [] },
      {
        expediente: "reduzido",
        intervalos: [{ start: "25:00", end: "12:00" }],
      },
      {
        expediente: "reduzido",
        intervalos: [
          { start: "08:00", end: "12:00" },
          { start: "11:00", end: "13:00" },
        ],
      },
    ])
      await assert.rejects(
        save(
          db,
          "datas_especiais",
          event({ ...invalid, nome: `Inválido ${JSON.stringify(invalid)}` }),
        ),
      );
    for (const nome of [
      "Carnaval",
      "Sexta-feira Santa",
      "Paixão de Cristo",
      "Corpus Christi",
      "Páscoa",
      "Quarta-feira de Cinzas",
    ])
      await assert.rejects(
        save(db, "datas_especiais", event({ nome, recorrencia: "anual" })),
        /móvel/,
      );
    await save(
      db,
      "datas_especiais",
      event({
        nome: "Recesso recorrente",
        recorrencia: "anual",
        data_inicio: "2026-12-24",
        data_fim: "2027-01-03",
      }),
    );
    await assert.rejects(
      save(
        db,
        "datas_especiais",
        event({
          nome: " Recesso   recorrente ",
          recorrencia: "anual",
          data_inicio: "2027-12-24",
          data_fim: "2028-01-03",
        }),
      ),
      { code: "23505" },
    );
    await save(
      db,
      "datas_especiais",
      event({
        nome: "Mesmo nome com duração anual diferente",
        recorrencia: "anual",
        data_inicio: "2026-01-01",
        data_fim: null,
      }),
    );
    await save(
      db,
      "datas_especiais",
      event({
        nome: "Mesmo nome com duração anual diferente",
        recorrencia: "anual",
        data_inicio: "2026-01-01",
        data_fim: "2027-01-01",
      }),
    );
    for (const cidade of ["Dormentes", "Petrolina", "São Paulo"])
      await save(
        db,
        "datas_especiais",
        event({
          nome: "Feriado municipal",
          categoria: "feriado_municipal",
          uf: "PE",
          cidade,
        }),
      );
    await assert.rejects(
      save(
        db,
        "datas_especiais",
        event({
          nome: "Feriado municipal",
          categoria: "feriado_municipal",
          uf: "PE",
          cidade: "  SAO   PAULO  ",
        }),
      ),
      { code: "23505" },
    );
    await save(
      db,
      "datas_especiais",
      event({
        nome: "Dia bissexto recorrente",
        recorrencia: "anual",
        data_inicio: "2024-02-29",
        data_fim: null,
      }),
    );
    await assert.rejects(
      save(
        db,
        "datas_especiais",
        event({
          nome: "Dia bissexto recorrente",
          recorrencia: "anual",
          data_inicio: "2028-02-29",
          data_fim: null,
        }),
      ),
      { code: "23505" },
    );
    await save(
      db,
      "datas_especiais",
      event({
        nome: "Ponto facultativo com decisão expressa",
        categoria: "ponto_facultativo",
        expediente: "normal",
        data_inicio: "2026-10-28",
        data_fim: null,
        recorrencia: "unica",
      }),
    );
    await save(
      db,
      "datas_especiais",
      event({
        nome: "Expediente reduzido",
        expediente: "reduzido",
        intervalos: regular,
      }),
    );
  } finally {
    await db.close();
  }
});

test("RPCs, FKs e RLS rejeitam referências cruzadas, acesso anônimo e operações em empresa arquivada", async () => {
  const { db } = await setup();
  try {
    const alphaUnit = await save(db, "estabelecimentos", {
      nome: "Unidade Alfa",
      cidade: "Dormentes",
      uf: "PE",
    });
    const betaUnit = await save(
      db,
      "estabelecimentos",
      { nome: "Unidade Beta", cidade: "Petrolina", uf: "PE" },
      ids.beta,
    );
    const id = await save(db, "datas_especiais", event());
    await assert.rejects(
      save(
        db,
        "funcionarios",
        { estabelecimento_id: betaUnit },
        ids.alfa,
        ids.employee,
      ),
      /Estabelecimento/,
    );
    await assert.rejects(
      save(db, "datas_especiais", event({ estabelecimento_id: betaUnit })),
      /Estabelecimento/,
    );
    await assert.rejects(
      save(
        db,
        "datas_especiais",
        event({
          alcance: "funcionario",
          funcionario_ids: [ids.foreignEmployee],
        }),
      ),
      /Funcionários/,
    );
    await assert.rejects(
      save(
        db,
        "datas_especiais",
        event({
          estabelecimento_id: alphaUnit,
          alcance: "funcionario",
          funcionario_ids: [ids.employee],
        }),
      ),
      /Funcionários/,
    );
    await assert.rejects(
      save(db, "datas_especiais", { ...event(), empresa_id: ids.beta }),
      /contexto/,
    );
    await assert.rejects(
      save(
        db,
        "datas_especiais",
        { observacoes: "Outra empresa" },
        ids.beta,
        id,
      ),
      /indisponível/,
    );
    await assert.rejects(deleteEvent(db, id, ids.beta), /indisponível/);
    await assert.rejects(
      db.query("update public.datas_especiais set empresa_id=$1 where id=$2", [
        ids.beta,
        id,
      ]),
      /escopo/,
    );
    await assert.rejects(
      save(db, "datas_especiais", { ...event(), user_id: ids.other }),
      /Campo não permitido/,
    );
    await asUser(db, ids.other);
    assert.equal(
      (await db.query("select id from public.datas_especiais")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select id from public.estabelecimentos")).rows.length,
      0,
    );
    await assert.rejects(
      save(db, "datas_especiais", event()),
      /empresa|permissão/i,
    );
    await assert.rejects(deleteEvent(db, id), /empresa|permissão/i);
    await db.exec("set role anon");
    await assert.rejects(
      db.query("select * from public.datas_especiais"),
      /permission denied/,
    );
    await assert.rejects(
      save(db, "datas_especiais", event()),
      /permission denied/,
    );
    await asUser(db);
    await save(db, "empresas", { situacao: "arquivada" }, ids.alfa, ids.alfa);
    await assert.rejects(
      save(db, "datas_especiais", event()),
      /inativa|arquivada/,
    );
    await assert.rejects(deleteEvent(db, id), /inativa|arquivada/);
    await save(db, "empresas", { situacao: "ativa" }, ids.alfa, ids.alfa);
    await deleteEvent(db, id);
  } finally {
    await db.close();
  }
});

test("base e exceção individual persistem após reabrir o banco e excluir evento sem apagar horários", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cont-calendar-"));
  let db: PGlite | null = null;
  try {
    ({ db } = await setup(directory));
    const id = await save(db, "datas_especiais", event());
    const calendario = {
      folgar_feriado: true,
      base: {
        intervalos: regular,
        folga: false,
        feriado: null,
        observacao: "Programação original",
      },
      excecao: {
        categoria: "feriado",
        nome: "Plantão individual autorizado",
        expediente: "normal",
        intervalos: regular,
        observacao: "Exceção individual preservada",
      },
    };
    const row = { ...legacyDay, feriado: "Data individual", calendario };
    await saveSchedules(db, [schedule([row])]);
    await db.close();
    db = new PGlite(directory);
    await asUser(db);
    assert.deepEqual(
      (
        await db.query<{ calendario: unknown }>(
          "select calendario from public.escala_dias where escala_id=$1",
          [ids.schedule],
        )
      ).rows[0].calendario,
      calendario,
    );
    await save(
      db,
      "datas_especiais",
      { observacoes: "Evento editado" },
      ids.alfa,
      id,
    );
    await deleteEvent(db, id);
    const persisted = (
      await db.query<{
        calendario: unknown;
        intervalos: unknown;
        feriado: string;
      }>(
        "select calendario,intervalos,feriado from public.escala_dias where escala_id=$1",
        [ids.schedule],
      )
    ).rows[0];
    assert.deepEqual(persisted, {
      calendario,
      intervalos: regular,
      feriado: "Data individual",
    });
    const bad = {
      ...row,
      calendario: {
        ...calendario,
        excecao: { ...calendario.excecao, funcionario_id: ids.foreignEmployee },
      },
    };
    await assert.rejects(
      saveSchedules(db, [
        schedule([{ ...row, observacao: "Não deve persistir" }]),
        schedule([bad]),
      ]),
      /Campo inválido/,
    );
    assert.equal(
      (
        await db.query<{ observacao: string }>(
          "select observacao from public.escala_dias where escala_id=$1",
          [ids.schedule],
        )
      ).rows[0].observacao,
      legacyDay.observacao,
    );
    for (const invalid of [
      {
        base: {
          ...calendario.base,
          intervalos: [{ start: "09:xx", end: "12:00" }],
        },
      },
      { base: { ...calendario.base, empresa_id: ids.beta } },
      {
        ...calendario,
        excecao: { ...calendario.excecao, expediente: "sem_expediente" },
      },
      { base: [] },
      { ...calendario, folgar_feriado: "true" },
      { ...calendario, folgar_feriado: null },
      { ...calendario, folgar_feriado: 0 },
      {
        ...calendario,
        base: {
          ...calendario.base,
          intervalos: [
            { start: "01:00", end: "02:00", startDay: "1", endDay: 1 },
          ],
        },
      },
      {
        ...calendario,
        excecao: {
          ...calendario.excecao,
          intervalos: [
            { start: "01:00", end: "02:00", startDay: 1, endDay: "1" },
          ],
        },
      },
    ])
      await assert.rejects(
        saveSchedules(db, [schedule([{ ...row, calendario: invalid }])]),
      );
    await saveSchedules(db, [
      schedule([{ ...row, calendario: { ...calendario, excecao: null } }]),
    ]);
    assert.equal(
      (
        await db.query<{ calendario: { excecao: unknown } }>(
          "select calendario from public.escala_dias where escala_id=$1",
          [ids.schedule],
        )
      ).rows[0].calendario.excecao,
      null,
    );
    await saveSchedules(db, [
      schedule([
        {
          ...row,
          calendario: { ...calendario, folgar_feriado: false, excecao: null },
        },
      ]),
    ]);
    await db.close();
    db = new PGlite(directory);
    await asUser(db);
    assert.deepEqual(
      (
        await db.query<{ calendario: unknown }>(
          "select calendario from public.escala_dias where escala_id=$1",
          [ids.schedule],
        )
      ).rows[0].calendario,
      { ...calendario, folgar_feriado: false, excecao: null },
    );
    const nextDayIntervals = [
      { start: "01:00", end: "02:00", startDay: 1, endDay: 1 },
    ];
    const nextDayCalendar = {
      ...calendario,
      base: { ...calendario.base, intervalos: nextDayIntervals },
      excecao: { ...calendario.excecao, intervalos: nextDayIntervals },
    };
    await saveSchedules(db, [
      schedule([{ ...row, calendario: nextDayCalendar }]),
    ]);
    assert.deepEqual(
      (
        await db.query<{ calendario: unknown }>(
          "select calendario from public.escala_dias where escala_id=$1",
          [ids.schedule],
        )
      ).rows[0].calendario,
      nextDayCalendar,
    );
  } finally {
    if (db) await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
