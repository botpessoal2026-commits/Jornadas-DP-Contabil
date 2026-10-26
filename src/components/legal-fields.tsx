"use client";
import { useState } from "react";
import { initialRules } from "@/lib/presets";
import { default12x36Values } from "@/lib/work-regime";

type Field = {
  key: string;
  label: string;
  boolean?: boolean;
  min?: number;
  max?: number;
};
const groups: Record<string, Field[]> = {
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
const cycleFields: Field[] = [
  {
    key: "plantao_maximo_minutos",
    label: "Duração máxima do plantão (minutos)",
    min: 1,
    max: 720,
  },
  {
    key: "descanso_minimo_minutos",
    label: "Descanso mínimo entre plantões (minutos)",
    min: 2160,
  },
  {
    key: "intervalo_minimo_minutos",
    label: "Intervalo intrajornada (minutos)",
  },
  {
    key: "alternancia_horas",
    label: "Ciclo entre inícios de plantão (horas)",
    min: 48,
    max: 48,
  },
  {
    key: "limite_media_semanal_minutos",
    label: "Limite da média semanal no ciclo (minutos)",
    min: 1,
  },
  {
    key: "descansos_semanais",
    label: "Repousos semanais no período de vigência",
    min: 1,
  },
];

const commonRegimeValues = () => ({
  ...initialRules.find(
    (rule) => rule.chave === "regime" && rule.valor.tipo_regime !== "12x36",
  )!.valor,
  tipo_regime: "comum",
});

export default function LegalFields({
  row,
}: {
  row?: Record<string, unknown>;
}) {
  const [group, setGroup] = useState(String(row?.chave ?? "regime"));
  const [values, setValues] = useState<
    Record<string, number | boolean | string>
  >(
    (row?.valor as Record<string, number | boolean | string>) ??
      commonRegimeValues(),
  );
  const isCycle = group === "regime" && values.tipo_regime === "12x36";
  const setValue = (key: string, value: number | boolean | string) =>
    setValues((current) => ({ ...current, [key]: value }));
  return (
    <>
      <label className="span2">
        Grupo do parâmetro
        <select
          name="chave"
          value={group}
          onChange={(e) => {
            setGroup(e.target.value);
            setValues(
              e.target.value === "regime"
                ? commonRegimeValues()
                : {
                    ...initialRules.find((r) => r.chave === e.target.value)!
                      .valor,
                  },
            );
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
      {group === "regime" && (
        <label className="span2">
          Regime de trabalho
          <select
            value={isCycle ? "12x36" : "comum"}
            onChange={(event) =>
              setValues(
                event.target.value === "12x36"
                  ? { ...default12x36Values }
                  : commonRegimeValues(),
              )
            }
          >
            <option value="comum">Jornada comum</option>
            <option value="12x36">12×36</option>
          </select>
        </label>
      )}
      <input type="hidden" name="valor" value={JSON.stringify(values)} />
      <div className="span2 grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-lg bg-[#f1f6fc] p-4">
        {(isCycle ? cycleFields : groups[group]).map((field) =>
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
                min={field.min ?? 0}
                max={field.max}
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
        {isCycle && (
          <>
            <label>
              Tratamento do intervalo
              <select
                value={String(values.intervalo_tratamento ?? "usufruido")}
                onChange={(event) =>
                  setValue("intervalo_tratamento", event.target.value)
                }
              >
                <option value="usufruido">Intervalo usufruído</option>
                <option value="indenizado">Intervalo indenizado</option>
              </select>
            </label>
            <label>
              Tratamento dos repousos semanais
              <select
                value={String(values.descanso_semanal_tratamento ?? "semanal")}
                onChange={(event) =>
                  setValue("descanso_semanal_tratamento", event.target.value)
                }
              >
                <option value="semanal">Repousos em cada semana</option>
                <option value="media_mensal">
                  Média mensal mediante ACT/CCT
                </option>
              </select>
            </label>
            <label className="span2">
              Fundamento jurídico do regime
              <select
                value={String(values.fundamento_tipo ?? "")}
                onChange={(event) =>
                  setValue("fundamento_tipo", event.target.value)
                }
              >
                <option value="">Pendente de comprovação</option>
                <option value="acordo_individual">
                  Acordo individual escrito
                </option>
                <option value="cct">Convenção coletiva de trabalho</option>
                <option value="act">Acordo coletivo de trabalho</option>
              </select>
            </label>
            <label className="span2">
              Referência do instrumento aplicável
              <input
                value={String(values.fundamento_referencia ?? "")}
                onChange={(event) =>
                  setValue("fundamento_referencia", event.target.value)
                }
                placeholder="Identificação, cláusula e vigência do documento"
              />
            </label>
            <label className="check-label span2">
              <input
                type="checkbox"
                checked={values.comprovado === true}
                onChange={(event) =>
                  setValue("comprovado", event.target.checked)
                }
              />
              Instrumento conferido e aplicável a estes vínculos
            </label>
            {values.descanso_semanal_tratamento === "media_mensal" && (
              <>
                <label className="span2">
                  ACT/CCT para compensação dos repousos
                  <input
                    value={String(values.descanso_compensacao_referencia ?? "")}
                    onChange={(event) =>
                      setValue(
                        "descanso_compensacao_referencia",
                        event.target.value,
                      )
                    }
                    placeholder="Identificação e cláusula da compensação mensal"
                  />
                </label>
                <label className="check-label span2">
                  <input
                    type="checkbox"
                    checked={values.descanso_compensacao_comprovada === true}
                    onChange={(event) =>
                      setValue(
                        "descanso_compensacao_comprovada",
                        event.target.checked,
                      )
                    }
                  />
                  Compensação coletiva dos repousos conferida
                </label>
              </>
            )}
          </>
        )}
      </div>
      {isCycle && (
        <p className="warning-text span2">
          CLT, art. 59-A: acordo individual escrito, CCT ou ACT. A referência
          deve corresponder ao instrumento real, sem utilizar documentos
          demonstrativos. A comprovação do regime é distinta da compensação
          coletiva dos repousos prevista na EC nº 141/2026. Confira os limites e
          repousos aplicáveis à data de início da vigência abaixo.
        </p>
      )}
      <p className="warning-text span2">
        Durações em minutos, exceto a hora noturna (segundos). Exemplos: 42h =
        2520 min; 8h24 = 504 min; 52min30s = 3150 s.
      </p>
    </>
  );
}
