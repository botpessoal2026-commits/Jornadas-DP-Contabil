import type { AuthMode } from "@/components/auth-fields";
import { UsernameAccessError } from "./auth-username";

export type AuthField = "name" | "email" | "password" | "confirmPassword";
export type AuthFieldErrors = Partial<Record<AuthField, string>>;
export type AuthInput = {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
};
export function readAuthInput(form: FormData): AuthInput {
  return {
    name: String(form.get("name") ?? "").trim(),
    email: String(form.get("email") ?? "")
      .trim()
      .toLowerCase(),
    // A senha é enviada integralmente, inclusive espaços intencionais.
    password: String(form.get("password") ?? ""),
    confirmPassword: String(form.get("confirmPassword") ?? ""),
  };
}
export function validateAuthInput(
  mode: AuthMode,
  input: AuthInput,
): AuthFieldErrors {
  const errors: AuthFieldErrors = {};
  if (mode === "signup" && (input.name.length < 2 || input.name.length > 120))
    errors.name = "Informe seu nome, com 2 a 120 caracteres.";
  if (
    ["email-login", "signup", "reset", "resend"].includes(mode) &&
    (input.email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email))
  )
    errors.email = "Informe um e-mail válido.";
  if (!["reset", "resend"].includes(mode) && !input.password)
    errors.password = "Informe sua senha.";
  if (
    ["signup", "password"].includes(mode) &&
    (input.password.length < 8 || input.password.length > 1024)
  )
    errors.password =
      "Use uma senha com pelo menos 8 e no máximo 1.024 caracteres.";
  if (
    ["signup", "password"].includes(mode) &&
    input.confirmPassword !== input.password
  )
    errors.confirmPassword = "A confirmação deve ser igual à senha.";
  return errors;
}
export function authErrorMessage(error: unknown): string {
  if (error instanceof UsernameAccessError) return error.message;
  const item =
    error && typeof error === "object"
      ? (error as {
          code?: string;
          name?: string;
          message?: string;
          status?: number;
        })
      : {};
  const messages: Record<string, string> = {
    invalid_credentials:
      "E-mail ou senha incorretos. Confira os dados e tente novamente.",
    invalid_grant:
      "E-mail ou senha incorretos. Confira os dados e tente novamente.",
    email_not_confirmed:
      "Confirme seu e-mail para ativar o acesso. Se necessário, use Reenviar confirmação.",
    user_already_exists:
      "Este e-mail já está cadastrado. Entre na sua conta ou recupere a senha.",
    email_exists:
      "Este e-mail já está cadastrado. Entre na sua conta ou recupere a senha.",
    weak_password:
      "A senha não atende à política de segurança. Use pelo menos 8 caracteres e confira as exigências do serviço.",
    email_address_invalid: "Informe um e-mail válido.",
    email_address_not_authorized:
      "O serviço ainda restringe o envio de e-mails. O responsável precisa configurar o remetente no Supabase.",
    signup_disabled:
      "O cadastro está desativado no Supabase. Solicite ao responsável a ativação de novos cadastros.",
    over_email_send_rate_limit:
      "Muitos e-mails foram solicitados. Aguarde alguns minutos antes de tentar novamente.",
    over_request_rate_limit:
      "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.",
    same_password: "Escolha uma senha diferente da senha atual.",
    otp_expired:
      "O link de acesso expirou. Solicite um novo e-mail de recuperação ou confirmação.",
    session_not_found: "Sua sessão expirou. Entre novamente para continuar.",
  };
  if (item.code && messages[item.code]) return messages[item.code];
  if (
    item.name === "TypeError" ||
    item.name === "AbortError" ||
    item.name === "TimeoutError" ||
    item.name === "AuthRetryableFetchError" ||
    /fetch|network|abort|timeout|connection/i.test(item.message ?? "")
  )
    return "Falha de conexão. Verifique sua internet e tente novamente.";
  if (/invalid login credentials/i.test(item.message ?? ""))
    return messages.invalid_credentials;
  if (/already registered|already been registered/i.test(item.message ?? ""))
    return messages.user_already_exists;
  return "Não foi possível concluir o acesso. Tente novamente ou entre em contato com o responsável.";
}

/** Aborta a requisição, em vez de só ocultar uma operação ainda pendente. */
export async function fetchAuthWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  fetcher: typeof fetch = fetch,
  timeoutMs = 15000,
): Promise<Response> {
  const controller = new AbortController();
  const signal =
    init.signal ??
    (typeof Request !== "undefined" && input instanceof Request
      ? input.signal
      : undefined);
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () =>
      controller.abort(
        new DOMException("Tempo de conexão excedido", "TimeoutError"),
      ),
    timeoutMs,
  );
  try {
    return await fetcher(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
