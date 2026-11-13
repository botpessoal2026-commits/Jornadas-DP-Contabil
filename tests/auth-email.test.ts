import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readAuthInput,
  validateAuthInput,
  authErrorMessage,
  fetchAuthWithTimeout,
} from "../src/lib/auth-email";
const valid = {
  name: "Mariana Costa",
  email: "mariana@example.invalid",
  password: "  senha-exata-123  ",
  confirmPassword: "  senha-exata-123  ",
};
test("cadastro por e-mail valida nome, endereço, comprimento e confirmação sem exigir alias", () => {
  assert.deepEqual(validateAuthInput("signup", valid), {});
  assert.ok(validateAuthInput("signup", { ...valid, name: " " }).name);
  assert.ok(validateAuthInput("signup", { ...valid, email: "invalido" }).email);
  assert.ok(
    validateAuthInput("signup", { ...valid, password: "1234567" }).password,
  );
  assert.ok(
    validateAuthInput("signup", { ...valid, confirmPassword: "outra" })
      .confirmPassword,
  );
});
test("credenciais preservam a senha integral e normalizam somente nome e e-mail", () => {
  const form = new FormData();
  form.set("name", " Mariana Costa ");
  form.set("email", " MARIANA@EXAMPLE.INVALID ");
  form.set("password", valid.password);
  form.set("confirmPassword", valid.password);
  assert.deepEqual(readAuthInput(form), valid);
});
test("login, recuperação e definição de senha têm requisitos próprios", () => {
  assert.deepEqual(
    validateAuthInput("email-login", {
      ...valid,
      name: "",
      confirmPassword: "",
    }),
    {},
  );
  assert.deepEqual(
    validateAuthInput("reset", { ...valid, password: "", confirmPassword: "" }),
    {},
  );
  assert.ok(
    validateAuthInput("password", { ...valid, confirmPassword: "" })
      .confirmPassword,
  );
});
test("erros do provedor são traduzidos sem expor diagnóstico ou identidade", () => {
  for (const code of [
    "invalid_credentials",
    "email_not_confirmed",
    "user_already_exists",
    "email_exists",
    "weak_password",
    "signup_disabled",
    "over_email_send_rate_limit",
    "session_not_found",
  ])
    assert.notEqual(authErrorMessage({ code }), "");
  assert.match(
    authErrorMessage({ code: "invalid_credentials" }),
    /E-mail ou senha incorretos/,
  );
  assert.match(
    authErrorMessage({ code: "email_exists" }),
    /já está cadastrado/,
  );
  assert.match(
    authErrorMessage(new TypeError("Failed to fetch")),
    /Falha de conexão/,
  );
  assert.equal(
    authErrorMessage({ message: "internal postgres password=oculto" }).includes(
      "postgres",
    ),
    false,
  );
});
test("requisição Auth expirada é abortada de verdade", async () => {
  let observed: AbortSignal | undefined;
  const fetcher: typeof fetch = async (_input, init) => {
    observed = init?.signal ?? undefined;
    return new Promise((_resolve, reject) => {
      observed?.addEventListener("abort", () => reject(observed?.reason), {
        once: true,
      });
    });
  };
  await assert.rejects(
    fetchAuthWithTimeout(
      "https://example.invalid/auth/v1/token",
      {},
      fetcher,
      10,
    ),
    /Tempo de conexão excedido/,
  );
  assert.equal(observed?.aborted, true);
});
test("requisição respeita cancelamento do chamador e retorna resposta normal", async () => {
  const response = new Response("{}", { status: 200 });
  const fetcher: typeof fetch = async () => response;
  assert.equal(
    await fetchAuthWithTimeout(
      "https://example.invalid/auth/v1/token",
      {},
      fetcher,
      100,
    ),
    response,
  );
  const c = new AbortController();
  c.abort();
  await assert.rejects(
    fetchAuthWithTimeout(
      "https://example.invalid/auth/v1/token",
      { signal: c.signal },
      async (_i, init) => {
        assert.equal(init?.signal?.aborted, true);
        throw init?.signal?.reason;
      },
    ),
  );
});
