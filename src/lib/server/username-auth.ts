import "server-only";
import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { UsernameLoginDependencies } from "../auth-username-server";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function serverSecret() {
  const value =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (
    !value ||
    value.startsWith("sb_publishable_") ||
    value === process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  )
    return null;
  if (value.startsWith("sb_secret_")) return value;
  try {
    // This only rejects a publishable/anon key supplied by mistake. Supabase
    // itself authenticates the credential; no unverified claim grants access.
    const payload = JSON.parse(
      Buffer.from(value.split(".")[1], "base64url").toString("utf8"),
    );
    return payload.role === "service_role" ? value : null;
  } catch {
    return null;
  }
}

/** Per-request clients never share a logged-in user or persist credentials. */
export function usernameLoginDependencies(): UsernameLoginDependencies | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const secret = serverSecret();
  if (!url || !publishable || !secret) return null;
  const options = {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, {
          ...init,
          cache: "no-store",
          signal: init?.signal
            ? AbortSignal.any([init.signal, AbortSignal.timeout(8000)])
            : AbortSignal.timeout(8000),
        }),
    },
  };
  const administrative = createClient(url, secret, options);
  const authenticator = createClient(url, publishable, options);
  const digest = (context: string, value: string) =>
    createHmac("sha256", secret).update(`${context}\0${value}`).digest("hex");
  return {
    clientIp(request) {
      // Vercel overwrites this header. Elsewhere the shared conservative bucket
      // avoids trusting a caller-supplied X-Forwarded-For value.
      if (process.env.VERCEL === "1")
        return (
          request.headers
            .get("x-vercel-forwarded-for")
            ?.split(",")[0]
            ?.trim()
            .slice(0, 128) || "unknown"
        );
      return "local-or-untrusted-proxy";
    },
    async reserveAttempts(username, ip) {
      const keys = [
        `ip:${digest("username-login-ip-v1", ip)}`,
        `usuario:${digest("username-login-pair-v1", `${ip}\0${username}`)}`,
        `conta:${digest("username-login-account-v1", username)}`,
      ];
      const results = await Promise.all(
        keys.map((key) =>
          administrative.rpc("consumir_tentativa_login", { p_chave: key }),
        ),
      );
      const limits = results.map(({ data, error }) => {
        if (error) throw new Error("username_service_unavailable");
        const row = Array.isArray(data) ? data[0] : data;
        if (
          !row ||
          typeof row.permitido !== "boolean" ||
          !Number.isFinite(row.retry_after_s)
        )
          throw new Error("username_service_unavailable");
        return row as { permitido: boolean; retry_after_s: number };
      });
      return {
        allowed: limits.every((limit) => limit.permitido),
        retryAfterSeconds: Math.max(
          ...limits.map((limit) => limit.retry_after_s),
        ),
      };
    },
    async resolveUserId(username) {
      const { data, error } = await administrative.rpc(
        "resolver_usuario_login",
        {
          p_usuario: username,
        },
      );
      if (
        error ||
        (data !== null && (typeof data !== "string" || !uuid.test(data)))
      )
        throw new Error("username_service_unavailable");
      return data as string | null;
    },
    async getIdentity(userId) {
      const { data, error } =
        await administrative.auth.admin.getUserById(userId);
      if (error && error.status !== 404)
        throw new Error("username_service_unavailable");
      return data.user?.email ? { email: data.user.email } : null;
    },
    async signIn(email, password, captchaToken) {
      const { data, error } = await authenticator.auth.signInWithPassword({
        email,
        password,
        ...(captchaToken ? { options: { captchaToken } } : {}),
      });
      return {
        tokens: data.session
          ? {
              access_token: data.session.access_token,
              refresh_token: data.session.refresh_token,
            }
          : null,
        userId: data.user?.id ?? null,
        status: error?.status,
        errorCode: error?.code,
      };
    },
  };
}
