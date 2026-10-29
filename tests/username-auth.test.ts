import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getOwnUsername,
  normalizeUsername,
  reservedUsernames,
  setOwnUsername,
  signInWithUsername,
  UsernameAccessError,
  usernameError,
} from "../src/lib/auth-username";
import {
  createUsernameSignInHandler,
  type UsernameLoginDependencies,
} from "../src/lib/auth-username-server";

const userId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const tokens = {
  access_token: "access-for-test",
  refresh_token: "refresh-for-test",
};
type Call = { method: string; arguments: unknown[] };

function clientFixture(
  options: {
    row?: { usuario: unknown } | null;
    readError?: unknown;
    rpcData?: unknown;
    rpcError?: unknown;
    session?: unknown;
    sessionError?: unknown;
  } = {},
) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      calls.push({ method: "from", arguments: [table] });
      return {
        select(columns: string) {
          calls.push({ method: "select", arguments: [columns] });
          return {
            eq(column: string, value: string) {
              calls.push({ method: "eq", arguments: [column, value] });
              return {
                async maybeSingle() {
                  calls.push({ method: "maybeSingle", arguments: [] });
                  return {
                    data: options.row ?? null,
                    error: options.readError ?? null,
                  };
                },
              };
            },
          };
        },
      };
    },
    async rpc(name: string, payload: unknown) {
      calls.push({ method: "rpc", arguments: [name, payload] });
      return { data: options.rpcData ?? null, error: options.rpcError ?? null };
    },
    auth: {
      async setSession(value: unknown) {
        calls.push({ method: "setSession", arguments: [value] });
        return {
          data: { session: options.session ?? null },
          error: options.sessionError ?? null,
        };
      },
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

function accessError(code: string) {
  return (error: unknown) =>
    error instanceof UsernameAccessError && error.code === code;
}

function request(
  body: unknown = { username: "mariana.costa", password: "secret-for-test" },
  options: {
    method?: string;
    origin?: string | null;
    contentType?: string | null;
    raw?: string | Uint8Array<ArrayBuffer>;
    headers?: Record<string, string>;
  } = {},
) {
  const method = options.method ?? "POST";
  const headers = new Headers(options.headers);
  if (options.origin !== null)
    headers.set("origin", options.origin ?? "https://cont.example");
  if (options.contentType !== null)
    headers.set(
      "content-type",
      options.contentType ?? "application/json; charset=utf-8",
    );
  return new Request("https://cont.example/api/auth/username", {
    method,
    headers,
    ...(method === "GET" || method === "HEAD"
      ? {}
      : { body: options.raw ?? JSON.stringify(body) }),
  });
}

function handlerFixture(overrides: Partial<UsernameLoginDependencies> = {}) {
  const calls: Call[] = [];
  const waits: number[] = [];
  const dependencies: UsernameLoginDependencies = {
    async reserveAttempts(username, ip) {
      calls.push({ method: "reserveAttempts", arguments: [username, ip] });
      return { allowed: true, retryAfterSeconds: 0 };
    },
    async resolveUserId(username) {
      calls.push({ method: "resolveUserId", arguments: [username] });
      return userId;
    },
    async getIdentity(id) {
      calls.push({ method: "getIdentity", arguments: [id] });
      return { email: "private-recovery@example.test" };
    },
    async signIn(email, password, captchaToken) {
      calls.push({
        method: "signIn",
        arguments: [email, password, captchaToken],
      });
      return { tokens, userId };
    },
    clientIp() {
      return "192.0.2.20";
    },
    now() {
      return 1000;
    },
    async wait(ms) {
      waits.push(ms);
    },
    ...overrides,
  };
  return { handler: createUsernameSignInHandler(dependencies), calls, waits };
}

test("nome de usuário normaliza caixa e espaços, aceita limites e rejeita caracteres ou nomes reservados", () => {
  assert.equal(normalizeUsername("  Mariana.Costa_2-1  "), "mariana.costa_2-1");
  for (const value of ["abc", "MARIANA.COSTA", "a".repeat(32), "a_1-2.3"])
    assert.equal(usernameError(value), null);
  for (const value of [
    "",
    "ab",
    "a".repeat(33),
    "_abc",
    "ábc",
    "a b",
    "a@b",
    "a/b",
    "a\nb",
  ])
    assert.equal(typeof usernameError(value), "string");
  for (const value of reservedUsernames)
    assert.ok(usernameError(` ${value.toUpperCase()} `)?.includes("reservado"));
});

test("leitura do próprio alias consulta somente usuário fornecido e coluna sem e-mail", async () => {
  const { client, calls } = clientFixture({
    row: { usuario: "mariana.costa" },
  });
  assert.equal(await getOwnUsername(client, userId), "mariana.costa");
  assert.deepEqual(calls, [
    { method: "from", arguments: ["nomes_login"] },
    { method: "select", arguments: ["usuario"] },
    { method: "eq", arguments: ["user_id", userId] },
    { method: "maybeSingle", arguments: [] },
  ]);
  assert.equal(await getOwnUsername(clientFixture().client, userId), null);
  assert.equal(
    await getOwnUsername(clientFixture({ row: { usuario: 7 } }).client, userId),
    null,
  );
});

test("erro de leitura do alias não revela erro de banco ou identidade", async () => {
  const { client } = clientFixture({
    readError: { message: "SQL secret private@example.test" },
  });
  await assert.rejects(getOwnUsername(client, userId), (error: unknown) => {
    assert.ok(accessError("username_unavailable")(error));
    assert.ok(error instanceof Error);
    assert.doesNotMatch(error.message, /SQL|secret|private@/);
    return true;
  });
});

test("definir alias usa RPC autenticada sem receber outro UID ou criar conta", async () => {
  const { client, calls } = clientFixture({ rpcData: "mariana.costa" });
  assert.equal(
    await setOwnUsername(client, " Mariana.Costa "),
    "mariana.costa",
  );
  assert.deepEqual(calls, [
    {
      method: "rpc",
      arguments: ["definir_nome_usuario", { p_usuario: "mariana.costa" }],
    },
  ]);
  const invalid = clientFixture();
  await assert.rejects(
    setOwnUsername(invalid.client, "root"),
    accessError("invalid_username"),
  );
  assert.deepEqual(invalid.calls, []);
});

test("definir alias distingue duplicidade e recusa gravação sem confirmação idêntica do servidor", async () => {
  await assert.rejects(
    setOwnUsername(
      clientFixture({ rpcError: { code: "23505", message: "private SQL" } })
        .client,
      "mariana",
    ),
    accessError("username_taken"),
  );
  for (const options of [
    { rpcError: { code: "42501", message: "private SQL" } },
    { rpcData: "outra-pessoa" },
    { rpcData: null },
  ])
    await assert.rejects(
      setOwnUsername(clientFixture(options).client, "mariana"),
      accessError("username_unavailable"),
    );
});

test("cliente envia somente login por POST same-origin/no-store e instala a sessão Supabase recebida", async () => {
  const session = { user: { id: userId } };
  const { client, calls } = clientFixture({ session });
  let captured: { input: unknown; init?: RequestInit } | undefined;
  const password = "  My unchanged password  ";
  const fetcher: typeof fetch = async (input, init) => {
    captured = { input, init };
    return new Response(JSON.stringify(tokens), { status: 200 });
  };
  const result = await signInWithUsername(client, " Mariana.Costa ", password, {
    fetcher,
    captchaToken: "captcha-for-test",
  });
  assert.equal(result.data.session, session);
  assert.equal(captured?.input, "/api/auth/username");
  assert.equal(captured?.init?.method, "POST");
  assert.equal(captured?.init?.cache, "no-store");
  assert.equal(captured?.init?.credentials, "same-origin");
  assert.deepEqual(JSON.parse(String(captured?.init?.body)), {
    username: "mariana.costa",
    password,
    captchaToken: "captcha-for-test",
  });
  assert.deepEqual(calls, [{ method: "setSession", arguments: [tokens] }]);
  assert.ok(!JSON.stringify(calls).includes(password));
});

test("cliente valida alias antes da rede e propaga falhas de acesso sem criar sessão", async () => {
  const { client, calls } = clientFixture();
  let requests = 0;
  const fetcher: typeof fetch = async () => {
    requests++;
    return new Response(
      JSON.stringify({
        error: "Usuário ou senha inválidos.",
        code: "invalid_credentials",
      }),
      { status: 401 },
    );
  };
  await assert.rejects(
    signInWithUsername(client, "admin", "password", { fetcher }),
    accessError("invalid_username"),
  );
  assert.equal(requests, 0);
  await assert.rejects(
    signInWithUsername(client, "mariana", "password", { fetcher }),
    accessError("invalid_credentials"),
  );
  assert.equal(requests, 1);
  assert.deepEqual(calls, []);
});

test("cliente rejeita respostas inválidas e falha de sessão sem manter credencial própria", async () => {
  for (const payload of [
    null,
    {},
    { access_token: "x" },
    { ...tokens, refresh_token: "" },
    { ...tokens, access_token: 7 },
  ]) {
    const { client, calls } = clientFixture();
    await assert.rejects(
      signInWithUsername(client, "mariana", "password", {
        fetcher: async () =>
          new Response(JSON.stringify(payload), { status: 200 }),
      }),
      accessError("invalid_session"),
    );
    assert.deepEqual(calls, []);
  }
  for (const options of [
    { session: null },
    {
      session: { user: { id: userId } },
      sessionError: { message: "private error" },
    },
  ]) {
    const { client } = clientFixture(options);
    await assert.rejects(
      signInWithUsername(client, "mariana", "password", {
        fetcher: async () => new Response(JSON.stringify(tokens)),
      }),
      accessError("invalid_session"),
    );
  }
  await assert.rejects(
    signInWithUsername(clientFixture().client, "mariana", "password", {
      fetcher: async () =>
        new Response("<html>unavailable</html>", { status: 503 }),
    }),
    accessError("username_signin_failed"),
  );
});

test("handler protege método e origem antes de consultar identidade ou consumir tentativas", async () => {
  const { handler, calls } = handlerFixture();
  assert.equal(
    (await handler(request(undefined, { method: "GET" }))).status,
    405,
  );
  assert.equal(
    (await handler(request(undefined, { origin: "https://evil.example" })))
      .status,
    403,
  );
  assert.equal(
    (await handler(request(undefined, { origin: "null" }))).status,
    403,
  );
  assert.deepEqual(calls, []);
});

test("handler sem configuração responde 503 explícito sem expor segredos", async () => {
  const response = await createUsernameSignInHandler(null)(request());
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.code, "username_unavailable");
  assert.match(payload.error, /configurado/);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  assert.equal(response.headers.get("pragma"), "no-cache");
});

test("handler recusa formato, JSON e credenciais inválidos antes do banco ou Auth", async () => {
  const { handler, calls } = handlerFixture();
  for (const options of [
    { contentType: null },
    { contentType: "text/plain" },
    { raw: "{broken" },
    { raw: "" },
  ])
    assert.equal((await handler(request(undefined, options))).status, 400);
  const invalidPayloads = [
    null,
    [],
    "string",
    {},
    { username: "admin", password: "secret" },
    { username: "ab", password: "secret" },
    { username: 1, password: "secret" },
    { username: "mariana", password: "" },
    { username: "mariana", password: 7 },
    { username: "mariana", password: "x".repeat(1025) },
    { username: "mariana", password: "secret", captchaToken: 3 },
    { username: "mariana", password: "secret", captchaToken: "x".repeat(4097) },
  ];
  for (const payload of invalidPayloads) {
    const response = await handler(request(payload));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "input");
  }
  assert.deepEqual(calls, []);
});

test("handler aplica limite real de 8192 bytes e não confia em Content-Length", async () => {
  const { handler, calls } = handlerFixture();
  const body = { username: "mariana", password: "secret", padding: "" };
  const base = JSON.stringify(body).length;
  const exact = JSON.stringify({ ...body, padding: "a".repeat(8192 - base) });
  assert.equal(Buffer.byteLength(exact), 8192);
  assert.equal((await handler(request(undefined, { raw: exact }))).status, 200);
  calls.length = 0;
  assert.equal(
    (
      await handler(
        request(undefined, {
          raw: `${exact} `,
          headers: { "content-length": "1" },
        }),
      )
    ).status,
    400,
  );
  assert.equal(
    (await handler(request({ ...body, padding: "á".repeat(5000) }))).status,
    400,
  );
  assert.equal(
    (await handler(request(undefined, { raw: new Uint8Array([0xc0, 0xaf]) })))
      .status,
    400,
  );
  assert.deepEqual(calls, []);
});

test("handler usa identidade real após limiter, preserva senha/captcha e só retorna tokens sem diretório", async () => {
  const { handler, calls, waits } = handlerFixture();
  const response = await handler(
    request({
      username: " MARIANA.COSTA ",
      password: " unchanged ",
      captchaToken: "captcha",
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), tokens);
  assert.deepEqual(calls, [
    { method: "reserveAttempts", arguments: ["mariana.costa", "192.0.2.20"] },
    { method: "resolveUserId", arguments: ["mariana.costa"] },
    { method: "getIdentity", arguments: [userId] },
    {
      method: "signIn",
      arguments: ["private-recovery@example.test", " unchanged ", "captcha"],
    },
  ]);
  assert.deepEqual(waits, []);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});

test("usuário desconhecido e senha incorreta compartilham 401, tempo mínimo e caminho de Auth", async () => {
  const incorrect = handlerFixture({
    async signIn() {
      return { tokens: null, userId: null, status: 400 };
    },
  });
  const wrongResponse = await incorrect.handler(request());
  const wrongPayload = await wrongResponse.json();
  const unknown = handlerFixture({
    async resolveUserId() {
      return null;
    },
    async getIdentity(id) {
      unknown.calls.push({ method: "getIdentity", arguments: [id] });
      return null;
    },
    async signIn(email, password, captchaToken) {
      unknown.calls.push({
        method: "signIn",
        arguments: [email, password, captchaToken],
      });
      return { tokens: null, userId: null, status: 400 };
    },
  });
  const unknownResponse = await unknown.handler(request());
  assert.equal(wrongResponse.status, 401);
  assert.equal(unknownResponse.status, 401);
  assert.deepEqual(await unknownResponse.json(), wrongPayload);
  assert.equal(wrongPayload.code, "invalid_credentials");
  assert.deepEqual(incorrect.waits, [350]);
  assert.deepEqual(unknown.waits, [350]);
  assert.deepEqual(unknown.calls, [
    { method: "reserveAttempts", arguments: ["mariana.costa", "192.0.2.20"] },
    {
      method: "getIdentity",
      arguments: ["00000000-0000-0000-0000-000000000000"],
    },
    {
      method: "signIn",
      arguments: [
        "invalid-username@invalid.invalid",
        "secret-for-test",
        undefined,
      ],
    },
  ]);
});

test("handler nunca entrega sessão de outro UID nem tokens de uma identidade não resolvida", async () => {
  for (const overrides of [
    {
      async signIn() {
        return { tokens, userId: otherId };
      },
    },
    {
      async getIdentity() {
        return null;
      },
    },
    {
      async resolveUserId() {
        return null;
      },
    },
  ]) {
    const { handler } = handlerFixture(overrides);
    const response = await handler(request());
    assert.equal(response.status, 401);
    const body = await response.text();
    assert.doesNotMatch(
      body,
      /access-for-test|refresh-for-test|private-recovery|11111111|22222222/,
    );
  }
});

test("limiter distribuído bloqueia antes da identidade e informa Retry-After limitado", async () => {
  for (const [reported, expected] of [
    [12.2, "13"],
    [0, "1"],
    [5000, "900"],
  ] as const) {
    const { handler, calls } = handlerFixture({
      async reserveAttempts() {
        return { allowed: false, retryAfterSeconds: reported };
      },
    });
    const response = await handler(request());
    assert.equal(response.status, 429);
    assert.equal((await response.json()).code, "rate_limited");
    assert.equal(response.headers.get("retry-after"), expected);
    assert.deepEqual(calls, []);
  }
  const limitedAuth = handlerFixture({
    async signIn() {
      return { tokens: null, userId: null, status: 429 };
    },
  });
  const response = await limitedAuth.handler(request());
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "60");
});

test("falha de serviço ou migration produz 503 genérico sem revelar SQL, e-mail ou senha", async () => {
  for (const overrides of [
    {
      async reserveAttempts() {
        throw new Error("SQL secret private@example.test");
      },
    },
    {
      async resolveUserId() {
        throw new Error("SQL secret private@example.test");
      },
    },
    {
      async getIdentity() {
        throw new Error("admin secret private@example.test");
      },
    },
    {
      async signIn() {
        throw new Error("secret-for-test private@example.test");
      },
    },
    {
      async signIn() {
        return { tokens: null, userId: null, status: 503 };
      },
    },
  ]) {
    const response = await handlerFixture(overrides).handler(request());
    assert.equal(response.status, 503);
    const body = await response.text();
    assert.equal(JSON.parse(body).code, "username_unavailable");
    assert.doesNotMatch(
      body,
      /SQL|admin secret|secret-for-test|private@example/,
    );
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  }
});

test("resposta inválida só espera o restante do tempo mínimo e aceita cliente sem Origin", async () => {
  let elapsed = 0;
  const { handler, waits } = handlerFixture({
    now() {
      elapsed++;
      return elapsed === 1 ? 1000 : 1100;
    },
    async signIn() {
      return { tokens: null, userId: null };
    },
  });
  const response = await handler(request(undefined, { origin: null }));
  assert.equal(response.status, 401);
  assert.deepEqual(waits, [250]);
  let slowCalls = 0;
  const slow = handlerFixture({
    now() {
      return ++slowCalls === 1 ? 1000 : 1500;
    },
    async signIn() {
      return { tokens: null, userId: null };
    },
  });
  assert.equal((await slow.handler(request())).status, 401);
  assert.deepEqual(slow.waits, [0]);
});
