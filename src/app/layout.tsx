import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Gerador de Jornadas | Departamento Pessoal",
  description:
    "Organize empresas, funcionários e escalas mensais com parâmetros legais editáveis.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
