import { normalizeUsername, usernameError } from "./auth-username";

export type UsernameLoginTokens = {
  access_token: string;
  refresh_token: string;
};
export type UsernameLoginDependencies = {
  reserveAttempts: (
    username: string,
    ip: string,
  ) => Promise<{ allowed: boolean; retryAfterSeconds: number }>;
  resolveUserId: (username: string) => Promise<string | null>;
  getIdentity: (userId: string) => Promise<{ email: string } | null>;
  signIn: (
    email: string,
    password: string,
    captchaToken?: string,
  ) => Promise<{
    tokens: UsernameLoginTokens | null;
    userId: string | null;
    status?: number;
    errorCode?: string;
  }>;
  clientIp: (request: Request) => string;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
};

const dummyUserId = "00000000-0000-0000-0000-000000000000";
const dummyEmail = "invalid-username@invalid.invalid";
const headers = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  "Content-Type": "application/json; charset=utf-8",
};
function reply(status: number, value: unknown, retryAfter?: number) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      ...headers,
      ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}),
    },
  });
}
const unavailable = () =>
  reply(503, {
    error:
      "O acesso por usuário ainda não foi configurado neste ambiente. Use a opção de acesso por e-mail existente ou contate o responsável.",
    code: "username_unavailable",
  });

async function readBody(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new Error("invalid_body");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("invalid_body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) {
        await reader.cancel();
        throw new Error("invalid_body");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(all));
}

/** The handler is independent of credentials so tests exercise the real policy. */
export function createUsernameSignInHandler(
  dependencies: UsernameLoginDependencies | null,
) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST")
      return reply(405, { error: "Método não permitido.", code: "method" });
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin)
      return reply(403, { error: "Origem não permitida.", code: "origin" });
    if (!dependencies) return unavailable();
    let payload: unknown;
    try {
      payload = await readBody(request);
    } catch {
      return reply(400, {
        error: "Confira os dados de acesso.",
        code: "input",
      });
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      return reply(400, {
        error: "Confira os dados de acesso.",
        code: "input",
      });
    const { username, password, captchaToken } = payload as Record<
      string,
      unknown
    >;
    if (
      typeof username !== "string" ||
      usernameError(username) ||
      typeof password !== "string" ||
      password.length < 1 ||
      password.length > 1024 ||
      (captchaToken !== undefined &&
        (typeof captchaToken !== "string" || captchaToken.length > 4096))
    )
      return reply(400, {
        error: "Confira os dados de acesso.",
        code: "input",
      });
    const normalized = normalizeUsername(username);
    const now = dependencies.now ?? Date.now;
    const wait =
      dependencies.wait ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    const start = now();
    const invalid = async () => {
      // Unknown aliases and incorrect passwords share a response and minimum
      // duration. The distributed limiter also applies to unknown identities.
      await wait(Math.max(0, 350 - (now() - start)));
      return reply(401, {
        error: "Usuário ou senha inválidos.",
        code: "invalid_credentials",
      });
    };
    try {
      const rate = await dependencies.reserveAttempts(
        normalized,
        dependencies.clientIp(request),
      );
      if (!rate.allowed) {
        const retry = Math.min(
          900,
          Math.max(1, Math.ceil(rate.retryAfterSeconds)),
        );
        return reply(
          429,
          {
            error: "Muitas tentativas. Aguarde antes de tentar novamente.",
            code: "rate_limited",
          },
          retry,
        );
      }
      const userId = await dependencies.resolveUserId(normalized);
      // Even a missing alias performs the same administrative lookup and Auth
      // request. The dummy address is never registered or offered as an account.
      const identity = await dependencies.getIdentity(userId ?? dummyUserId);
      const result = await dependencies.signIn(
        identity?.email ?? dummyEmail,
        password,
        captchaToken as string | undefined,
      );
      if (result.status === 429)
        return reply(
          429,
          {
            error: "Muitas tentativas. Aguarde antes de tentar novamente.",
            code: "rate_limited",
          },
          60,
        );
      if (result.status && result.status >= 500) return unavailable();
      if (!userId || !identity) return invalid();
      // Supabase Auth checks the password before email_not_confirmed in its
      // password grant. Do not infer confirmation status from the alias lookup
      // or administrator profile, which would disclose accounts to strangers.
      if (
        result.status === 400 &&
        result.errorCode === "email_not_confirmed" &&
        !result.tokens &&
        !result.userId
      ) {
        await wait(Math.max(0, 350 - (now() - start)));
        return reply(403, {
          error:
            "Confirme seu e-mail para ativar o acesso. Se necessário, use Reenviar confirmação.",
          code: "confirmation_required",
        });
      }
      if (result.errorCode || !result.tokens || result.userId !== userId)
        return invalid();
      return reply(200, result.tokens);
    } catch {
      // Never echo provider errors, SQL, identity data or request credentials.
      return unavailable();
    }
  };
}
