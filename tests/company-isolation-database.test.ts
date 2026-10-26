import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const ids = {
  owner: "30000000-0000-4000-8000-000000000001",
  other: "30000000-0000-4000-8000-000000000002",
  alfa: "30000000-0000-4000-8000-000000000003",
  beta: "30000000-0000-4000-8000-000000000004",
  external: "30000000-0000-4000-8000-000000000005",
  ana: "30000000-0000-4000-8000-000000000006",
  bia: "30000000-0000-4000-8000-000000000007",
  externalEmployee: "30000000-0000-4000-8000-000000000008",
  usedBase: "30000000-0000-4000-8000-000000000009",
  unusedBase: "30000000-0000-4000-8000-000000000010",
  alfaModel: "30000000-0000-4000-8000-000000000011",
  betaModel: "30000000-0000-4000-8000-000000000012",
  schedule: "30000000-0000-4000-8000-000000000013",
};
const pattern = { "1": [{ start: "08:00", end: "12:00" }] };

async function asUser(db: PGlite, userId: string) {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    userId,
  ]);
}

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
  const isolationMigration = migrations.find((file) =>
    file.endsWith("_company_isolation.sql"),
  );
  assert.ok(isolationMigration);
  for (const file of migrations.filter((file) => file < isolationMigration))
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  await db.query("insert into auth.users values($1),($2)", [
    ids.owner,
    ids.other,
  ]);
  await asUser(db, ids.owner);
  await db.query(
    "insert into public.empresas(id,nome,cct) values($1,'Alfa','CCT Alfa'),($2,'Beta','CCT Beta')",
    [ids.alfa, ids.beta],
  );
  await db.query(
    "insert into public.funcionarios(id,empresa_id,nome,cargo,cpf) values($1,$2,'Ana','Assistente','01234567890'),($3,$4,'Bia','Analista',null)",
    [ids.ana, ids.alfa, ids.bia, ids.beta],
  );
  await db.query(
    "insert into public.modelos_jornada(id,empresa_id,nome,tipo,padrao) values($1,null,'Base usada','5x2',$5::jsonb),($2,null,'Base livre','5x2',$5::jsonb),($3,$6,'Próprio Alfa','5x2',$5::jsonb),($4,$7,'Próprio Beta','5x2',$5::jsonb)",
    [
      ids.usedBase,
      ids.unusedBase,
      ids.alfaModel,
      ids.betaModel,
      JSON.stringify(pattern),
      ids.alfa,
      ids.beta,
    ],
  );
  await db.query("update public.empresas set modelo_padrao_id=$1 where id=$2", [
    ids.usedBase,
    ids.alfa,
  ]);
  await db.query(
    "update public.funcionarios set modelo_padrao_id=$1 where id=$2",
    [ids.usedBase, ids.ana],
  );
  await db.query("select public.salvar_escalas($1::jsonb)", [
    JSON.stringify([
      {
        id: ids.schedule,
        empresa_id: ids.alfa,
        funcionario_id: ids.ana,
        modelo_id: ids.usedBase,
        mes: "2026-12-01",
        nome_funcionario: "Ana",
        modelo_nome: "Base usada",
        modelo_tipo: "5x2",
        dias: [
          {
            data: "2026-12-01",
            intervalos: [{ start: "08:00", end: "12:00" }],
            folga: false,
            feriado: null,
            observacao: "Legado preservado",
          },
        ],
      },
    ]),
  ]);
  await db.query(
    "insert into public.feriados(nome,data,abrangencia) values('Natal','2026-12-25','nacional')",
  );
  await db.query(
    "insert into public.parametros_legais(nome,chave,valor,inicio_vigencia,fonte) values('Regime geral','regime','{\"limite_semanal_minutos\":2520}','2026-01-01','Fonte original')",
  );
  await asUser(db, ids.other);
  await db.query("insert into public.empresas(id,nome) values($1,'Externa')", [
    ids.external,
  ]);
  await db.query(
    "insert into public.funcionarios(id,empresa_id,nome) values($1,$2,'Outra conta')",
    [ids.externalEmployee, ids.external],
  );
  await db.exec("reset role");
  const legacyDays = (
    await db.query(
      "select data,intervalos,folga,feriado,observacao from public.escala_dias order by data",
    )
  ).rows;
  const logCount = (
    await db.query<{ count: number }>(
      "select count(*)::integer as count from public.log_alteracoes where user_id=$1",
      [ids.owner],
    )
  ).rows[0].count;
  await db.exec(
    await readFile(`supabase/migrations/${isolationMigration}`, "utf8"),
  );
  await asUser(db, ids.owner);
  return { db, legacyDays, logCount };
}

async function save(
  db: PGlite,
  companyId: string,
  table: string,
  value: object,
  id?: string,
) {
  return (
    await db.query<{ id: string }>(
      "select public.salvar_registro_empresa($1::uuid,$2::text,$3::jsonb,$4::uuid) as id",
      [companyId, table, JSON.stringify(value), id ?? null],
    )
  ).rows[0].id;
}

test("isolamento preserva legado e mantém bases globais vinculadas estáveis", async () => {
  const { db, legacyDays, logCount } = await setup();
  try {
    assert.deepEqual(
      (
        await db.query<{ folgar_feriados: boolean }>(
          "select folgar_feriados from public.empresas order by nome",
        )
      ).rows.map((company) => company.folgar_feriados),
      [true, true],
    );
    assert.deepEqual(
      (
        await db.query(
          "select data,intervalos,folga,feriado,observacao from public.escala_dias order by data",
        )
      ).rows,
      legacyDays,
    );
    assert.equal(
      (
        await db.query<{ modelo_padrao_id: string }>(
          "select modelo_padrao_id from public.empresas where id=$1",
          [ids.alfa],
        )
      ).rows[0].modelo_padrao_id,
      ids.usedBase,
    );
    assert.equal(
      (
        await db.query<{ modelo_padrao_id: string }>(
          "select modelo_padrao_id from public.funcionarios where id=$1",
          [ids.ana],
        )
      ).rows[0].modelo_padrao_id,
      ids.usedBase,
    );
    assert.equal(
      (
        await db.query<{ modelo_id: string }>(
          "select modelo_id from public.escalas where id=$1",
          [ids.schedule],
        )
      ).rows[0].modelo_id,
      ids.usedBase,
    );
    assert.equal(
      (
        await db.query<{ count: number }>(
          "select count(*)::integer as count from public.log_alteracoes",
        )
      ).rows[0].count,
      logCount,
    );
    await db.query("select public.salvar_escalas($1::jsonb)", [
      JSON.stringify([
        {
          id: ids.schedule,
          empresa_id: ids.alfa,
          funcionario_id: ids.ana,
          modelo_id: ids.usedBase,
          mes: "2026-12-01",
          nome_funcionario: "Ana",
          modelo_nome: "Base usada",
          modelo_tipo: "5x2",
          dias: [
            {
              data: "2026-12-01",
              intervalos: [{ start: "08:00", end: "12:00" }],
              folga: false,
              feriado: null,
              observacao: "Edição permitida do calendário legado",
            },
          ],
        },
      ]),
    ]);
    assert.equal(
      (
        await db.query<{ observacao: string }>(
          "select observacao from public.escala_dias where escala_id=$1",
          [ids.schedule],
        )
      ).rows[0].observacao,
      "Edição permitida do calendário legado",
    );
    await save(
      db,
      ids.alfa,
      "funcionarios",
      { cargo: "Assistente atualizado", modelo_padrao_id: ids.usedBase },
      ids.ana,
    );
    await save(
      db,
      ids.alfa,
      "empresas",
      { cct: "CCT Alfa revisada" },
      ids.alfa,
    );
    await save(db, ids.alfa, "empresas", { folgar_feriados: false }, ids.alfa);
    assert.deepEqual(
      (
        await db.query<{ id: string; folgar_feriados: boolean }>(
          "select id,folgar_feriados from public.empresas order by nome",
        )
      ).rows,
      [
        { id: ids.alfa, folgar_feriados: false },
        { id: ids.beta, folgar_feriados: true },
      ],
    );
    await assert.rejects(
      db.query("update public.modelos_jornada set padrao='{}' where id=$1", [
        ids.usedBase,
      ]),
      /base|biblioteca|refer|vincul|modelo/i,
    );
    await assert.rejects(
      db.query("delete from public.modelos_jornada where id=$1", [
        ids.usedBase,
      ]),
      /base|biblioteca|refer|vincul|modelo/i,
    );
    await assert.rejects(
      save(
        db,
        ids.beta,
        "empresas",
        { modelo_padrao_id: ids.unusedBase },
        ids.beta,
      ),
      /cop|própri|empresa|modelo/i,
    );
    await assert.rejects(
      save(
        db,
        ids.beta,
        "funcionarios",
        { modelo_padrao_id: ids.unusedBase },
        ids.bia,
      ),
      /cop|própri|empresa|modelo/i,
    );
    await assert.rejects(
      db.query(
        "insert into public.escalas(empresa_id,funcionario_id,modelo_id,mes,nome_funcionario) values($1,$2,$3,'2027-01-01','Bia')",
        [ids.beta, ids.bia, ids.unusedBase],
      ),
      /cop|própri|empresa|modelo/i,
    );
    await assert.rejects(
      db.query(
        "insert into public.escalas(empresa_id,funcionario_id,modelo_id,mes,nome_funcionario) values($1,$2,$3,'2027-01-01','Ana')",
        [ids.alfa, ids.ana, ids.usedBase],
      ),
      /cop|própri|empresa|modelo/i,
    );
    await db.query(
      "update public.modelos_jornada set nome='Base livre revisada' where id=$1",
      [ids.unusedBase],
    );
    const copied = await save(db, ids.beta, "modelos_jornada", {
      empresa_id: ids.beta,
      nome: "Cópia Beta",
      tipo: "5x2",
      padrao: pattern,
    });
    await save(
      db,
      ids.beta,
      "funcionarios",
      { modelo_padrao_id: copied },
      ids.bia,
    );
    await save(
      db,
      ids.beta,
      "modelos_jornada",
      { padrao: { "1": [{ start: "09:00", end: "15:00" }] } },
      copied,
    );
    assert.deepEqual(
      (
        await db.query<{ padrao: object }>(
          "select padrao from public.modelos_jornada where id=$1",
          [ids.usedBase],
        )
      ).rows[0].padrao,
      pattern,
    );
    await assert.rejects(
      db.query("select public.excluir_modelo_empresa($1::uuid,$2::uuid)", [
        ids.beta,
        copied,
      ]),
      /vincul|refer|foreign key/i,
    );
    const unlinked = await save(db, ids.alfa, "modelos_jornada", {
      empresa_id: ids.alfa,
      nome: "Modelo removível",
      tipo: "5x2",
      padrao: {},
    });
    await db.query("select public.excluir_modelo_empresa($1::uuid,$2::uuid)", [
      ids.alfa,
      unlinked,
    ]);
    assert.equal(
      (
        await db.query("select id from public.modelos_jornada where id=$1", [
          unlinked,
        ])
      ).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});

test("RPC empresarial rejeita IDs, payloads e campos de outro contexto no próprio SQL", async () => {
  const { db } = await setup();
  try {
    const created = await save(db, ids.alfa, "funcionarios", {
      empresa_id: ids.alfa,
      nome: "Nova Alfa",
      cpf: "98765432100",
    });
    await save(db, ids.alfa, "funcionarios", { cargo: "Cargo Alfa" }, created);
    assert.deepEqual(
      (
        await db.query(
          "select empresa_id,nome,cpf,cargo from public.funcionarios where id=$1",
          [created],
        )
      ).rows,
      [
        {
          empresa_id: ids.alfa,
          nome: "Nova Alfa",
          cpf: "98765432100",
          cargo: "Cargo Alfa",
        },
      ],
    );
    await assert.rejects(
      save(db, ids.alfa, "funcionarios", { cargo: "Ataque" }, ids.bia),
      /empresa|contexto|registro|permiss/i,
    );
    await assert.rejects(
      save(db, ids.alfa, "empresas", { cct: "Ataque" }, ids.beta),
      /empresa|contexto|registro|permiss/i,
    );
    await assert.rejects(
      save(db, ids.alfa, "modelos_jornada", { nome: "Ataque" }, ids.betaModel),
      /empresa|contexto|registro|permiss/i,
    );
    await assert.rejects(
      save(
        db,
        ids.alfa,
        "modelos_jornada",
        { nome: "Ataque à base" },
        ids.usedBase,
      ),
      /empresa|contexto|registro|permiss/i,
    );
    for (const table of [
      "funcionarios",
      "modelos_jornada",
      "feriados",
      "parametros_legais",
    ])
      for (const empresa_id of [ids.beta, null])
        await assert.rejects(
          save(db, ids.alfa, table, { empresa_id, nome: "Ataque" }),
          /empresa|contexto|registro|permiss/i,
        );
    for (const field of ["id", "user_id", "created_at"])
      await assert.rejects(
        save(
          db,
          ids.alfa,
          "funcionarios",
          { [field]: ids.other, nome: "Ataque" },
          ids.ana,
        ),
        /campo|permit|coluna|identifica/i,
      );
    await assert.rejects(
      save(db, ids.alfa, "log_alteracoes", { acao: "INSERT" }),
      /tabela|permit/i,
    );
    await assert.rejects(
      save(db, ids.alfa, "funcionarios; delete from public.empresas", {
        nome: "Ataque",
      }),
      /tabela|permit/i,
    );
    await assert.rejects(
      db.query("select public.excluir_modelo_empresa($1::uuid,$2::uuid)", [
        ids.alfa,
        ids.betaModel,
      ]),
      /empresa|contexto|registro|permiss|modelo/i,
    );
    await assert.rejects(
      save(
        db,
        ids.alfa,
        "funcionarios",
        { modelo_padrao_id: ids.betaModel },
        ids.ana,
      ),
      /modelo|empresa/i,
    );
    assert.equal(
      (
        await db.query<{ cargo: string }>(
          "select cargo from public.funcionarios where id=$1",
          [ids.bia],
        )
      ).rows[0].cargo,
      "Analista",
    );
  } finally {
    await db.close();
  }
});

test("feriados e regras particulares têm unicidade e auditoria por empresa sem alterar referências gerais", async () => {
  const { db } = await setup();
  try {
    const holiday = {
      nome: "Data própria",
      data: "2026-12-10",
      abrangencia: "nacional",
      uf: null,
      cidade: null,
    };
    const rule = {
      nome: "Regime próprio",
      chave: "regime",
      valor: { limite_semanal_minutos: 2400 },
      inicio_vigencia: "2026-12-01",
      fonte: "CCT cadastrada",
      confirmado: false,
    };
    const holidayA = await save(db, ids.alfa, "feriados", {
      ...holiday,
      empresa_id: ids.alfa,
    });
    const holidayB = await save(db, ids.beta, "feriados", {
      ...holiday,
      empresa_id: ids.beta,
    });
    const ruleA = await save(db, ids.alfa, "parametros_legais", {
      ...rule,
      empresa_id: ids.alfa,
    });
    const ruleB = await save(db, ids.beta, "parametros_legais", {
      ...rule,
      empresa_id: ids.beta,
    });
    assert.notEqual(holidayA, holidayB);
    assert.notEqual(ruleA, ruleB);
    await assert.rejects(
      save(db, ids.alfa, "feriados", { ...holiday, empresa_id: ids.alfa }),
      /duplicate key|unique/i,
    );
    await assert.rejects(
      save(db, ids.alfa, "parametros_legais", {
        ...rule,
        empresa_id: ids.alfa,
      }),
      /duplicate key|unique/i,
    );
    await db.query(
      "insert into public.feriados(nome,data,abrangencia) values('Data própria','2026-12-10','nacional')",
    );
    await db.query(
      "insert into public.parametros_legais(nome,chave,valor,inicio_vigencia,fonte) values('Regime geral dezembro','regime','{}','2026-12-01','Fonte geral')",
    );
    await assert.rejects(
      db.query(
        "insert into public.feriados(nome,data,abrangencia) values('Data própria','2026-12-10','nacional')",
      ),
      /duplicate key|unique/i,
    );
    await assert.rejects(
      db.query(
        "insert into public.parametros_legais(nome,chave,valor,inicio_vigencia,fonte) values('Outro geral','regime','{}','2026-12-01','Fonte geral')",
      ),
      /duplicate key|unique/i,
    );
    for (const [table, id] of [
      ["feriados", holidayA],
      ["parametros_legais", ruleA],
    ]) {
      await assert.rejects(
        db.query(`update public.${table} set empresa_id=$1 where id=$2`, [
          ids.beta,
          id,
        ]),
        /escopo|empresa|imut/i,
      );
      await assert.rejects(
        save(
          db,
          ids.alfa,
          table,
          { nome: "Ataque ao registro Beta" },
          table === "feriados" ? holidayB : ruleB,
        ),
        /empresa|contexto|registro|permiss/i,
      );
      await assert.rejects(
        db.query(
          `insert into public.${table}(empresa_id,${table === "feriados" ? "nome,data,abrangencia" : "nome,chave,valor,inicio_vigencia,fonte"}) values($1,${table === "feriados" ? "'Externa','2026-12-11','nacional'" : "'Externa','regime','{}','2026-12-11','Fonte'"})`,
          [ids.external],
        ),
        /empresa|permiss|foreign key|row-level security/i,
      );
    }
    await save(
      db,
      ids.beta,
      "parametros_legais",
      { valor: { limite_semanal_minutos: 1800 } },
      ruleB,
    );
    assert.deepEqual(
      (
        await db.query<{ valor: object }>(
          "select valor from public.parametros_legais where id=$1",
          [ruleA],
        )
      ).rows[0].valor,
      rule.valor,
    );
    assert.equal(
      (
        await db.query<{ nome: string }>(
          "select nome from public.feriados where empresa_id is null and data='2026-12-25'",
        )
      ).rows[0].nome,
      "Natal",
    );
    const audit = (
      await db.query<{ empresa_id: string }>(
        "select empresa_id from public.log_alteracoes where registro_id=$1",
        [ruleB],
      )
    ).rows;
    assert.ok(audit.length >= 2);
    assert.ok(audit.every((row) => row.empresa_id === ids.beta));
    await save(db, ids.beta, "empresas", { situacao: "arquivada" }, ids.beta);
    for (const [table, id] of [
      ["feriados", holidayB],
      ["parametros_legais", ruleB],
    ]) {
      await assert.rejects(
        save(db, ids.beta, table, { nome: "Alteração arquivada" }, id),
        /inativa|arquivad|reativ/i,
      );
      await assert.rejects(
        db.query(`delete from public.${table} where id=$1`, [id]),
        /inativa|arquivad|reativ/i,
      );
    }
    await assert.rejects(
      save(db, ids.beta, "empresas", { cct: "Alteração arquivada" }, ids.beta),
      /inativa|arquivad|reativ/i,
    );
    await save(db, ids.beta, "empresas", { situacao: "ativa" }, ids.beta);
    await save(
      db,
      ids.beta,
      "feriados",
      { nome: "Data Beta revisada" },
      holidayB,
    );
    assert.equal(
      (
        await db.query<{ nome: string }>(
          "select nome from public.feriados where id=$1",
          [holidayB],
        )
      ).rows[0].nome,
      "Data Beta revisada",
    );
  } finally {
    await db.close();
  }
});

test("chamadas diretas e RPCs mantêm isolamento entre usuários e negam acesso anônimo", async () => {
  const { db } = await setup();
  try {
    const procedures = (
      await db.query<{ proname: string; prosecdef: boolean }>(
        "select p.proname,p.prosecdef from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('salvar_registro_empresa','excluir_modelo_empresa','salvar_escalas_empresa')",
      )
    ).rows;
    assert.equal(procedures.length, 3);
    assert.ok(procedures.every((procedure) => !procedure.prosecdef));
    const saveBatch = (companyId: string, items: unknown) =>
      db.query("select public.salvar_escalas_empresa($1::uuid,$2::jsonb)", [
        companyId,
        JSON.stringify(items),
      ]);
    const day = {
      data: "2026-12-01",
      intervalos: [{ start: "08:00", end: "12:00" }],
      folga: false,
      feriado: null,
      observacao: "Salvo pelo contexto correto",
    };
    const legacy = {
      id: ids.schedule,
      empresa_id: ids.alfa,
      funcionario_id: ids.ana,
      modelo_id: ids.usedBase,
      mes: "2026-12-01",
      nome_funcionario: "Ana",
      modelo_nome: "Base usada",
      modelo_tipo: "5x2",
      dias: [day],
    };
    await saveBatch(ids.alfa, [legacy]);
    const ownMonth = {
      ...legacy,
      id: null,
      modelo_id: ids.alfaModel,
      mes: "2027-01-01",
      dias: [{ ...day, data: "2027-01-04" }],
    };
    await saveBatch(ids.alfa, [ownMonth]);
    const betaMonth = {
      ...ownMonth,
      empresa_id: ids.beta,
      funcionario_id: ids.bia,
      modelo_id: ids.betaModel,
      nome_funcionario: "Bia",
    };
    await saveBatch(ids.beta, [betaMonth]);
    const betaSchedule = (
      await db.query<{ id: string }>(
        "select id from public.escalas where empresa_id=$1",
        [ids.beta],
      )
    ).rows[0].id;
    await assert.rejects(
      saveBatch(ids.alfa, [betaMonth]),
      /empresa|contexto|escala/i,
    );
    await assert.rejects(
      saveBatch(ids.alfa, [{ ...ownMonth, id: betaSchedule }]),
      /empresa|contexto|escala/i,
    );
    await assert.rejects(
      saveBatch(ids.alfa, [{ ...ownMonth, id: ids.schedule }]),
      /empresa|contexto|escala/i,
    );
    const anotherEmployee = await save(db, ids.alfa, "funcionarios", {
      nome: "Outro funcionário Alfa",
    });
    await assert.rejects(
      saveBatch(ids.alfa, [{ ...legacy, funcionario_id: anotherEmployee }]),
      /empresa|contexto|escala/i,
    );
    await assert.rejects(
      saveBatch(ids.alfa, [{ ...ownMonth, id: ids.externalEmployee }]),
      /empresa|contexto|escala/i,
    );
    await assert.rejects(
      saveBatch(ids.alfa, [{ ...ownMonth, user_id: ids.other }]),
      /campo|permit/i,
    );
    await assert.rejects(
      saveBatch(ids.alfa, [
        { ...legacy, dias: [{ ...day, observacao: "Não persistir" }] },
        betaMonth,
      ]),
      /empresa|contexto|escala/i,
    );
    // The wrapper also preserves the transaction if a downstream FK/trigger
    // rejects a later item after the first item would have been written.
    await assert.rejects(
      saveBatch(ids.alfa, [
        { ...legacy, dias: [{ ...day, observacao: "Não persistir por FK" }] },
        {
          ...ownMonth,
          funcionario_id: ids.bia,
          mes: "2027-02-01",
          dias: [{ ...day, data: "2027-02-01" }],
        },
      ]),
      /funcionário|foreign key|vínculo|empresa/i,
    );
    assert.equal(
      (
        await db.query<{ observacao: string }>(
          "select observacao from public.escala_dias where escala_id=$1",
          [ids.schedule],
        )
      ).rows[0].observacao,
      day.observacao,
    );
    assert.equal(
      (
        await db.query<{ count: number }>(
          "select count(*)::integer as count from public.escalas where empresa_id=$1",
          [ids.alfa],
        )
      ).rows[0].count,
      2,
    );
    const protectedHoliday = await save(db, ids.alfa, "feriados", {
      nome: "Privado Alfa",
      data: "2026-12-10",
      abrangencia: "nacional",
    });
    const protectedRule = await save(db, ids.alfa, "parametros_legais", {
      nome: "Regra Alfa",
      chave: "regime",
      valor: {},
      inicio_vigencia: "2026-12-01",
      fonte: "Fonte Alfa",
    });
    await asUser(db, ids.other);
    await assert.rejects(
      saveBatch(ids.alfa, [legacy]),
      /empresa|contexto|permiss/i,
    );
    assert.equal(
      (await db.query("select id from public.empresas where id=$1", [ids.alfa]))
        .rows.length,
      0,
    );
    for (const [table, id] of [
      ["feriados", protectedHoliday],
      ["parametros_legais", protectedRule],
    ]) {
      assert.equal(
        (
          await db.query(`select id from public.${table} where empresa_id=$1`, [
            ids.alfa,
          ])
        ).rows.length,
        0,
      );
      assert.equal(
        (
          await db.query(
            `update public.${table} set nome='Ataque' where id=$1 returning id`,
            [id],
          )
        ).rows.length,
        0,
      );
    }
    await assert.rejects(
      save(db, ids.alfa, "funcionarios", { nome: "Ataque" }, ids.ana),
      /empresa|contexto|registro|permiss/i,
    );
    await assert.rejects(
      db.query("select public.excluir_modelo_empresa($1::uuid,$2::uuid)", [
        ids.alfa,
        ids.alfaModel,
      ]),
      /empresa|contexto|registro|permiss/i,
    );
    assert.equal(
      (
        await db.query(
          "update public.funcionarios set cargo='Ataque' where id=$1 returning id",
          [ids.ana],
        )
      ).rows.length,
      0,
    );
    await assert.rejects(
      save(db, ids.external, "funcionarios", {
        empresa_id: ids.alfa,
        nome: "Ataque",
      }),
      /empresa|contexto|registro|permiss/i,
    );
    await db.exec("reset role; set role anon");
    await assert.rejects(saveBatch(ids.alfa, [legacy]), /permission denied/i);
    await assert.rejects(
      db.query(
        "select public.salvar_registro_empresa($1::uuid,'funcionarios','{}'::jsonb,null::uuid)",
        [ids.alfa],
      ),
      /permission denied/i,
    );
    await assert.rejects(
      db.query("select public.excluir_modelo_empresa($1::uuid,$2::uuid)", [
        ids.alfa,
        ids.alfaModel,
      ]),
      /permission denied/i,
    );
    await assert.rejects(
      db.query("select * from public.parametros_legais"),
      /permission denied/i,
    );
  } finally {
    await db.close();
  }
});
