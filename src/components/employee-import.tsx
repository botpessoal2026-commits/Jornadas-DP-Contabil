"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Company, Employee, Establishment, Model } from "@/lib/types";
import { contractDurationText } from "@/lib/contract";
import {
  employeeImportFields,
  employeeImportTemplate,
  guessEmployeeImportMapping,
  parseEmployeeCSV,
  previewEmployeeImport,
  readEmployeeWorkbook,
  type EmployeeImportField,
  type EmployeeImportMapping,
  type EmployeeImportPreview,
} from "@/lib/employee-import";

export type EmployeeImportProps = {
  company: Company;
  existing: Employee[];
  models?: Model[];
  establishments?: Establishment[];
  onImport: (employees: Employee[]) => Promise<void>;
  busy?: boolean;
};

export default function EmployeeImport({
  company,
  existing,
  models = [],
  establishments = [],
  onImport,
  busy = false,
}: EmployeeImportProps) {
  const id = useId();
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<EmployeeImportMapping>({});
  const [preview, setPreview] = useState<EmployeeImportPreview | null>(null);
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const fileGeneration = useRef(0);
  useEffect(() => {
    fileGeneration.current++;
    setRows([]);
    setMapping({});
    setPreview(null);
    setError("");
    setMessage("");
    setReading(false);
    return () => {
      fileGeneration.current++;
    };
  }, [company.id]);
  const locked =
    busy || reading || saving || (company.situacao ?? "ativa") !== "ativa";
  const downloadTemplate = () => {
    const url = URL.createObjectURL(
      new Blob([employeeImportTemplate()], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "modelo-importacao-funcionarios.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section
      className="panel mb-6"
      aria-label="Importar funcionários por planilha"
    >
      <div className="panel-head">
        <h2>Importar funcionários</h2>
        <button
          type="button"
          className="button small"
          onClick={downloadTemplate}
        >
          Baixar modelo CSV
        </button>
      </div>
      <div className="panel-body">
        <p className="subtitle">
          Novos vínculos de <strong>{company.nome}</strong>. A importação não
          substitui funcionários existentes. Confira o mapeamento e todos os
          erros antes de confirmar.
        </p>
        <label className="mt-4" htmlFor={`${id}-file`}>
          Arquivo CSV ou Excel (.xlsx), até 5 MB e 1.000 pessoas
        </label>
        <input
          key={company.id}
          id={`${id}-file`}
          type="file"
          accept=".csv,.xlsx"
          disabled={locked}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            setPreview(null);
            setRows([]);
            setError("");
            setMessage("");
            if (!file) return;
            const generation = ++fileGeneration.current;
            setReading(true);
            try {
              if (file.size > 5 * 1024 * 1024)
                throw new Error("Arquivo excede 5 MB.");
              if (!/\.(csv|xlsx)$/i.test(file.name))
                throw new Error("Selecione um arquivo CSV ou XLSX.");
              const parsed = /\.xlsx$/i.test(file.name)
                ? await readEmployeeWorkbook(await file.arrayBuffer())
                : parseEmployeeCSV(await file.text());
              if (generation !== fileGeneration.current) return;
              setRows(parsed);
              setMapping(guessEmployeeImportMapping(parsed[0]));
            } catch (failure) {
              if (generation !== fileGeneration.current) return;
              setError(
                failure instanceof Error
                  ? failure.message
                  : "Não foi possível ler o arquivo.",
              );
            } finally {
              if (generation === fileGeneration.current) setReading(false);
            }
          }}
        />
        {reading && <p role="status">Lendo arquivo…</p>}
        {rows.length > 1 && (
          <>
            <p className="muted mt-4">
              {rows.length - 1} linha(s). Datas: dd/mm/aaaa ou aaaa-mm-dd.
              Cargas: 08:24, 8h24 ou horas decimais. CPF deve manter os 11
              dígitos; descansos usam 0–6. Cargas e descansos ausentes ficam
              para revisão, sem inferir contrato.
            </p>
            <div className="form-grid mt-4">
              {Object.entries(employeeImportFields).map(([key, label]) => (
                <label key={key}>
                  {label}
                  {key === "nome" ? " (obrigatório)" : " (opcional)"}
                  <select
                    disabled={locked}
                    value={mapping[key as EmployeeImportField] ?? ""}
                    onChange={(event) => {
                      const index = event.target.value;
                      setMapping((current) => {
                        const next = { ...current };
                        if (index === "")
                          delete next[key as EmployeeImportField];
                        else next[key as EmployeeImportField] = Number(index);
                        return next;
                      });
                      setPreview(null);
                      setMessage("");
                    }}
                  >
                    <option value="">Não importar este campo</option>
                    {rows[0].map((header, index) => (
                      <option key={index} value={index}>
                        {header || `Coluna ${index + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <button
              className="button mt-4"
              type="button"
              disabled={locked}
              onClick={() => {
                setError("");
                setMessage("");
                try {
                  setPreview(
                    previewEmployeeImport({
                      rows,
                      mapping,
                      company,
                      existing,
                      establishments,
                      models,
                    }),
                  );
                } catch (failure) {
                  setPreview(null);
                  setError(
                    failure instanceof Error
                      ? failure.message
                      : "Confira o mapeamento.",
                  );
                }
              }}
            >
              Conferir importação
            </button>
          </>
        )}
        {preview && (
          <div className="mt-5" aria-label="Prévia da importação">
            <p role="status">
              <strong>
                {preview.employees.length} válido(s) de {preview.total}
              </strong>{" "}
              · {preview.issues.length} pendência(s). Nada foi gravado nesta
              conferência.
            </p>
            {preview.issues.length > 0 && (
              <div className="banner mt-4">
                <div>
                  <strong>
                    Corrija os erros no arquivo e carregue-o novamente.
                  </strong>
                  <ul>
                    {preview.issues.slice(0, 50).map((issue, index) => (
                      <li key={index}>
                        Linha {issue.row} · {issue.field}: {issue.message}
                      </li>
                    ))}
                  </ul>
                  {preview.issues.length > 50 && (
                    <p>Mostrando os primeiros 50 erros.</p>
                  )}
                </div>
              </div>
            )}
            <div className="overflow-x-auto mt-4">
              <table className="w-full text-sm">
                <caption className="text-left">
                  Prévia dos primeiros 20 vínculos válidos
                </caption>
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Matrícula</th>
                    <th>Setor</th>
                    <th>Carga semanal</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.employees.slice(0, 20).map((employee) => (
                    <tr key={employee.id}>
                      <td>{employee.nome}</td>
                      <td>{employee.matricula || "—"}</td>
                      <td>{employee.setor || "—"}</td>
                      <td>
                        {contractDurationText(employee.carga_semanal_minutos) ||
                          "Revisar"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              className="button primary mt-5"
              type="button"
              disabled={
                locked ||
                preview.issues.length > 0 ||
                preview.employees.length === 0
              }
              onClick={async () => {
                setSaving(true);
                setError("");
                setMessage("");
                try {
                  // Recheck current context/duplicates immediately before invoking persistence.
                  let previewIndex = 0;
                  const checked = previewEmployeeImport({
                    rows,
                    mapping,
                    company,
                    existing,
                    establishments,
                    models,
                    makeId: () =>
                      preview.employees[previewIndex++]?.id ??
                      crypto.randomUUID(),
                  });
                  if (checked.issues.length) {
                    setPreview(checked);
                    throw new Error(
                      "O cadastro mudou. Confira as pendências antes de importar.",
                    );
                  }
                  await onImport(checked.employees);
                  setMessage(
                    `${checked.employees.length} funcionário(s) importado(s).`,
                  );
                  setRows([]);
                  setPreview(null);
                } catch (failure) {
                  setError(
                    failure instanceof Error
                      ? failure.message
                      : "Não foi possível concluir a importação.",
                  );
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving
                ? "Importando…"
                : `Confirmar importação de ${preview.employees.length} funcionário(s)`}
            </button>
          </div>
        )}
        {error && (
          <p className="field-error mt-4" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="muted mt-4" role="status">
            {message}
          </p>
        )}
      </div>
    </section>
  );
}
