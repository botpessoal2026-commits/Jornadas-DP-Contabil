import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const ids = {
  owner: "71000000-0000-4000-8000-000000000001",
  other: "71000000-0000-4000-8000-000000000002",
  company: "71000000-0000-4000-8000-000000000003",
  newUser: "71000000-0000-4000-8000-000000000004",
  rejected: "71000000-0000-4000-8000-000000000005",
};
const migration = "20261029150540_username_login_and_attempt_limits.sql";
const key = (prefix = "usuario", digit = "a") =>
  `${prefix}:${digit.repeat(64)}`;

async function setup(path?: string, minimalAuth = false) {
  const db = new PGlite(path);
  await db.exec(`
    create role anon; create role authenticated;
    ${minimalAuth ? "" : "create role service_role bypassrls;"}
    create schema auth;
    create table auth.users(id uuid primary key${minimalAuth ? "" : ",email text,raw_user_meta_data jsonb default '{}'::jsonb"});
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    grant usage on schema public,auth to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;
    alter default privileges in schema public grant all on tables to anon,authenticated;
  `);
  await db.query("insert into auth.users(id) values($1),($2)", [
    ids.owner,
    ids.other,
  ]);
  for (const file of (await readdir("supabase/migrations"))
    .filter((name) => name.endsWith(".sql") && name <= migration)
    .sort())
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  await user(db);
  await db.query(
    "insert into public.empresas(id,nome,cidade,uf) values($1,'Empresa preservada','Recife','PE')",
    [ids.company],
  );
  return db;
}

async function user(db: PGlite, id = ids.owner) {
  await db.exec("reset role; set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
}
async function service(db: PGlite) {
  await db.exec("reset role; set role service_role");
}
async function claim(db: PGlite, value: string) {
  return (
    await db.query<{ usuario: string }>(
      "select public.definir_nome_usuario($1) as usuario",
      [value],
    )
  ).rows[0].usuario;
}
async function attempt(db: PGlite, bucket: string) {
  return (
    await db.query<{ permitido: boolean; retry_after_s: number }>(
      "select * from public.consumir_tentativa_login($1)",
      [bucket],
    )
  ).rows[0];
}

test("usuário de conta existente é normalizado sem trocar UUID, empresa ou propriedade", async () => {
  const db = await setup();
  try {
    assert.equal(await claim(db, "  Mariana.DP  "), "mariana.dp");
    assert.equal(await claim(db, "mariana_nova"), "mariana_nova");
    assert.deepEqual(
      (await db.query("select user_id,usuario from public.nomes_login")).rows,
      [{ user_id: ids.owner, usuario: "mariana_nova" }],
    );
    assert.deepEqual(
      (await db.query("select id,user_id,nome from public.empresas")).rows,
      [
        {
          id: ids.company,
          user_id: ids.owner,
          nome: "Empresa preservada",
        },
      ],
    );
    await user(db, ids.other);
    assert.deepEqual(
      (await db.query("select * from public.empresas")).rows,
      [],
    );
  } finally {
    await db.close();
  }
});

test("RLS não permite diretório público, consulta de outro usuário ou troca de proprietário", async () => {
  const db = await setup();
  try {
    await claim(db, "mariana.dp");
    await user(db, ids.other);
    assert.deepEqual(
      (await db.query("select * from public.nomes_login")).rows,
      [],
    );
    await claim(db, "analista.dp");
    const changed = await db.query(
      "update public.nomes_login set usuario='invasao' where user_id=$1 returning usuario",
      [ids.owner],
    );
    assert.deepEqual(changed.rows, []);
    await assert.rejects(
      db.query("update public.nomes_login set user_id=$1 where user_id=$2", [
        ids.owner,
        ids.other,
      ]),
      /row-level security/,
    );
    await assert.rejects(
      db.query(
        "insert into public.nomes_login(user_id,usuario) values($1,'forjado')",
        [ids.newUser],
      ),
      /row-level security/,
    );
    for (const role of ["authenticated", "anon"]) {
      await db.exec(`reset role; set role ${role}`);
      await assert.rejects(
        db.query("select public.resolver_usuario_login('mariana.dp')"),
        /permission denied/,
      );
      await assert.rejects(attempt(db, key()), /permission denied/);
    }
    await assert.rejects(
      db.query("select * from public.nomes_login"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select * from public.login_tentativas"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select public.definir_nome_usuario('qualquer')"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select cont_auth_private.registrar_nome_login()"),
      /permission denied/,
    );
    await service(db);
    assert.equal(
      (
        await db.query<{ id: string | null }>(
          "select public.resolver_usuario_login(' MARIANA.DP ') as id",
        )
      ).rows[0].id,
      ids.owner,
    );
    assert.equal(
      (
        await db.query<{ id: string | null }>(
          "select public.resolver_usuario_login('inexistente') as id",
        )
      ).rows[0].id,
      null,
    );
    const columns = await db.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema='public' and table_name='nomes_login' order by ordinal_position",
    );
    assert.deepEqual(
      columns.rows.map((row) => row.column_name),
      ["user_id", "usuario", "created_at", "updated_at"],
    );
  } finally {
    await db.close();
  }
});

test("nomes duplicados, reservados e inválidos são rejeitados sem alterar o alias anterior", async () => {
  const db = await setup();
  try {
    await claim(db, "mariana.dp");
    for (const value of [
      "ab",
      "a".repeat(33),
      "nome com espaço",
      "josé",
      "root",
      "admin",
      "x@y.com",
      "../invasao",
    ])
      await assert.rejects(claim(db, value), /indisponível ou inválido/);
    await user(db, ids.other);
    await claim(db, "analista.dp");
    await assert.rejects(
      claim(db, "MARIANA.DP"),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23505",
    );
    assert.deepEqual(
      (await db.query("select usuario from public.nomes_login")).rows,
      [{ usuario: "analista.dp" }],
    );
  } finally {
    await db.close();
  }
});

test("cadastro Auth reserva alias atomicamente e ignora metadados de autorização forjados", async () => {
  const db = await setup();
  try {
    await claim(db, "ocupado.dp");
    await db.exec("reset role");
    await db.query(
      "insert into auth.users(id,email,raw_user_meta_data) values($1,'novo@example.test',$2::jsonb)",
      [
        ids.newUser,
        JSON.stringify({
          username: " Novo.DP ",
          user_id: ids.owner,
          role: "service_role",
          empresa_id: ids.company,
        }),
      ],
    );
    assert.deepEqual(
      (
        await db.query(
          "select user_id,usuario from public.nomes_login where user_id=$1",
          [ids.newUser],
        )
      ).rows,
      [{ user_id: ids.newUser, usuario: "novo.dp" }],
    );
    for (const username of ["OCUPADO.DP", "root", 123, null, "nome inválido"])
      await assert.rejects(
        db.query(
          "insert into auth.users(id,raw_user_meta_data) values($1,$2::jsonb)",
          [ids.rejected, JSON.stringify({ username })],
        ),
        /indisponível ou inválido/,
      );
    assert.deepEqual(
      (await db.query("select id from auth.users where id=$1", [ids.rejected]))
        .rows,
      [],
    );
    await db.query(
      "update auth.users set raw_user_meta_data=$1::jsonb where id=$2",
      [JSON.stringify({ username: "outro.nome", role: "admin" }), ids.newUser],
    );
    await user(db, ids.newUser);
    assert.deepEqual(
      (await db.query("select * from public.empresas")).rows,
      [],
    );
    assert.deepEqual(
      (await db.query("select usuario from public.nomes_login")).rows,
      [{ usuario: "novo.dp" }],
    );
  } finally {
    await db.close();
  }
});

test("limites atômicos persistem por bucket e recusam chamadas sem papel de servidor", async () => {
  const db = await setup();
  try {
    await service(db);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => attempt(db, key())),
    );
    assert.equal(results.filter((row) => row.permitido).length, 8);
    assert.equal(results.filter((row) => !row.permitido).length, 2);
    assert.ok(
      results
        .filter((row) => !row.permitido)
        .every((row) => row.retry_after_s > 0 && row.retry_after_s <= 900),
    );
    for (const prefix of ["ip", "conta"]) {
      const values = await Promise.all(
        Array.from({ length: 32 }, () => attempt(db, key(prefix))),
      );
      assert.equal(values.filter((row) => row.permitido).length, 30);
      assert.equal(values.filter((row) => !row.permitido).length, 2);
    }
    assert.deepEqual(await attempt(db, key("usuario", "b")), {
      permitido: true,
      retry_after_s: 0,
    });
    for (const invalid of [
      "email:pessoa@example.test",
      "usuario:nome",
      "ip:127.0.0.1",
      key("outro"),
      key("ip", "A"),
    ])
      await assert.rejects(
        attempt(db, invalid),
        /Identificador de limite inválido/,
      );
    await db.query(
      "update public.login_tentativas set inicio_janela=clock_timestamp()-interval '16 minutes' where chave=$1",
      [key()],
    );
    assert.deepEqual(await attempt(db, key()), {
      permitido: true,
      retry_after_s: 0,
    });
    await db.query(
      "update public.login_tentativas set inicio_janela=clock_timestamp()-interval '25 hours' where chave=$1",
      [key("usuario", "b")],
    );
    await attempt(db, key());
    assert.deepEqual(
      (
        await db.query(
          "select chave from public.login_tentativas where chave=$1",
          [key("usuario", "b")],
        )
      ).rows,
      [],
    );
  } finally {
    await db.close();
  }
});

test("alias e propriedade continuam disponíveis após reabrir o banco local", async () => {
  const path = await mkdtemp(join(tmpdir(), "cont-username-"));
  let db: PGlite | null = null;
  try {
    db = await setup(path);
    await claim(db, "persistente.dp");
    await db.close();
    db = new PGlite(path);
    await user(db);
    assert.deepEqual(
      (await db.query("select user_id,usuario from public.nomes_login")).rows,
      [{ user_id: ids.owner, usuario: "persistente.dp" }],
    );
    assert.deepEqual(
      (await db.query("select id,user_id from public.empresas")).rows,
      [{ id: ids.company, user_id: ids.owner }],
    );
  } finally {
    await db?.close();
    await rm(path, { recursive: true, force: true });
  }
});

test("migration é compatível com contas legadas sem metadados e fixtures Auth mínimas", async () => {
  const db = await setup(undefined, true);
  try {
    assert.deepEqual(
      (await db.query("select * from public.nomes_login")).rows,
      [],
    );
    await db.exec("reset role");
    await db.query("insert into auth.users(id) values($1)", [ids.newUser]);
    await user(db, ids.newUser);
    assert.equal(await claim(db, "legado.dp"), "legado.dp");
  } finally {
    await db.close();
  }
});
