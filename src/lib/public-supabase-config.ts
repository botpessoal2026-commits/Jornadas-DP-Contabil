/** Detecta configuração perigosa; a autenticação das chaves continua no Supabase. */
export function validatePublicSupabaseConfig(url?: string, key?: string): void {
  if (url) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(
        "NEXT_PUBLIC_SUPABASE_URL deve conter a URL HTTPS do projeto Supabase.",
      );
    }
    if (
      parsed.protocol !== "https:" &&
      !(
        parsed.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(parsed.hostname)
      )
    )
      throw new Error(
        "Use HTTPS para o Supabase remoto. HTTP é permitido somente no desenvolvimento local.",
      );
  }
  if (!key) return;
  let role: unknown;
  if (key.split(".").length === 3) {
    try {
      const raw = key.split(".")[1].replaceAll("-", "+").replaceAll("_", "/");
      role = JSON.parse(
        atob(raw.padEnd(Math.ceil(raw.length / 4) * 4, "=")),
      ).role;
    } catch {
      /* A validação final do formato e da assinatura pertence ao serviço. */
    }
  }
  if (
    key.startsWith("sb_secret_") ||
    role === "service_role" ||
    role === "authenticated"
  )
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY exige uma chave pública publishable ou anon. Chaves privadas e tokens de usuário não podem ser enviados ao navegador.",
    );
}
