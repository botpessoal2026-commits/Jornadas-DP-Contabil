import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePublicSupabaseConfig } from "../src/lib/public-supabase-config";
const token = (role: string) =>
  [
    Buffer.from("{}").toString("base64url"),
    Buffer.from(JSON.stringify({ role })).toString("base64url"),
    "assinatura-de-teste",
  ].join(".");
test("configuração pública aceita ausência inicial e chave publishable/anon sem tratá-la como autenticação", () => {
  assert.doesNotThrow(() => validatePublicSupabaseConfig());
  assert.doesNotThrow(() =>
    validatePublicSupabaseConfig(
      "https://exemplo.supabase.co",
      "sb_publishable_exemplo",
    ),
  );
  assert.doesNotThrow(() =>
    validatePublicSupabaseConfig("https://exemplo.supabase.co", token("anon")),
  );
});
test("chave privada ou sessão de usuário é recusada sem expor o valor no erro", () => {
  for (const key of [
    "sb_secret_exemplo_privado",
    token("service_role"),
    token("authenticated"),
  ]) {
    assert.throws(
      () => validatePublicSupabaseConfig("https://exemplo.supabase.co", key),
      (e) =>
        e instanceof Error &&
        !e.message.includes(key) &&
        /chave pública/.test(e.message),
    );
  }
});
test("URL inválida ou HTTP remoto é recusado; desenvolvimento local continua permitido", () => {
  assert.throws(() => validatePublicSupabaseConfig("não é URL"), /URL HTTPS/);
  assert.throws(
    () => validatePublicSupabaseConfig("http://exemplo.supabase.co"),
    /Use HTTPS/,
  );
  assert.doesNotThrow(() =>
    validatePublicSupabaseConfig("http://127.0.0.1:54321"),
  );
});
