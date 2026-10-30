"use client";

import { useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { usernameError } from "@/lib/auth-username";

export type AuthMode =
  "login" | "email-login" | "signup" | "reset" | "resend" | "password";

function UsernameField({
  username,
  label = "Usuário",
}: {
  username?: string | null;
  label?: string;
}) {
  const id = useId();
  return (
    <div className="span2 auth-field">
      <label htmlFor={`${id}-username`}>
        {label}
        <input
          id={`${id}-username`}
          name="username"
          type="text"
          defaultValue={username ?? ""}
          required
          minLength={3}
          maxLength={32}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Ex.: mariana.costa"
          aria-describedby={`${id}-username-hint`}
          onInput={(event) => {
            const input = event.currentTarget;
            input.setCustomValidity(usernameError(input.value) ?? "");
          }}
        />
      </label>
      <span id={`${id}-username-hint`} className="muted font-normal">
        De 3 a 32 caracteres: letras sem acento, números, ponto, hífen ou
        sublinhado. Maiúsculas e minúsculas são equivalentes.
      </span>
    </div>
  );
}

function PasswordField({ newPassword }: { newPassword: boolean }) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const action = visible ? "Ocultar senha" : "Mostrar senha";
  return (
    <div className="auth-field auth-password-field">
      <label htmlFor={`${id}-password`}>Senha</label>
      <div className="auth-password-control">
        <input
          id={`${id}-password`}
          name="password"
          type={visible ? "text" : "password"}
          required
          minLength={newPassword ? 8 : undefined}
          maxLength={1024}
          autoComplete={newPassword ? "new-password" : "current-password"}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder={newPassword ? "Pelo menos 8 caracteres" : "Sua senha"}
        />
        <button
          className="auth-password-toggle"
          type="button"
          aria-label={action}
          aria-pressed={visible}
          aria-controls={`${id}-password`}
          title={action}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setVisible((value) => !value)}
        >
          {visible ? (
            <EyeOff size={19} aria-hidden="true" />
          ) : (
            <Eye size={19} aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  );
}

/** Fields only: the parent keeps submit, account state and error handling. */
export default function AuthFields({ mode }: { mode: AuthMode }) {
  const id = useId();
  const newPassword = mode === "signup" || mode === "password";
  return (
    <>
      {(mode === "login" || mode === "signup") && <UsernameField key={mode} />}
      {(mode === "email-login" ||
        mode === "signup" ||
        mode === "reset" ||
        mode === "resend") && (
        <div className="auth-field">
          <label htmlFor={`${id}-email`}>
            {mode === "signup" ? "E-mail para recuperação" : "E-mail"}
            <input
              key={mode}
              id={`${id}-email`}
              name="email"
              type="email"
              required
              maxLength={254}
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="voce@contabilidade.com.br"
              aria-describedby={
                mode === "signup" ? `${id}-email-hint` : undefined
              }
            />
          </label>
          {mode === "signup" && (
            <span id={`${id}-email-hint`} className="muted font-normal">
              Usado para confirmar a conta e recuperar a senha. Para entrar no
              dia a dia, use seu usuário.
            </span>
          )}
        </div>
      )}
      {mode !== "reset" && mode !== "resend" && (
        <PasswordField key={mode} newPassword={newPassword} />
      )}
    </>
  );
}

export function UsernameFields({ username }: { username?: string | null }) {
  return (
    <>
      <UsernameField username={username} label="Nome de usuário" />
      <p className="muted span2">
        Este nome de usuário fica vinculado à sua conta e aos seus cadastros.
        Depois de salvar, use-o com a senha atual para entrar.
      </p>
    </>
  );
}
