"use client";

import { useId, useState } from "react";
import { MapPin, Plus, Trash2 } from "lucide-react";
import { dateUTC, formatMinutes } from "@/lib/engine";
import { categoryLabels, specialDateMatchesDate } from "@/lib/special-dates";
import { shiftEditorText, validateShiftText } from "@/lib/shift-editor";
import type {
  Company,
  Employee,
  Establishment,
  SpecialDate,
  SpecialDateCategory,
} from "@/lib/types";

const attendanceLabels: Record<SpecialDate["expediente"], string> = {
  sem_expediente: "Sem expediente",
  normal: "Expediente normal",
  reduzido: "Expediente reduzido",
  individual: "Configuração individual por funcionário",
};
const recurrenceLabels: Record<SpecialDate["recorrencia"], string> = {
  unica: "Somente no ano selecionado",
  anual: "Repetir anualmente",
  periodo: "Período determinado",
};
const dateLabel = (value: string) =>
  dateUTC(value).toLocaleDateString("pt-BR", { timeZone: "UTC" });
const movableName = (value: string) =>
  /carnaval|sexta.?feira santa|paixao|corpus christi|pascoa|quarta.?feira de cinzas/.test(
    value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR"),
  );

function visibleInPeriod(
  event: SpecialDate,
  reference: string,
  filter: string,
) {
  if (filter === "todas") return true;
  const year = Number(reference.slice(0, 4));
  if (!Number.isInteger(year) || year < 1 || year > 9999) return false;
  const start =
    filter === "ano" ? `${reference.slice(0, 4)}-01-01` : `${reference}-01`;
  const endDate = dateUTC(start);
  if (!Number.isFinite(+endDate)) return false;
  if (filter === "ano") endDate.setUTCFullYear(year + 1);
  else endDate.setUTCMonth(endDate.getUTCMonth() + 1);
  // A month/year contains at most 366 civil dates, including recurring ranges.
  for (
    const cursor = dateUTC(start);
    cursor < endDate;
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  )
    if (specialDateMatchesDate(event, cursor.toISOString().slice(0, 10)))
      return true;
  return false;
}

export default function SpecialDates({
  company,
  employees,
  events,
  establishments,
  month,
  busy = false,
  onEdit,
  onDelete,
}: {
  company: Company;
  employees: Employee[];
  events: SpecialDate[];
  establishments: Establishment[];
  month: string;
  busy?: boolean;
  onEdit: (event?: SpecialDate) => void;
  onDelete: (event: SpecialDate) => void;
}) {
  const [filter, setFilter] = useState("mes");
  const [reference, setReference] = useState(month.slice(0, 7));
  const [status, setStatus] = useState("todos");
  const ownEmployees = employees.filter(
    (employee) => employee.empresa_id === company.id,
  );
  const ownUnits = establishments.filter(
    (unit) => unit.empresa_id === company.id,
  );
  const locked = busy || (company.situacao ?? "ativa") !== "ativa";
  const visible = events
    .filter((event) => event.empresa_id === company.id)
    .filter(
      (event) => status === "todos" || event.ativo === (status === "ativas"),
    )
    .filter((event) => visibleInPeriod(event, reference, filter))
    .sort(
      (a, b) =>
        a.data_inicio.localeCompare(b.data_inicio) ||
        a.nome.localeCompare(b.nome),
    );
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">CALENDÁRIO DA EMPRESA</div>
          <h1>Feriados e datas especiais</h1>
          <p className="subtitle">
            Organize o calendário de {company.nome}, com decisões próprias de
            expediente e exceções por funcionário.
          </p>
        </div>
        <button
          className="button primary"
          disabled={locked}
          onClick={() => onEdit()}
        >
          <Plus size={16} aria-hidden="true" /> Nova data especial
        </button>
      </div>
      <section className="panel mb-6" aria-label="Filtros das datas especiais">
        <div className="panel-body form-grid">
          <label>
            Período das datas especiais
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            >
              <option value="mes">Mês selecionado</option>
              <option value="ano">Ano selecionado</option>
              <option value="todas">Todas as datas</option>
            </select>
          </label>
          {filter !== "todas" && (
            <label>
              {filter === "mes" ? "Mês do calendário" : "Ano do calendário"}
              {filter === "mes" ? (
                <input
                  type="month"
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                />
              ) : (
                <input
                  type="number"
                  min={1}
                  max={9999}
                  value={reference.slice(0, 4)}
                  onChange={(event) => setReference(`${event.target.value}-01`)}
                />
              )}
            </label>
          )}
          <label>
            Situação das datas especiais
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="todos">Todas as situações</option>
              <option value="ativas">Ativas</option>
              <option value="inativas">Inativas</option>
            </select>
          </label>
        </div>
      </section>
      <section aria-label="Datas especiais cadastradas">
        {visible.length ? (
          <div className="grid2">
            {visible.map((event) => {
              const unit = ownUnits.find(
                (entry) => entry.id === event.estabelecimento_id,
              );
              const names = ownEmployees
                .filter((employee) =>
                  event.funcionario_ids.includes(employee.id),
                )
                .map((employee) => employee.nome);
              return (
                <article
                  className="panel"
                  key={event.id}
                  aria-label={event.nome}
                >
                  <div className="panel-head">
                    <h3>{event.nome}</h3>
                    <span className={`pill ${event.ativo ? "" : "warn"}`}>
                      {event.ativo ? "Ativa" : "Inativa"}
                    </span>
                  </div>
                  <div className="panel-body">
                    <p>
                      <strong>{categoryLabels[event.categoria]}</strong>
                    </p>
                    <p className="subtitle !mt-1">
                      {dateLabel(event.data_inicio)}
                      {event.data_fim && event.data_fim !== event.data_inicio
                        ? ` a ${dateLabel(event.data_fim)}`
                        : ""}
                      {" · "}
                      {recurrenceLabels[event.recorrencia]}
                    </p>
                    <dl className="grid gap-2 mt-4 text-sm">
                      <div>
                        <dt className="muted">Expediente</dt>
                        <dd>{attendanceLabels[event.expediente]}</dd>
                      </div>
                      <div>
                        <dt className="muted">Abrangência</dt>
                        <dd>
                          {event.alcance === "empresa"
                            ? "Todos os funcionários da empresa"
                            : names.join(", ") || "Funcionário indisponível"}
                        </dd>
                      </div>
                      <div>
                        <dt className="muted">Localidade</dt>
                        <dd>
                          {unit
                            ? `${unit.nome} · ${unit.cidade} / ${unit.uf}`
                            : event.cidade || event.uf
                              ? [event.cidade, event.uf]
                                  .filter(Boolean)
                                  .join(" / ")
                              : "Empresa e seus estabelecimentos"}
                        </dd>
                      </div>
                    </dl>
                    {event.expediente === "reduzido" && (
                      <p className="subtitle">
                        Horários: {shiftEditorText(event.intervalos)}
                      </p>
                    )}
                    {event.observacoes && (
                      <p className="subtitle whitespace-pre-wrap">
                        {event.observacoes}
                      </p>
                    )}
                    <div className="actions mt-5">
                      <button
                        className="button small"
                        disabled={locked}
                        onClick={() => onEdit(event)}
                      >
                        Editar data especial
                      </button>
                      <button
                        className="button small danger"
                        disabled={locked}
                        onClick={() => onDelete(event)}
                      >
                        <Trash2 size={13} aria-hidden="true" /> Excluir data
                        especial
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="panel empty">
            Nenhuma data especial encontrada para este período e situação.
          </div>
        )}
      </section>
      <div className="banner neutral mt-6">
        <MapPin size={18} aria-hidden="true" />
        <p>
          Os eventos pertencem a esta empresa. Feriados oficiais consideram a
          localidade do funcionário; pontos facultativos só dispensam o
          expediente quando essa decisão estiver configurada. Alterações
          individuais da escala permanecem preservadas.
        </p>
      </div>
    </>
  );
}

export function SpecialDateFields({
  company,
  employees,
  establishments,
  event,
  month,
}: {
  company: Company;
  employees: Employee[];
  establishments: Establishment[];
  event?: SpecialDate;
  month: string;
}) {
  const id = useId();
  const [name, setName] = useState(event?.nome ?? "");
  const [category, setCategory] = useState<SpecialDateCategory>(
    event?.categoria ?? "feriado_especifico",
  );
  const [start, setStart] = useState(
    event?.data_inicio ?? `${month.slice(0, 7)}-01`,
  );
  const [end, setEnd] = useState(event?.data_fim ?? "");
  const [recurrence, setRecurrence] = useState<SpecialDate["recorrencia"]>(
    event?.recorrencia ?? "unica",
  );
  const [audience, setAudience] = useState<SpecialDate["alcance"]>(
    event?.alcance ?? "empresa",
  );
  const [selected, setSelected] = useState(event?.funcionario_ids ?? []);
  const [unitId, setUnitId] = useState(event?.estabelecimento_id ?? "");
  const [attendance, setAttendance] = useState<SpecialDate["expediente"]>(
    event?.expediente ?? "sem_expediente",
  );
  const [raw, setRaw] = useState(() =>
    shiftEditorText(event?.intervalos ?? []),
  );
  const [mobile, setMobile] = useState(event?.data_movel ?? false);
  const [uf, setUf] = useState(event?.uf ?? company.uf);
  const [city, setCity] = useState(event?.cidade ?? company.cidade);
  const annualBlocked = mobile || movableName(name);
  const ownUnits = establishments.filter(
    (unit) => unit.empresa_id === company.id,
  );
  const candidates = employees.filter(
    (employee) =>
      employee.empresa_id === company.id &&
      (!unitId || employee.estabelecimento_id === unitId),
  );
  const shifts = validateShiftText(raw);
  const shiftError =
    attendance === "reduzido"
      ? (shifts.errors.intervals ??
        (shifts.shifts?.length
          ? ""
          : "Informe os horários do expediente reduzido."))
      : "";
  return (
    <>
      <p className="span2 muted">
        Empresa: <strong>{company.nome}</strong>. O evento será exclusivo deste
        ambiente.
      </p>
      <input type="hidden" name="empresa_id" value={company.id} />
      <input
        type="hidden"
        name="funcionario_ids"
        value={JSON.stringify(
          audience === "empresa" ? [] : [...selected].sort(),
        )}
      />
      <input
        type="hidden"
        name="intervalos"
        value={JSON.stringify(
          attendance === "reduzido" ? (shifts.shifts ?? []) : [],
        )}
      />
      <input type="hidden" name="expediente" value={attendance} />
      <label className="span2">
        Nome da data especial
        <input
          name="nome"
          required
          maxLength={160}
          value={name}
          onChange={(change) => {
            setName(change.target.value);
            if (movableName(change.target.value) && recurrence === "anual")
              setRecurrence("unica");
          }}
        />
      </label>
      <label>
        Categoria do evento
        <select
          name="categoria"
          value={category}
          onChange={(change) => {
            const next = change.target.value as SpecialDateCategory;
            setCategory(next);
            setAttendance(
              next === "ponto_facultativo" ? "normal" : "sem_expediente",
            );
          }}
        >
          {Object.entries(categoryLabels).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Recorrência
        <select
          name="recorrencia"
          value={recurrence}
          onChange={(change) =>
            setRecurrence(change.target.value as SpecialDate["recorrencia"])
          }
        >
          {Object.entries(recurrenceLabels).map(([key, label]) => (
            <option
              key={key}
              value={key}
              disabled={key === "anual" && annualBlocked}
            >
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Data inicial
        <input
          name="data_inicio"
          type="date"
          required
          value={start}
          onChange={(change) => setStart(change.target.value)}
        />
      </label>
      {recurrence !== "unica" ? (
        <label>
          {recurrence === "periodo" ? "Data final" : "Data final (opcional)"}
          <input
            name="data_fim"
            type="date"
            required={recurrence === "periodo"}
            min={recurrence === "periodo" ? start : undefined}
            value={end}
            onChange={(change) => setEnd(change.target.value)}
          />
        </label>
      ) : (
        <input type="hidden" name="data_fim" value="" />
      )}
      <label className="check-label span2">
        <input
          name="data_movel"
          type="checkbox"
          checked={mobile}
          onChange={(change) => {
            setMobile(change.target.checked);
            if (change.target.checked && recurrence === "anual")
              setRecurrence("unica");
          }}
        />
        Data móvel, definida novamente a cada ano
      </label>
      <p className="span2 muted">
        {annualBlocked
          ? "Datas móveis não se repetem por dia e mês. Cadastre a data correta em cada ano."
          : "A recorrência anual repete somente as datas fixas cadastradas. Em intervalos que atravessam o ano, informe também a data final."}
      </p>
      <label>
        Estabelecimento (opcional)
        <select
          name="estabelecimento_id"
          value={unitId}
          onChange={(change) => {
            const next = change.target.value;
            setUnitId(next);
            setSelected((current) =>
              current.filter((employeeId) =>
                employees.some(
                  (employee) =>
                    employee.id === employeeId &&
                    employee.empresa_id === company.id &&
                    (!next || employee.estabelecimento_id === next),
                ),
              ),
            );
            const unit = ownUnits.find((item) => item.id === next);
            setUf(unit?.uf ?? company.uf);
            setCity(unit?.cidade ?? company.cidade);
          }}
        >
          <option value="">Empresa e seus estabelecimentos</option>
          {ownUnits.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.nome} · {unit.cidade} / {unit.uf}
              {unit.ativo ? "" : " (inativo)"}
            </option>
          ))}
        </select>
      </label>
      <label>
        Abrangência dos funcionários
        <select
          name="alcance"
          value={audience}
          onChange={(change) => {
            const next = change.target.value as SpecialDate["alcance"];
            setAudience(next);
            if (next === "empresa") setSelected([]);
            else if (next === "funcionario")
              setSelected((current) => current.slice(0, 1));
          }}
        >
          <option value="empresa">Todos os funcionários da empresa</option>
          <option value="selecionados">Funcionários selecionados</option>
          <option value="funcionario">Apenas um funcionário</option>
        </select>
      </label>
      {audience === "funcionario" && (
        <label className="span2">
          Funcionário abrangido
          <select
            name="funcionario_id"
            required
            value={selected[0] ?? ""}
            onChange={(change) =>
              setSelected(change.target.value ? [change.target.value] : [])
            }
          >
            <option value="">Selecione um funcionário</option>
            {candidates.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.nome}
                {employee.situacao === "inativo" ? " (inativo)" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      {audience === "selecionados" && (
        <fieldset
          className="span2 rounded-lg bg-[#f1f6fc] p-4"
          aria-describedby={`${id}-audience-help`}
        >
          <legend className="font-semibold">Funcionários abrangidos</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
            {candidates.map((employee) => (
              <label className="check-label" key={employee.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(employee.id)}
                  onChange={(change) =>
                    setSelected((current) =>
                      change.target.checked
                        ? [...current, employee.id]
                        : current.filter((value) => value !== employee.id),
                    )
                  }
                />
                {employee.nome}
                {employee.situacao === "inativo" ? " (inativo)" : ""}
              </label>
            ))}
          </div>
          <p className="muted mt-2" id={`${id}-audience-help`}>
            {candidates.length
              ? `${selected.length} funcionário(s) selecionado(s). Escolha ao menos um.`
              : "Nenhum funcionário disponível neste estabelecimento."}
          </p>
        </fieldset>
      )}
      {(category === "feriado_estadual" ||
        category === "feriado_municipal") && (
        <label>
          UF do feriado
          <input
            name="uf"
            required
            pattern="[A-Za-z]{2}"
            maxLength={2}
            value={uf}
            onChange={(change) => setUf(change.target.value.toUpperCase())}
          />
        </label>
      )}
      {category === "feriado_municipal" && (
        <label>
          Município do feriado
          <input
            name="cidade"
            required
            maxLength={100}
            value={city}
            onChange={(change) => setCity(change.target.value)}
          />
        </label>
      )}
      <label className="span2">
        Situação do expediente
        <select
          value={attendance}
          disabled={category === "sem_expediente"}
          onChange={(change) =>
            setAttendance(change.target.value as SpecialDate["expediente"])
          }
        >
          {Object.entries(attendanceLabels).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {attendance === "reduzido" && (
        <div className="span2">
          <label htmlFor={`${id}-reduced`}>
            Horários do expediente reduzido
          </label>
          <input
            id={`${id}-reduced`}
            name="horarios_reduzidos"
            required
            value={raw}
            placeholder="08:00-12:00, 13:00-15:00"
            ref={(node) => node?.setCustomValidity(shiftError)}
            onChange={(change) => setRaw(change.target.value)}
            aria-invalid={Boolean(shiftError)}
            aria-describedby={`${id}-reduced-help${shiftError ? ` ${id}-reduced-error` : ""}`}
          />
          <span className="muted" id={`${id}-reduced-help`}>
            Use +1 para o dia seguinte. Horários existentes de folga não se
            tornam trabalho automaticamente.
          </span>
          {shiftError ? (
            <span
              className="field-error"
              id={`${id}-reduced-error`}
              role="alert"
            >
              {shiftError}
            </span>
          ) : (
            <span className="muted">
              Jornada reduzida: {formatMinutes(shifts.worked)}.
            </span>
          )}
        </div>
      )}
      {attendance === "individual" && (
        <p className="span2 warning-text">
          A programação atual é preservada. Defina o expediente de cada
          funcionário em Editar dia da escala.
        </p>
      )}
      <label className="span2">
        Observações / justificativa
        <textarea
          name="observacoes"
          maxLength={2000}
          defaultValue={event?.observacoes ?? ""}
        />
      </label>
      <label className="check-label span2">
        <input
          name="ativo"
          type="checkbox"
          defaultChecked={event?.ativo ?? true}
        />{" "}
        Data especial ativa
      </label>
      <p className="span2 muted">
        Recesso e dispensa de expediente não aplicam férias, falta, desconto,
        banco de horas ou pagamento adicional automaticamente.
      </p>
      <p className="span2 muted">
        Dias sem expediente interrompem continuações de plantões à meia-noite.
        Para manter trabalho após meia-noite, cadastre exceção individual também
        na data seguinte.
      </p>
    </>
  );
}

export function EstablishmentFields({
  company,
  establishment,
}: {
  company: Company;
  establishment?: Establishment;
}) {
  return (
    <>
      <p className="span2 muted">
        Empresa: <strong>{company.nome}</strong>. Estabelecimentos são
        opcionais; funcionários sem vínculo usam a localidade principal.
      </p>
      <input type="hidden" name="empresa_id" value={company.id} />
      <label className="span2">
        Nome do estabelecimento
        <input
          name="nome"
          required
          maxLength={160}
          defaultValue={establishment?.nome ?? ""}
        />
      </label>
      <label>
        Município do estabelecimento
        <input
          name="cidade"
          required
          maxLength={100}
          defaultValue={establishment?.cidade ?? company.cidade}
        />
      </label>
      <label>
        UF do estabelecimento
        <input
          name="uf"
          required
          pattern="[A-Za-z]{2}"
          maxLength={2}
          defaultValue={establishment?.uf ?? company.uf}
        />
      </label>
      <label className="check-label span2">
        <input
          name="ativo"
          type="checkbox"
          defaultChecked={establishment?.ativo ?? true}
        />{" "}
        Estabelecimento ativo
      </label>
    </>
  );
}

export function EstablishmentsPanel({
  company,
  establishments,
  onEdit,
  busy = false,
}: {
  company: Company;
  establishments: Establishment[];
  onEdit: (unit?: Establishment) => void;
  busy?: boolean;
}) {
  const own = establishments.filter((unit) => unit.empresa_id === company.id);
  const locked = busy || (company.situacao ?? "ativa") !== "ativa";
  return (
    <section className="panel mt-6" aria-label="Estabelecimentos e localidades">
      <div className="panel-head">
        <h2>Estabelecimentos e localidades</h2>
        <button
          className="button small"
          disabled={locked}
          onClick={() => onEdit()}
        >
          <Plus size={14} aria-hidden="true" /> Novo estabelecimento
        </button>
      </div>
      <div className="panel-body">
        <p>
          <strong>Localidade principal:</strong>{" "}
          {[company.cidade, company.uf].filter(Boolean).join(" / ") ||
            "Não informada"}
        </p>
        <p className="subtitle">
          Cadastre unidades somente quando precisarem de calendário próprio.
          Vincule o funcionário ao estabelecimento no cadastro individual.
        </p>
        {own.length ? (
          <div className="grid gap-4 mt-5">
            {own.map((unit) => (
              <article
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#d9e5f2] p-4"
                key={unit.id}
                aria-label={unit.nome}
              >
                <div>
                  <h3>{unit.nome}</h3>
                  <p className="muted">
                    {unit.cidade} / {unit.uf} ·{" "}
                    {unit.ativo ? "Ativo" : "Inativo"}
                  </p>
                </div>
                <button
                  className="button small"
                  disabled={locked}
                  onClick={() => onEdit(unit)}
                >
                  Editar estabelecimento
                </button>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted mt-4">
            Nenhum estabelecimento adicional. A localidade principal continua
            disponível para toda a empresa.
          </p>
        )}
      </div>
    </section>
  );
}
