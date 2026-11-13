import { redirect } from "next/navigation";

/** Entrada explícita na demonstração, sem criar sessão ou alterar dados reais. */
export default function FerramentaPage() {
  redirect("/?demo=1");
}
