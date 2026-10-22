"use client";
import { useState } from "react";
import { initialRules } from "@/lib/presets";
const groups: Record<
  string,
  { key: string; label: string; boolean?: boolean }[]
> = {
  regime: [
    { key: "limite_semanal_minutos", label: "Teto semanal (minutos)" },
    { key: "limite_diario_minutos", label: "Teto diário (minutos)" },
    { key: "descansos_semanais", label: "Descansos por semana" },
    {
      key: "preferir_domingo",
      label: "Preferir descanso no domingo",
      boolean: true,
    },
    {
      key: "permite_limite_empresa",
      label: "Admite limite diário específico da empresa",
      boolean: true,
    },
  ],
  intervalo: [
    { key: "acima_minutos", label: "Jornada longa: acima de (minutos)" },
    {
      key: "entre_inicio_minutos",
      label: "Jornada intermediária: acima de (minutos)",
    },
    {
      key: "intervalo_longo_minutos",
      label: "Intervalo da jornada longa (minutos)",
    },
    {
      key: "intervalo_curto_minutos",
      label: "Intervalo da jornada intermediária (minutos)",
    },
  ],
  interjornada: [
    { key: "minutos", label: "Descanso mínimo entre jornadas (minutos)" },
  ],
  noturno: [
    { key: "inicio_minutos", label: "Início: minutos após 00:00 (22h = 1320)" },
    { key: "fim_minutos", label: "Fim: minutos após 00:00 (5h = 300)" },
    {
      key: "hora_reduzida_segundos",
      label: "Duração da hora reduzida (segundos)",
    },
    { key: "adicional_percentual", label: "Adicional noturno (%)" },
  ],
  divisor: [{ key: "fator", label: "Fator multiplicador da carga semanal" }],
};
export default function LegalFields({
  row,
}: {
  row?: Record<string, unknown>;
}) {
  const [group, setGroup] = useState(String(row?.chave ?? "regime"));
  const [values, setValues] = useState<
    Record<string, number | boolean | string>
  >(
    (row?.valor as Record<string, number | boolean | string>) ?? {
      ...initialRules.find((r) => r.chave === "regime")!.valor,
    },
  );
  return (
    <>
      <label className="span2">
        Grupo do parâmetro
        <select
          name="chave"
          value={group}
          onChange={(e) => {
            setGroup(e.target.value);
            setValues({
              ...initialRules.find((r) => r.chave === e.target.value)!.valor,
            });
          }}
        >
          {Object.keys(groups).map((key) => (
            <option key={key} value={key}>
              {
                (
                  {
                    regime: "Regime de trabalho",
                    intervalo: "Intervalo intrajornada",
                    interjornada: "Descanso entre jornadas",
                    noturno: "Trabalho noturno",
                    divisor: "Divisor mensal",
                  } as Record<string, string>
                )[key]
              }
            </option>
          ))}
        </select>
      </label>
      <input type="hidden" name="valor" value={JSON.stringify(values)} />
      <div className="span2 grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-lg bg-[#f6f9f3] p-4">
        {groups[group].map((field) =>
          field.boolean ? (
            <label key={field.key} className="check-label">
              <input
                type="checkbox"
                checked={values[field.key] === true}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [field.key]: e.target.checked }))
                }
              />
              {field.label}
            </label>
          ) : (
            <label key={field.key}>
              {field.label}
              <input
                type="number"
                min={0}
                step="any"
                required
                value={
                  values[field.key] === undefined
                    ? ""
                    : Number(values[field.key])
                }
                onChange={(e) =>
                  setValues((v) => ({
                    ...v,
                    [field.key]:
                      e.target.value === "" ? "" : Number(e.target.value),
                  }))
                }
              />
            </label>
          ),
        )}
      </div>
      <p className="warning-text span2">
        Durações em minutos, exceto a hora noturna (segundos). Exemplos: 42h =
        2520 min; 8h24 = 504 min; 52min30s = 3150 s.
      </p>
    </>
  );
}
