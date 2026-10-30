import type { SupabaseClient } from "@supabase/supabase-js";

export const reservedUsernames = [
  "admin",
  "administrator",
  "root",
  "sistema",
  "suporte",
  "service_role",
  "postgres",
  "anon",
  "authenticated",
] as const;

export function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

export function usernameError(value: string) {
  const username = normalizeUsername(value);
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username))
    return "Use de 3 a 32 caracteres: letras sem acento, números, ponto, hífen ou sublinhado.";
  if ((reservedUsernames as readonly string[]).includes(username))
    return "Este nome de usuário está reservado. Escolha outro.";
  return null;
}

export class UsernameAccessError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "UsernameAccessError";
  }
}

function validUsername(value: string) {
  const error = usernameError(value);
  if (error) throw new UsernameAccessError(error, "invalid_username");
  return normalizeUsername(value);
}

/** Alias lookup is restricted by owner RLS; it never reads another account. */
export async function getOwnUsername(client: SupabaseClient, userId: string) {
  const { data, error } = await client
    .from("nomes_login")
    .select("usuario")
    .eq("user_id", userId)
    .maybeSingle();
  if (error)
    throw new UsernameAccessError(
      "O cadastro de usuários ainda não está disponível neste ambiente.",
      "username_unavailable",
    );
  return typeof data?.usuario === "string" ? data.usuario : null;
}

export async function setOwnUsername(client: SupabaseClient, value: string) {
  const username = validUsername(value);
  const { data, error } = await client.rpc("definir_nome_usuario", {
    p_usuario: username,
  });
  if (error) {
    if (error.code === "23505")
      throw new UsernameAccessError(
        "Este usuário já está em uso. Escolha outro.",
        "username_taken",
      );
    throw new UsernameAccessError(
      "Não foi possível salvar seu usuário. Confira a sessão e a configuração do ambiente.",
      "username_unavailable",
    );
  }
  if (typeof data !== "string" || data !== username)
    throw new UsernameAccessError(
      "O usuário não foi confirmado pelo servidor. Atualize os dados.",
      "username_unavailable",
    );
  return data;
}

/** Passwords are submitted over HTTPS and never stored by the application. */
export async function signInWithUsername(
  client: SupabaseClient,
  username: string,
  password: string,
  options: { fetcher?: typeof fetch; captchaToken?: string } = {},
) {
  const response = await (options.fetcher ?? fetch)("/api/auth/username", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    credentials: "same-origin",
    body: JSON.stringify({
      username: validUsername(username),
      password,
      ...(options.captchaToken ? { captchaToken: options.captchaToken } : {}),
    }),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const failure = payload as { error?: unknown; code?: unknown } | null;
    throw new UsernameAccessError(
      typeof failure?.error === "string"
        ? failure.error
        : "Não foi possível entrar. Tente novamente.",
      typeof failure?.code === "string"
        ? failure.code
        : "username_signin_failed",
    );
  }
  const tokens = payload as {
    access_token?: unknown;
    refresh_token?: unknown;
  } | null;
  if (
    typeof tokens?.access_token !== "string" ||
    !tokens.access_token ||
    typeof tokens.refresh_token !== "string" ||
    !tokens.refresh_token
  )
    throw new UsernameAccessError(
      "O servidor não confirmou a sessão. Tente entrar novamente.",
      "invalid_session",
    );
  const result = await client.auth.setSession({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
  });
  if (result.error || !result.data.session)
    throw new UsernameAccessError(
      "Não foi possível estabelecer a sessão. Tente entrar novamente.",
      "invalid_session",
    );
  return result;
}
