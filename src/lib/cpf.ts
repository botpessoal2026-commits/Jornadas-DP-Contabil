/** Optional employee identification; stored as digits, formatted only for display. */
export function normalizeCpf(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/[.-]/g, "");
  if (!/^\d{11}$/.test(digits))
    throw new Error("Informe um CPF com 11 dígitos ou deixe o campo vazio.");
  return digits;
}

export function formatCpf(value?: string | null): string {
  const digits = value?.trim().replace(/[.-]/g, "") ?? "";
  return /^\d{11}$/.test(digits)
    ? digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4")
    : "Não informado";
}
