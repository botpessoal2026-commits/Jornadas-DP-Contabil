import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Cont Contábil | Gerador de Jornadas",
  description:
    "Planeje empresas, funcionários e jornadas de trabalho com o Gerador de Jornadas da Cont Contábil.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
