"use client";
import { useId, useState } from "react";
import type { Company, Employee, Model, Establishment } from "@/lib/types";
import { formatCpf } from "@/lib/cpf";
import { modelsForCompany } from "@/lib/company-resources";

type CompanyDefaults = Company & {
  situacao?: "ativa" | "inativa" | "arquivada";
  carga_semanal_padrao_minutos?: number | null;
  modelo_padrao_id?: string | null;
};
type EmployeeSettings = Employee & {
  matricula?: string;
  setor?: string;
  admissao?: string | null;
  situacao?: "ativo" | "inativo";
  modelo_padrao_id?: string | null;
  carga_diaria_minutos?: number | null;
  regras_especiais?: string;
};
export type EmployeeFieldsProps = {
  employee?: EmployeeSettings;
  companies: CompanyDefaults[];
  models: Model[];
  companyId?: string;
  establishments?: Establishment[];
};
const days = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
];
const hours = (minutes?: number | null) =>
  typeof minutes === "number" ? String(minutes / 60) : "";

/** Company and individual defaults are initial values, never bulk updates. */
export default function EmployeeFields({
  employee,
  companies,
  models,
  companyId,
  establishments = [],
}: EmployeeFieldsProps) {
  const id = useId();
  const fixedCompany = employee?.empresa_id ?? companyId;
  const [selectedCompany, setSelectedCompany] = useState(
    fixedCompany ??
      companies.find(
        (company) => !company.situacao || company.situacao === "ativa",
      )?.id ??
      "",
  );
  const company = companies.find((item) => item.id === selectedCompany);
  const [selectedUnit, setSelectedUnit] = useState(
    employee?.estabelecimento_id ?? "",
  );
  const [selectedModel, setSelectedModel] = useState(
    employee?.modelo_padrao_id ?? "",
  );
  const [weeklyHours, setWeeklyHours] = useState(() =>
    hours(
      employee
        ? employee.carga_semanal_minutos
        : company?.carga_semanal_padrao_minutos,
    ),
  );
  const [weeklyTouched, setWeeklyTouched] = useState(false);
  const availableModels = modelsForCompany(models, selectedCompany, [
    employee?.modelo_padrao_id,
    company?.modelo_padrao_id,
  ]);
  const companyModel = availableModels.find(
    (model) => model.id === company?.modelo_padrao_id,
  );
  return (
    <>
      <label htmlFor={`${id}-company`}>
        Empresa
        <select
          id={`${id}-company`}
          name={fixedCompany ? undefined : "empresa_id"}
          required
          disabled={Boolean(fixedCompany)}
          value={selectedCompany}
          aria-describedby={employee ? `${id}-company-note` : undefined}
          onChange={(event) => {
            const nextId = event.target.value;
            setSelectedCompany(nextId);
            setSelectedUnit("");
            setSelectedModel("");
            if (!weeklyTouched)
              setWeeklyHours(
                hours(
                  companies.find((item) => item.id === nextId)
                    ?.carga_semanal_padrao_minutos,
                ),
              );
          }}
        >
          <option value="">Selecione uma empresa</option>
          {companies
            .filter(
              (item) =>
                item.id === selectedCompany ||
                !item.situacao ||
                item.situacao === "ativa",
            )
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.nome}
              </option>
            ))}
        </select>
        {fixedCompany && (
          <input type="hidden" name="empresa_id" value={selectedCompany} />
        )}
      </label>
      <label htmlFor={`${id}-establishment`}>
        Estabelecimento (opcional)
        <select
          id={`${id}-establishment`}
          name="estabelecimento_id"
          value={selectedUnit}
          onChange={(event) => setSelectedUnit(event.target.value)}
        >
          <option value="">Localidade principal da empresa</option>
          {establishments
            .filter(
              (unit) =>
                unit.empresa_id === selectedCompany &&
                (unit.ativo || unit.id === selectedUnit),
            )
            .map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.nome} · {unit.cidade}/{unit.uf}
                {unit.ativo ? "" : " (inativo)"}
              </option>
            ))}
        </select>
      </label>
      <label htmlFor={`${id}-name`}>
        Nome do funcionário
        <input
          id={`${id}-name`}
          name="nome"
          required
          maxLength={160}
          defaultValue={employee?.nome ?? ""}
          autoComplete="off"
        />
      </label>
      <label htmlFor={`${id}-cpf`}>
        CPF (opcional)
        <input
          id={`${id}-cpf`}
          name="cpf"
          inputMode="numeric"
          maxLength={14}
          pattern="[0-9]{11}|[0-9]{3}[.][0-9]{3}[.][0-9]{3}-[0-9]{2}"
          title="Informe 11 dígitos ou use o formato 000.000.000-00."
          placeholder="000.000.000-00"
          defaultValue={
            employee?.cpf?.replace(/\D/g, "").length === 11
              ? formatCpf(employee.cpf)
              : (employee?.cpf ?? "")
          }
          autoComplete="off"
        />
      </label>
      {employee && (
        <p id={`${id}-company-note`} className="span2 muted">
          O vínculo permanece nesta empresa. A transferência com preservação do
          histórico exige um processo próprio e não é feita alterando este
          campo.
        </p>
      )}
      <label htmlFor={`${id}-registration`}>
        Matrícula / identificador interno
        <input
          id={`${id}-registration`}
          name="matricula"
          maxLength={64}
          defaultValue={employee?.matricula ?? ""}
        />
      </label>
      <label htmlFor={`${id}-department`}>
        Setor / departamento
        <input
          id={`${id}-department`}
          name="setor"
          maxLength={100}
          defaultValue={employee?.setor ?? ""}
        />
      </label>
      <label htmlFor={`${id}-role`}>
        Cargo
        <input
          id={`${id}-role`}
          name="cargo"
          maxLength={120}
          defaultValue={employee?.cargo ?? ""}
        />
      </label>
      <label htmlFor={`${id}-admission`}>
        Data de admissão
        <input
          id={`${id}-admission`}
          name="admissao"
          type="date"
          defaultValue={employee?.admissao ?? ""}
        />
      </label>
      <label htmlFor={`${id}-status`}>
        Situação do vínculo
        <select
          id={`${id}-status`}
          name="situacao"
          defaultValue={employee?.situacao ?? "ativo"}
        >
          <option value="ativo">Ativo</option>
          <option value="inativo">Inativo</option>
        </select>
      </label>
      <label htmlFor={`${id}-model`}>
        Modelo individual de jornada
        <select
          id={`${id}-model`}
          name="modelo_padrao_id"
          value={selectedModel}
          onChange={(event) => setSelectedModel(event.target.value)}
        >
          <option value="">Herdar padrão da empresa</option>
          {availableModels.map((model) => (
            <option
              key={model.id}
              value={model.id}
              disabled={
                !model.empresa_id && model.id !== employee?.modelo_padrao_id
              }
            >
              {model.nome}
              {model.empresa_id ? "" : " · biblioteca vinculada (legado)"}
              {model.tipo === "6x1" && !company?.permite_6x1
                ? " — depende de autorização da empresa"
                : ""}
            </option>
          ))}
        </select>
      </label>
      <p className="span2 muted">
        Padrão atual da empresa: {companyModel?.nome ?? "não definido"}. Um
        modelo individual tem prioridade. Trocar o padrão da empresa não
        modifica jornadas individuais nem escalas já salvas. Para vincular um
        modelo-base novo, copie-o primeiro em Jornadas e modelos da empresa.
      </p>
      <label htmlFor={`${id}-daily`}>
        Carga diária contratual (horas)
        <input
          id={`${id}-daily`}
          name="carga_diaria"
          type="number"
          min={1 / 60}
          max="24"
          step="any"
          defaultValue={hours(employee?.carga_diaria_minutos)}
          placeholder="Ex.: 6 ou 8,4"
        />
      </label>
      <label htmlFor={`${id}-weekly`}>
        Carga semanal contratual (horas)
        <input
          id={`${id}-weekly`}
          name="carga_semanal"
          type="number"
          min={1 / 60}
          max="168"
          step="any"
          value={weeklyHours}
          onChange={(event) => {
            setWeeklyTouched(true);
            setWeeklyHours(event.target.value);
          }}
          placeholder="Ex.: 30 ou 30,5"
        />
        <small className="muted">
          Deixe vazio se depender de revisão. 30,5 horas = 30h30. O padrão da
          empresa só preenche novos cadastros.
        </small>
      </label>
      <label className="span2" htmlFor={`${id}-contract`}>
        Horário contratual / observações
        <input
          id={`${id}-contract`}
          name="horario"
          maxLength={1000}
          placeholder="Informações complementares do contrato"
          defaultValue={employee?.horario_contratual ?? ""}
        />
      </label>
      <fieldset className="span2 employee-rest-fields">
        <legend>Dias de descanso contratuais</legend>
        <div className="actions">
          {days.map((day, index) => (
            <label key={day} className="check-label">
              <input
                type="checkbox"
                name="descanso"
                value={index}
                defaultChecked={(employee?.dias_descanso ?? [0, 6]).includes(
                  index,
                )}
              />
              {day}
            </label>
          ))}
        </div>
        <p className="muted">
          Os dias habituais de trabalho são os demais dias da semana. A geração
          confere divergências; o cadastro não altera escalas existentes.
        </p>
      </fieldset>
      <label className="span2" htmlFor={`${id}-special`}>
        Regras especiais / fundamento contratual
        <textarea
          id={`${id}-special`}
          name="regras_especiais"
          maxLength={4000}
          defaultValue={employee?.regras_especiais ?? ""}
          placeholder="Registre regras específicas e o instrumento aplicável para conferência."
        />
      </label>
    </>
  );
}
