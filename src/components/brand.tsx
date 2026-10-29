import Image from "next/image";
import { brandAssets } from "@/lib/brand-assets";

export default function Brand({
  light = false,
  className = "",
}: {
  light?: boolean;
  className?: string;
}) {
  return (
    <div className={`brand ${className}`}>
      <Image
        className="brand-logo"
        src={light ? brandAssets.lightLogo : brandAssets.logo}
        alt="Cont Contábil"
        width={276}
        height={128}
        priority
      />
      <div className="brand-product">
        Gerador de Jornadas
        <span className="brand-caption">Departamento Pessoal</span>
      </div>
    </div>
  );
}
