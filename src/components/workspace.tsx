"use client";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  CalendarDays,
  LayoutDashboard,
  Building2,
  Users,
  Clock3,
  SlidersHorizontal,
  Flag,
  LogOut,
  Plus,
  ArrowUpRight,
  ArrowRight,
  ChevronRight,
  ChevronLeft,
  Copy,
  Download,
  FileSpreadsheet,
  FileText,
  ShieldCheck,
  AlertTriangle,
  X,
  Menu,
  Check,
  RefreshCw,
  BookOpen,
  History,
  LoaderCircle,
} from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import {
  emptyData,
  importDefaults,
  importHolidays,
  loadData,
  loadCompanyLogs,
  type AuditLog,
  saveRow,
  saveSchedules,
  type Data,
} from "@/lib/store";
import {
  addDays,
  computeDay,
  dateUTC,
  dominioText,
  duplicateDays,
  evaluate,
  formatMinutes,
  generateDays,
  minutes,
  monthDates,
  span,
} from "@/lib/engine";
import type {
  Company,
  Day,
  Employee,
  LegalRule,
  Model,
  Schedule,
  Shift,
  WeekPattern,
} from "@/lib/types";
import { contractMinutesFromHours } from "@/lib/contract";
import { demoData } from "@/lib/demo";
import LegalFields from "./legal-fields";
import CompanyDirectory from "./company-directory";
import CompanyAdmin, { type CompanyView } from "./company-admin";
import CompanyFields from "./company-fields";
import AuditHistory from "./audit-history";
import { EmployeeDirectory, EmployeeDetails } from "./employee-admin";
import EmployeeFields from "./employee-fields";
import { scopeCompanyData, resolveEmployeeModel } from "@/lib/company-context";
import DayEditor from "./day-editor";
import ScheduleAlerts from "./schedule-alerts";
import { alertsForDate, buildAlertSummary } from "@/lib/alerts";
import { exportCSV, exportExcel, exportPDF } from "@/lib/exports";
import Brand from "./brand";

type Page =
  | "inicio"
  | "escalas"
  | "empresas"
  | "funcionarios"
  | "modelos"
  | "feriados"
  | "regras"
  | "historico"
  | "company-overview"
  | "company-settings"
  | "employee-detail";
type Modal = {
  kind: "empresa" | "funcionario" | "modelo" | "feriado" | "regra" | "dia";
  row?: Record<string, unknown>;
};
const nav = [
  ["inicio", "Visão geral", LayoutDashboard],
  ["escalas", "Escalas mensais", CalendarDays],
  ["empresas", "Empresas", Building2],
  ["funcionarios", "Funcionários", Users],
  ["modelos", "Modelos de jornada", Clock3],
  ["feriados", "Feriados", Flag],
  ["regras", "Parâmetros legais", SlidersHorizontal],
  ["historico", "Histórico", History],
] as const;
const dayNames = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
];
const dateLabel = (s: string) =>
  dateUTC(s).toLocaleDateString("pt-BR", { timeZone: "UTC" });
const monthLabel = (s: string) =>
  dateUTC(`${s.slice(0, 7)}-01`).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
const nextMonth = (s: string) => {
  const d = dateUTC(`${s.slice(0, 7)}-01`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 7);
};
const pick = (fd: FormData, name: string) => String(fd.get(name) ?? "").trim();
function parseShifts(value: string): Shift[] {
  if (!value.trim()) return [];
  const shifts: Shift[] = [];
  for (const part of value.split(",")) {
    const match = part
      .trim()
      .match(/^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})(?:\s*\+(1))?$/);
    if (!match)
      throw new Error(
        "Use 08:00-12:00, 13:00-17:24. Para turnos noturnos, informe os períodos em ordem, como 22:00-02:00 +1, 03:00-05:00 +1.",
      );
    const previous = shifts.at(-1);
    const startDay =
      previous && ((previous.startDay ?? 0) === 1 || match[1] < previous.start)
        ? 1
        : 0;
    const shift: Shift = {
      start: match[1],
      end: match[2],
      ...(startDay ? { startDay } : {}),
      ...(match[3] ? { endDay: 1 } : {}),
    };
    span(shift);
    shifts.push(shift);
  }
  return shifts;
}
const shiftText = (s: Shift[]) =>
  s
    .map((i) => `${i.start}-${i.end}${span(i)[1] >= 1440 ? " +1" : ""}`)
    .join(", ");
function cnpjValid(value: string) {
  const n = value.replace(/\D/g, "");
  if (n.length !== 14 || /^(\d)\1+$/.test(n)) return false;
  const digit = (base: string) => {
    let weight = base.length - 7;
    const sum = base.split("").reduce((s, c) => {
      const v = s + Number(c) * weight;
      weight = weight === 2 ? 9 : weight - 1;
      return v;
    }, 0);
    return sum % 11 < 2 ? 0 : 11 - (sum % 11);
  };
  return digit(n.slice(0, 12)) === +n[12] && digit(n.slice(0, 13)) === +n[13];
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label>
      {label}
      {children}
    </label>
  );
}
function Empty({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <CalendarDays size={30} />
      <p>{text}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
function Stat({
  label,
  value,
  note,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  note: string;
  icon: typeof Users;
}) {
  return (
    <div className="stat">
      <div className="stat-top">
        {label}
        <span className="stat-icon">
          <Icon size={16} />
        </span>
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-foot">{note}</div>
    </div>
  );
}
function Dialog({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const old = document.activeElement as HTMLElement;
    const focusable = () =>
      Array.from(
        el.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[href],[tabindex="0"]',
        ) ?? [],
      ).filter((element) => element.getClientRects().length > 0);
    focusable()[0]?.focus();
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab") {
        const elements = focusable();
        if (!elements.length) return;
        const first = elements[0],
          last = elements[elements.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
        if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handle);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handle);
      document.body.style.overflow = overflow;
      old?.focus();
    };
  }, []);
  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        ref={el}
      >
        <div className="dialog-head">
          <h2 id="dialog-title">{title}</h2>
          <button className="icon-button" aria-label="Fechar" onClick={close}>
            <X size={20} />
          </button>
        </div>
        <div className="dialog-body">{children}</div>
      </div>
    </div>
  );
}

export default function Workspace() {
  const authUserId = useRef<string | null>(null);
  const [user, setUser] = useState<User | null>(null),
    [demo, setDemo] = useState(false),
    [authReady, setAuthReady] = useState(false),
    [page, setPage] = useState<Page>("inicio"),
    [data, setData] = useState<Data>(emptyData),
    [busy, setBusy] = useState(false),
    [mobile, setMobile] = useState(false),
    [toast, setToast] = useState<{ text: string; error?: boolean } | null>(
      null,
    ),
    [modal, setModal] = useState<Modal | null>(null),
    [authMode, setAuthMode] = useState<
      "login" | "signup" | "reset" | "password"
    >("login");
  const [companyId, setCompanyId] = useState(""),
    [employeeId, setEmployeeId] = useState(""),
    [modelId, setModelId] = useState(""),
    [month, setMonth] = useState(
      new Intl.DateTimeFormat("sv-SE", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
      }).format(new Date()),
    ),
    [draft, setDraft] = useState<Schedule | null>(null),
    [restHoliday, setRestHoliday] = useState(true),
    [dirty, setDirty] = useState(false);
  const [editedDay, setEditedDay] = useState<Day | null>(null);
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const operationPending = useRef(false);
  const [companyScopeId, setCompanyScopeId] = useState<string | null>(null);
  const [detailEmployeeId, setDetailEmployeeId] = useState<string | null>(null);
  const [companyAudit, setCompanyAudit] = useState<{
    companyId: string;
    logs: AuditLog[];
    loading: boolean;
    hasMore: boolean;
    error?: string;
  }>({ companyId: "", logs: [], loading: false, hasMore: false });
  useEffect(() => {
    if (!companyScopeId || demo || !user) return;
    const target = companyScopeId;
    let alive = true;
    setCompanyAudit({
      companyId: target,
      logs: [],
      loading: true,
      hasMore: false,
    });
    loadCompanyLogs(target)
      .then((logs) => {
        if (alive)
          setCompanyAudit({
            companyId: target,
            logs,
            loading: false,
            hasMore: logs.length === 100,
          });
      })
      .catch((error) => {
        if (alive)
          setCompanyAudit({
            companyId: target,
            logs: [],
            loading: false,
            hasMore: false,
            error: error.message,
          });
      });
    return () => {
      alive = false;
    };
  }, [companyScopeId, demo, user?.id, data.logs]);
  const [confirmation, setConfirmation] = useState<{
    title: string;
    message: string;
    accept: () => void;
  } | null>(null);
  const notify = (text: string, error = false) => setToast({ text, error });
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 9000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!supabase) {
      setAuthReady(true);
      return;
    }
    let alive = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (alive) {
        authUserId.current = data.session?.user.id ?? null;
        setUser(data.session?.user ?? null);
        setAuthReady(true);
        if (error) setToast({ text: error.message, error: true });
      }
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (authUserId.current !== (session?.user.id ?? null)) {
        setData(emptyData);
        setDraft(null);
        setDirty(false);
        setCompanyId("");
        setEmployeeId("");
        setModelId("");
        setCompanyScopeId(null);
        setDetailEmployeeId(null);
        setConfirmation(null);
        setCompanyAudit({
          companyId: "",
          logs: [],
          loading: false,
          hasMore: false,
        });
        authUserId.current = session?.user.id ?? null;
      }
      setUser(session?.user ?? null);
      if (event === "PASSWORD_RECOVERY") setAuthMode("password");
    });
    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (!user || demo) return;
    let alive = true;
    setBusy(true);
    loadData()
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e) => {
        if (alive) notify(e.message, true);
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [user, demo]);
  useEffect(() => {
    if (!companyId && data.companies.length) setCompanyId(data.companies[0].id);
  }, [data, companyId, modelId]);
  const company = data.companies.find((c) => c.id === companyId);
  const employees = data.employees.filter((e) => e.empresa_id === companyId);
  const employee = employees.find((e) => e.id === employeeId) ?? employees[0];
  const models = data.models.filter(
    (m) => !m.empresa_id || m.empresa_id === companyId,
  );
  const model =
    employee && company
      ? resolveEmployeeModel(employee, company, models, modelId || undefined)
      : models[0];
  const scopedCompany = data.companies.find((c) => c.id === companyScopeId);
  const scopedData = companyScopeId
    ? scopeCompanyData(data, companyScopeId)
    : data;
  if (!demo && companyScopeId && companyAudit.companyId === companyScopeId)
    scopedData.logs = companyAudit.logs;
  const companyReadOnly =
    !!company && (company.situacao ?? "ativa") !== "ativa";
  const scheduleReadOnly = companyReadOnly || employee?.situacao === "inativo";
  const detailEmployee = scopedData.employees.find(
    (e) => e.id === detailEmployeeId,
  );
  const saved = data.schedules.find(
    (s) =>
      s.empresa_id === companyId &&
      s.funcionario_id === employee?.id &&
      s.mes.startsWith(month),
  );
  const schedule = draft ?? saved;
  const report = useMemo(
    () =>
      schedule && company
        ? evaluate(
            schedule.dias,
            data.rules,
            company,
            schedule.mes,
            schedule.modelo_tipo,
            data.employees.find((e) => e.id === schedule.funcionario_id),
          )
        : null,
    [schedule, company, data.rules, data.employees],
  );
  const alertContext = {
    companyId: company?.id ?? "",
    companyName: company?.nome ?? "",
    employeeId: schedule?.funcionario_id,
    employeeName: schedule?.nome_funcionario ?? employee?.nome,
    month,
  };
  const alertSummary = buildAlertSummary(report?.alerts ?? [], alertContext);
  const editedReport = useMemo(
    () =>
      editedDay && schedule && company && modal?.kind === "dia"
        ? evaluate(
            schedule.dias.map((day) =>
              day.data === editedDay.data ? editedDay : day,
            ),
            data.rules,
            company,
            schedule.mes,
            schedule.modelo_tipo,
            data.employees.find((e) => e.id === schedule.funcionario_id),
          )
        : null,
    [editedDay, schedule, company, modal?.kind, data.rules, data.employees],
  );
  const editedSummary = buildAlertSummary(
    editedReport?.alerts ?? [],
    alertContext,
  );
  const previousOccurrences = new Set(
    alertSummary.groups.flatMap((group) => group.occurrences.map((o) => o.id)),
  );
  const editedAlerts = editedDay
    ? editedSummary.groups.filter(
        (group) =>
          group.action !== "rules" &&
          group.action !== "employee" &&
          (alertsForDate([group], editedDay.data).length > 0 ||
            group.occurrences.some((o) => !previousOccurrences.has(o.id))),
      )
    : [];
  const saveLabel =
    saveState === "saving"
      ? "Salvando"
      : saveState === "error"
        ? "Falha ao salvar"
        : dirty || !saved
          ? "Não salvo"
          : demo
            ? "Salvo na demonstração"
            : "Salvo";
  const pendingRules = data.rules.filter((r) => !r.confirmado).length;
  const changeContext = (callback: () => void) => {
    const apply = () => {
      callback();
      setDraft(null);
      setDirty(false);
      setSaveState("idle");
      setActiveDate(null);
    };
    if (dirty)
      setConfirmation({
        title: "Descartar alterações não salvas?",
        message:
          "A prévia atual será descartada ao mudar de empresa ou seleção. As escalas salvas serão preservadas.",
        accept: apply,
      });
    else apply();
  };
  async function perform(action: () => Promise<void>) {
    if (operationPending.current) return;
    operationPending.current = true;
    setBusy(true);
    try {
      await action();
    } catch (e) {
      notify(
        e instanceof Error
          ? e.message
          : "Não foi possível concluir a operação.",
        true,
      );
    } finally {
      operationPending.current = false;
      setBusy(false);
    }
  }
  async function refresh() {
    if (!demo) setData(await loadData());
  }
  async function rowSave(
    table: string,
    value: Record<string, unknown>,
    id?: string,
  ) {
    const key = (
      {
        empresas: "companies",
        funcionarios: "employees",
        modelos_jornada: "models",
        parametros_legais: "rules",
        feriados: "holidays",
      } as const
    )[
      table as
        | "empresas"
        | "funcionarios"
        | "modelos_jornada"
        | "parametros_legais"
        | "feriados"
    ];
    const before = data[key]?.find((r) => r.id === id) as unknown as
      Record<string, unknown> | undefined;
    const targetCompanyId = String(
      value.empresa_id ?? before?.empresa_id ?? "",
    );
    if (
      ["funcionarios", "modelos_jornada"].includes(table) &&
      targetCompanyId
    ) {
      const targetCompany = data.companies.find(
        (c) => c.id === targetCompanyId,
      );
      if (!targetCompany || (targetCompany.situacao ?? "ativa") !== "ativa")
        throw new Error(
          "Reative a empresa antes de alterar seus cadastros e jornadas.",
        );
      if (companyScopeId && targetCompanyId !== companyScopeId)
        throw new Error("A operação deve pertencer à empresa ativa.");
    }
    if (
      table === "funcionarios" &&
      before &&
      before.empresa_id !== value.empresa_id
    )
      throw new Error(
        "A mudança de empresa exige um fluxo de transferência com preservação do vínculo. Edite o cadastro na empresa de origem.",
      );
    const selectedDefault = value.modelo_padrao_id
      ? data.models.find((m) => m.id === value.modelo_padrao_id)
      : undefined;
    const defaultCompanyId = table === "empresas" ? id : targetCompanyId;
    if (
      value.modelo_padrao_id &&
      (!selectedDefault ||
        (selectedDefault.empresa_id &&
          selectedDefault.empresa_id !== defaultCompanyId))
    )
      throw new Error(
        "O modelo padrão deve pertencer a esta empresa ou ser uma referência compartilhada.",
      );
    let rowId = id ?? crypto.randomUUID();
    if (demo) {
      const after = {
        ...before,
        ...value,
        id: rowId,
        updated_at: new Date().toISOString(),
        ...(before ? {} : { created_at: new Date().toISOString() }),
      };
      setData(
        (current) =>
          ({
            ...current,
            [key]: id
              ? current[key].map((r) => (r.id === id ? after : r))
              : [...current[key], after],
            logs: [
              {
                id: crypto.randomUUID(),
                tabela: table,
                acao: before ? "UPDATE" : "INSERT",
                alterado_em: new Date().toISOString(),
                registro_id: rowId,
                empresa_id:
                  table === "empresas" ? rowId : targetCompanyId || null,
                ator_id: "demo-user",
                antes: before ?? null,
                depois: after,
                campos: Object.keys(value),
              },
              ...current.logs,
            ],
          }) as Data,
      );
    } else {
      rowId = await saveRow(table, value, id);
      await refresh();
    }
    return rowId;
  }
  function withNeighbors(s: Schedule): Schedule {
    const actual = new Map<string, Day>();
    for (const other of data.schedules) {
      if (other.funcionario_id !== s.funcionario_id || other.mes === s.mes)
        continue;
      for (const d of other.dias)
        if (d.data.startsWith(other.mes.slice(0, 7))) actual.set(d.data, d);
    }
    return {
      ...s,
      dias: s.dias.map((d) =>
        !d.data.startsWith(s.mes.slice(0, 7)) && actual.has(d.data)
          ? structuredClone(actual.get(d.data)!)
          : d,
      ),
    };
  }
  function createSchedule(
    e: Employee,
    m: Model,
    targetMonth: string,
  ): Schedule {
    if (!company) throw new Error("Selecione uma empresa.");
    if ((company.situacao ?? "ativa") !== "ativa" || e.situacao === "inativo")
      throw new Error(
        "Empresa e vínculo precisam estar ativos para gerar escalas.",
      );
    if (
      e.empresa_id !== company.id ||
      (m.empresa_id && m.empresa_id !== company.id)
    )
      throw new Error("Funcionário e modelo devem pertencer à empresa ativa.");
    if (m.tipo === "6x1" && !company.permite_6x1)
      notify(
        "A empresa não permite 6x1. A prévia mostrará o alerta; confira a CCT.",
        true,
      );
    return withNeighbors({
      id: "",
      empresa_id: company.id,
      funcionario_id: e.id,
      modelo_id: m.id,
      mes: `${targetMonth}-01`,
      nome_funcionario: e.nome,
      modelo_nome: m.nome,
      modelo_tipo: m.tipo,
      dias: generateDays(targetMonth, m, company, data.holidays, restHoliday),
    });
  }
  async function persistSchedules(items: Schedule[]) {
    for (const item of items) {
      const target = data.companies.find((c) => c.id === item.empresa_id);
      const person = data.employees.find(
        (e) => e.id === item.funcionario_id && e.empresa_id === item.empresa_id,
      );
      if (
        !target ||
        !person ||
        (target.situacao ?? "ativa") !== "ativa" ||
        person.situacao === "inativo"
      )
        throw new Error(
          "Não é permitido gravar escalas de empresa ou vínculo inativo.",
        );
      if (companyScopeId && item.empresa_id !== companyScopeId)
        throw new Error("A escala deve pertencer à empresa ativa.");
    }
    if (demo) {
      setData((current) => {
        const changed = items.map((item) => {
          const before = current.schedules.find(
            (old) =>
              old.funcionario_id === item.funcionario_id &&
              old.mes === item.mes,
          );
          return { ...item, id: item.id || before?.id || crypto.randomUUID() };
        });
        const events = changed.map((item) => {
          const before = current.schedules.find((old) => old.id === item.id);
          return {
            id: crypto.randomUUID(),
            tabela: "escalas",
            acao: before ? "UPDATE" : "INSERT",
            alterado_em: new Date().toISOString(),
            registro_id: item.id,
            empresa_id: item.empresa_id,
            ator_id: "demo-user",
            antes: before ? { ...before } : null,
            depois: { ...item },
            campos: ["dias", "modelo_id"],
          };
        });
        return {
          ...current,
          schedules: [
            ...current.schedules.filter(
              (old) => !changed.some((item) => item.id === old.id),
            ),
            ...changed,
          ],
          logs: [...events, ...current.logs],
        };
      });
    } else {
      await saveSchedules(items);
      await refresh();
    }
  }
  async function saveCurrent() {
    if (!schedule) return;
    setSaveState("saving");
    try {
      await persistSchedules([schedule]);
      setSaveState("saved");
    } catch (error) {
      setSaveState("error");
      throw error;
    }
    setDraft(null);
    setDirty(false);
    notify(
      demo
        ? "Escala atualizada nesta demonstração. Nada foi enviado ao servidor."
        : "Escala salva com sucesso.",
    );
  }
  async function duplicate(all: boolean) {
    if (!company || !schedule) return;
    const target = nextMonth(month);
    const source = all
      ? data.schedules.filter(
          (s) => s.empresa_id === company.id && s.mes.startsWith(month),
        )
      : [schedule];
    if (!source.length)
      throw new Error(
        "Salve as escalas de origem antes de duplicar a empresa.",
      );
    const targets = source.map((s) => {
      const m = data.models.find((m) => m.id === s.modelo_id),
        e = data.employees.find((e) => e.id === s.funcionario_id);
      if (!m || !e)
        throw new Error(
          "Modelo ou funcionário da escala não está mais disponível.",
        );
      const next = createSchedule(e, m, target);
      return withNeighbors({
        ...next,
        dias: duplicateDays(
          s.dias.filter((d) => d.data.startsWith(s.mes.slice(0, 7))),
          target,
          m,
          company,
          data.holidays,
          restHoliday,
        ),
      });
    });
    const conflicts = targets.filter((t) =>
      data.schedules.some(
        (s) => s.funcionario_id === t.funcionario_id && s.mes === t.mes,
      ),
    );
    if (
      conflicts.length &&
      !window.confirm(
        `${conflicts.length} escala(s) já existe(m) em ${monthLabel(target)}. Substituir?`,
      )
    )
      return;
    await persistSchedules(targets);
    setMonth(target);
    setDraft(null);
    setDirty(false);
    notify(
      `${targets.length} escala(s) recriada(s) para ${monthLabel(target)} com feriados de destino. Horários semanais foram copiados por dia da semana e ocorrência; ciclos 12x36 seguem a âncora. Confira os alertas.`,
    );
  }
  async function authSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await perform(async () => {
      if (!supabase)
        throw new Error("O Supabase ainda não está conectado a este ambiente.");
      const email = pick(fd, "email"),
        password = pick(fd, "password");
      const redirect = window.location.origin;
      const result =
        authMode === "signup"
          ? await supabase.auth.signUp({
              email,
              password,
              options: { emailRedirectTo: redirect },
            })
          : authMode === "reset"
            ? await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: redirect,
              })
            : authMode === "password"
              ? await supabase.auth.updateUser({ password })
              : await supabase.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      notify(
        authMode === "signup"
          ? "Cadastro solicitado. Confira seu e-mail para confirmar o acesso."
          : authMode === "reset"
            ? "Se houver uma conta para esse e-mail, enviaremos as instruções."
            : authMode === "password"
              ? "Senha atualizada."
              : "Acesso realizado.",
      );
      if (authMode === "password") setAuthMode("login");
    });
  }
  async function formSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modal || (modal.kind === "dia" && !editedDay)) return;
    const fd = new FormData(event.currentTarget);
    const id = modal.row?.id as string | undefined;
    await perform(async () => {
      if (modal.kind === "empresa") {
        const cnpj = pick(fd, "cnpj").replace(/\D/g, "");
        if (cnpj && !cnpjValid(cnpj))
          throw new Error("Informe um CNPJ válido com 14 dígitos.");
        const limit = pick(fd, "limite");
        await rowSave(
          "empresas",
          {
            nome_fantasia: pick(fd, "nome_fantasia"),
            codigo_interno: pick(fd, "codigo_interno"),
            situacao: pick(fd, "situacao") || "ativa",
            endereco: pick(fd, "endereco"),
            cep: pick(fd, "cep").replace(/\D/g, ""),
            responsavel: pick(fd, "responsavel"),
            contato: pick(fd, "contato"),
            observacoes: pick(fd, "observacoes"),
            politica_domingo_feriado: pick(fd, "politica_domingo_feriado"),
            modelo_padrao_id: pick(fd, "modelo_padrao_id") || null,
            carga_semanal_padrao_minutos: contractMinutesFromHours(
              pick(fd, "carga_semanal_padrao"),
            ),
            nome: pick(fd, "nome"),
            cnpj,
            cidade: pick(fd, "cidade"),
            uf: pick(fd, "uf").toUpperCase(),
            cct: pick(fd, "cct"),
            permite_6x1: fd.has("permite_6x1"),
            limite_diario_minutos: limit
              ? Math.round(Number(limit) * 60)
              : null,
            usa_banco_horas: fd.has("banco"),
          },
          id,
        );
      }
      if (modal.kind === "funcionario") {
        const dailyContract = contractMinutesFromHours(
          pick(fd, "carga_diaria"),
        );
        if (dailyContract && dailyContract > 1440)
          throw new Error("A carga diária deve ser de até 24 horas.");
        await rowSave(
          "funcionarios",
          {
            empresa_id: pick(fd, "empresa_id"),
            nome: pick(fd, "nome"),
            cargo: pick(fd, "cargo"),
            matricula: pick(fd, "matricula"),
            setor: pick(fd, "setor"),
            admissao: pick(fd, "admissao") || null,
            situacao: pick(fd, "situacao") || "ativo",
            modelo_padrao_id: pick(fd, "modelo_padrao_id") || null,
            carga_diaria_minutos: dailyContract,
            regras_especiais: pick(fd, "regras_especiais"),
            horario_contratual: pick(fd, "horario"),
            carga_semanal_minutos: contractMinutesFromHours(
              pick(fd, "carga_semanal"),
            ),
            dias_descanso: fd.getAll("descanso").map(Number),
          },
          id,
        );
      }
      if (modal.kind === "modelo") {
        const padrao: WeekPattern = {};
        for (let d = 0; d < 7; d++)
          padrao[String(d)] = parseShifts(pick(fd, `dia${d}`));
        const tipo = pick(fd, "tipo");
        const turno = parseShifts(pick(fd, "turno"));
        if (tipo === "12x36" && (!pick(fd, "ciclo_inicio") || !turno.length))
          throw new Error("O ciclo 12x36 precisa de data inicial e turno.");
        if (tipo === "12x36" && minutes(turno) > 720)
          throw new Error(
            "O turno 12x36 não pode exceder 12 horas de relógio.",
          );
        await rowSave(
          "modelos_jornada",
          {
            nome: pick(fd, "nome"),
            empresa_id: pick(fd, "empresa_id") || null,
            tipo,
            padrao,
            ciclo_inicio: pick(fd, "ciclo_inicio") || null,
            turno,
          },
          id,
        );
      }
      if (modal.kind === "feriado") {
        const abrangencia = pick(fd, "abrangencia"),
          uf = pick(fd, "uf").toUpperCase(),
          cidade = pick(fd, "cidade");
        if (abrangencia !== "nacional" && !uf)
          throw new Error("Informe a UF do feriado.");
        if (abrangencia === "municipal" && !cidade)
          throw new Error("Informe a cidade do feriado.");
        await rowSave(
          "feriados",
          {
            nome: pick(fd, "nome"),
            data: pick(fd, "data"),
            abrangencia,
            uf: abrangencia === "nacional" ? null : uf,
            cidade: abrangencia === "municipal" ? cidade : null,
          },
          id,
        );
      }
      if (modal.kind === "regra") {
        const chave = pick(fd, "chave");
        const value = JSON.parse(pick(fd, "valor"));
        if (!value || typeof value !== "object" || Array.isArray(value))
          throw new Error("O valor deve ser um objeto JSON.");
        for (const v of Object.values(value))
          if (typeof v === "number" && (!Number.isFinite(v) || v < 0))
            throw new Error("Use valores numéricos positivos.");
        const required: Record<string, string[]> = {
          regime: [
            "limite_semanal_minutos",
            "limite_diario_minutos",
            "descansos_semanais",
          ],
          intervalo: [
            "acima_minutos",
            "entre_inicio_minutos",
            "intervalo_longo_minutos",
            "intervalo_curto_minutos",
          ],
          interjornada: ["minutos"],
          noturno: [
            "inicio_minutos",
            "fim_minutos",
            "hora_reduzida_segundos",
            "adicional_percentual",
          ],
          divisor: ["fator"],
        };
        if (required[chave].some((k) => typeof value[k] !== "number"))
          throw new Error(
            `Campos numéricos obrigatórios: ${required[chave].join(", ")}`,
          );
        if (
          chave === "noturno" &&
          (!value.hora_reduzida_segundos ||
            value.inicio_minutos >= 1440 ||
            value.fim_minutos >= 1440)
        )
          throw new Error("Confira os horários e a duração da hora noturna.");
        if (chave === "divisor" && value.fator <= 0)
          throw new Error("O fator deve ser positivo.");
        await rowSave(
          "parametros_legais",
          {
            nome: pick(fd, "nome"),
            chave,
            valor: value,
            inicio_vigencia: pick(fd, "inicio"),
            fonte: pick(fd, "fonte"),
            observacao: pick(fd, "observacao"),
            confirmado: fd.has("confirmado"),
          },
          id,
        );
      }
      if (modal.kind === "dia" && schedule) {
        if (!editedDay) return;
        const changed = schedule.dias.map((day) =>
          day.data === editedDay.data ? editedDay : day,
        );
        setSaveState("idle");
        setDraft({ ...schedule, dias: changed });
        setDirty(true);
      }
      setModal(null);
      notify(
        modal.kind === "dia"
          ? "Dia alterado na prévia. Salve a escala para registrar."
          : demo
            ? "Cadastro atualizado apenas nesta demonstração."
            : "Cadastro salvo.",
      );
    });
  }
  const edit = (kind: Modal["kind"], row?: object) => {
    if (
      scopedCompany &&
      (scopedCompany.situacao ?? "ativa") !== "ativa" &&
      ["funcionario", "modelo", "dia"].includes(kind)
    ) {
      notify(
        "Esta empresa está em consulta. Reative-a antes de alterar funcionários ou escalas.",
        true,
      );
      return;
    }
    if (kind === "dia") {
      if (scheduleReadOnly) {
        notify(
          "A escala está disponível somente para consulta enquanto a empresa ou vínculo estiver inativo.",
          true,
        );
        return;
      }
      setEditedDay(row as Day);
      setActiveDate((row as Day).data);
    }
    let targetRow = row as Record<string, unknown> | undefined;
    if (kind === "modelo" && companyScopeId) {
      if (targetRow && !targetRow.empresa_id) {
        const { id: templateId, ...template } = targetRow;
        void templateId;
        targetRow = {
          ...template,
          nome: `${template.nome} · ${scopedCompany?.nome}`,
          empresa_id: companyScopeId,
        };
      } else if (!targetRow) targetRow = { empresa_id: companyScopeId };
    }
    if (kind === "feriado" && companyScopeId) {
      notify(
        "O cadastro legal é compartilhado. Use o calendário global para editar a data oficial; isso não define o funcionamento da empresa.",
        true,
      );
      return;
    }
    setModal({ kind, row: targetRow });
  };
  const openAlertDay = (date: string) => {
    const day = schedule?.dias.find((d) => d.data === date);
    if (!day) return;
    const cell = document.getElementById(`escala-dia-${date}`);
    cell?.scrollIntoView({ block: "center", behavior: "smooth" });
    cell?.focus({ preventScroll: true });
    edit("dia", day);
  };
  const navigate = (target: Page) =>
    changeContext(() => {
      setPage(target);
      setCompanyScopeId(null);
      setDetailEmployeeId(null);
      setMobile(false);
    });
  const openCompany = (target: Company, view: CompanyView = "visao_geral") =>
    changeContext(() => {
      setCompanyScopeId(target.id);
      setCompanyId(target.id);
      setEmployeeId("");
      setModelId("");
      setDetailEmployeeId(null);
      setPage(
        view === "visao_geral"
          ? "company-overview"
          : view === "configuracoes"
            ? "company-settings"
            : view,
      );
      setMobile(false);
    });
  const openEmployee = (person: Employee) => {
    const target = data.companies.find((c) => c.id === person.empresa_id);
    if (!target) return;
    changeContext(() => {
      setCompanyScopeId(target.id);
      setCompanyId(target.id);
      setEmployeeId(person.id);
      setModelId("");
      setDetailEmployeeId(person.id);
      setPage("employee-detail");
    });
  };
  const employeeSchedules = (person: Employee) => {
    const target = data.companies.find((c) => c.id === person.empresa_id);
    if (!target) return;
    changeContext(() => {
      setCompanyScopeId(target.id);
      setCompanyId(target.id);
      setEmployeeId(person.id);
      setModelId("");
      setPage("escalas");
    });
  };
  const currentCompanyView: CompanyView =
    page === "company-settings"
      ? "configuracoes"
      : [
            "funcionarios",
            "modelos",
            "escalas",
            "feriados",
            "historico",
          ].includes(page)
        ? (page as CompanyView)
        : "visao_geral";
  const changeCompanyStatus = (status: NonNullable<Company["situacao"]>) => {
    if (!scopedCompany) return;
    setConfirmation({
      title:
        status === "ativa"
          ? "Reativar empresa?"
          : "Alterar situação da empresa?",
      message: `${scopedCompany.nome}: situação ${status}. Funcionários, escalas e histórico serão preservados. Empresas inativas ou arquivadas ficam disponíveis para consulta, sem novas operações.`,
      accept: () => {
        void perform(async () => {
          await rowSave("empresas", { situacao: status }, scopedCompany.id);
          notify(
            "Situação da empresa atualizada; nenhum vínculo ou escala foi excluído.",
          );
        });
      },
    });
  };
  const loadMoreHistory = async () => {
    if (
      !companyScopeId ||
      companyAudit.loading ||
      companyAudit.companyId !== companyScopeId
    )
      return;
    const target = companyScopeId;
    const offset = companyAudit.logs.length;
    setCompanyAudit((current) => ({
      ...current,
      loading: true,
      error: undefined,
    }));
    try {
      const logs = await loadCompanyLogs(target, offset);
      setCompanyAudit((current) =>
        current.companyId === target
          ? {
              ...current,
              logs: [
                ...current.logs,
                ...logs.filter(
                  (entry) => !current.logs.some((old) => old.id === entry.id),
                ),
              ],
              loading: false,
              hasMore: logs.length === 100,
            }
          : current,
      );
    } catch (error) {
      setCompanyAudit((current) =>
        current.companyId === target
          ? {
              ...current,
              loading: false,
              error:
                error instanceof Error
                  ? error.message
                  : "Não foi possível carregar o histórico.",
            }
          : current,
      );
    }
  };
  const toggleEmployeeStatus = (person: Employee) =>
    setConfirmation({
      title:
        person.situacao === "inativo"
          ? "Reativar vínculo?"
          : "Inativar vínculo?",
      message: `${person.nome}: o cadastro e as escalas anteriores serão preservados. Vínculos inativos não recebem novas escalas.`,
      accept: () => {
        void perform(async () => {
          await rowSave(
            "funcionarios",
            {
              ...person,
              situacao: person.situacao === "inativo" ? "ativo" : "inativo",
            },
            person.id,
          );
          notify("Situação do vínculo atualizada.");
        });
      },
    });
  if (!authReady)
    return (
      <div className="min-h-screen grid place-items-center">
        <LoaderCircle className="animate-spin" aria-label="Carregando" />
      </div>
    );
  if ((!user && !demo) || authMode === "password")
    return (
      <div className="login-shell">
        <section className="login-art">
          <Brand light className="login-brand" />
          <div className="login-copy">
            <div className="eyebrow login-kicker">
              MAIS CLAREZA PARA CADA JORNADA
            </div>
            <h1>
              Tempo bem
              <br />
              organizado.
              <br />
              <span className="login-highlight">Pessoas em dia.</span>
            </h1>
            <p>
              Empresas, pessoas e escalas em um só lugar. Planeje o mês com
              regras transparentes e mais tranquilidade para o seu DP.
            </p>
          </div>
          <p className="login-art-footer">
            Planejamento · Conferência · Organização
          </p>
        </section>
        <section className="login-form">
          <div className="login-box">
            <Brand className="login-mobile-brand" />
            <div className="eyebrow">GERADOR DE JORNADAS</div>
            <h1>
              {authMode === "signup"
                ? "Crie seu acesso"
                : authMode === "reset"
                  ? "Recupere seu acesso"
                  : authMode === "password"
                    ? "Defina uma nova senha"
                    : "Bem-vindo ao seu DP"}
            </h1>
            <p className="subtitle">
              {authMode === "login"
                ? "Entre para organizar as jornadas das suas empresas."
                : "Use seu e-mail de trabalho para continuar."}
            </p>
            {!supabase && (
              <div className="banner mt-6">
                <AlertTriangle size={18} />
                <div>
                  A conexão com o Supabase ainda não foi configurada. Você pode
                  explorar a demonstração com dados fictícios.
                </div>
              </div>
            )}
            <form onSubmit={authSubmit}>
              {authMode !== "password" && (
                <Field label="E-mail">
                  <input
                    name="email"
                    type="email"
                    placeholder="voce@contabilidade.com.br"
                    required
                    autoComplete="email"
                  />
                </Field>
              )}
              {authMode !== "reset" && (
                <Field label="Senha">
                  <input
                    name="password"
                    type="password"
                    minLength={8}
                    required
                    autoComplete={
                      authMode === "login" ? "current-password" : "new-password"
                    }
                    placeholder="Pelo menos 8 caracteres"
                  />
                </Field>
              )}
              <button className="button primary" disabled={busy || !supabase}>
                {busy ? (
                  <LoaderCircle size={16} className="animate-spin" />
                ) : null}
                {authMode === "signup"
                  ? "Criar conta"
                  : authMode === "reset"
                    ? "Enviar instruções"
                    : authMode === "password"
                      ? "Salvar senha"
                      : "Entrar"}
                <ArrowRight size={15} />
              </button>
            </form>
            <div className="actions justify-between mt-5">
              <button
                className="icon-button text-xs"
                onClick={() =>
                  setAuthMode(authMode === "signup" ? "login" : "signup")
                }
              >
                {authMode === "signup" ? "Já tenho uma conta" : "Criar conta"}
              </button>
              <button
                className="icon-button text-xs"
                onClick={() =>
                  setAuthMode(authMode === "reset" ? "login" : "reset")
                }
              >
                {authMode === "reset"
                  ? "Voltar ao login"
                  : "Esqueci minha senha"}
              </button>
            </div>
            <div className="login-demo mt-7 border-t pt-6">
              <button
                className="button w-full"
                onClick={() => {
                  setCompanyScopeId(null);
                  setDetailEmployeeId(null);
                  setConfirmation(null);
                  setCompanyId("");
                  setEmployeeId("");
                  setModelId("");
                  setDraft(null);
                  setDirty(false);
                  setPage("inicio");
                  setCompanyAudit({
                    companyId: "",
                    logs: [],
                    loading: false,
                    hasMore: false,
                  });
                  setData(demoData());
                  setMonth("2026-12");
                  setDemo(true);
                  setAuthMode("login");
                }}
              >
                Explorar demonstração <ArrowUpRight size={15} />
              </button>
              <p className="subtitle text-center text-[11px]">
                Dados fictícios. As alterações não são salvas após sair.
              </p>
            </div>
          </div>
        </section>
        {confirmation && (
          <Dialog
            title={confirmation.title}
            close={() => setConfirmation(null)}
          >
            <p className="subtitle !mt-0">{confirmation.message}</p>
            <div className="dialog-actions">
              <button className="button" onClick={() => setConfirmation(null)}>
                Cancelar
              </button>
              <button
                className="button primary"
                onClick={() => {
                  const action = confirmation.accept;
                  setConfirmation(null);
                  action();
                }}
              >
                Confirmar
              </button>
            </div>
          </Dialog>
        )}
        {toast && (
          <div className={`toast ${toast.error ? "error" : ""}`} role="status">
            {toast.text}
            <button onClick={() => setToast(null)} aria-label="Fechar mensagem">
              <X size={16} />
            </button>
          </div>
        )}
      </div>
    );
  return (
    <div className="shell">
      {mobile && (
        <div
          className="fixed inset-0 bg-black/30 z-20"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <Brand light />
        <div className="nav-label">ÁREA DE TRABALHO</div>
        {nav.slice(0, 5).map(([id, label, Icon]) => (
          <button
            key={id}
            className={`nav ${page === id ? "active" : ""}`}
            aria-current={page === id ? "page" : undefined}
            onClick={() => navigate(id)}
          >
            <Icon size={17} />
            {label}
            {page === id && <ChevronRight size={14} className="ml-auto" />}
          </button>
        ))}
        <div className="nav-label mt-4">CONFIGURAÇÕES</div>
        {nav.slice(5).map(([id, label, Icon]) => (
          <button
            key={id}
            className={`nav ${page === id ? "active" : ""}`}
            aria-current={page === id ? "page" : undefined}
            onClick={() => navigate(id)}
          >
            <Icon size={17} />
            {label}
          </button>
        ))}
        <div className="side-note">
          <ShieldCheck size={20} className="mb-2" />
          <strong>Regras claras, decisões seguras.</strong>Confira os parâmetros
          legais e a CCT antes de aprovar cada escala.
        </div>
        <div className="profile">
          <div className="avatar">DP</div>
          <div className="min-w-0">
            <div className="truncate">
              {demo ? "Modo demonstração" : user?.email}
            </div>
            <small className="profile-caption">
              {demo ? "Dados fictícios" : "Área de acesso privado"}
            </small>
          </div>
          <button
            title="Sair"
            aria-label="Sair"
            className="icon-button ml-auto"
            onClick={() =>
              perform(async () => {
                if (
                  dirty &&
                  !window.confirm("Sair e descartar alterações não salvas?")
                )
                  return;
                if (!demo && supabase) {
                  const { error } = await supabase.auth.signOut();
                  if (error) throw error;
                }
                setDemo(false);
                setData(emptyData);
                setCompanyId("");
                setEmployeeId("");
                setModelId("");
                setCompanyScopeId(null);
                setDetailEmployeeId(null);
                setConfirmation(null);
                setCompanyAudit({
                  companyId: "",
                  logs: [],
                  loading: false,
                  hasMore: false,
                });
                setDraft(null);
                setDirty(false);
                setPage("inicio");
              })
            }
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="actions">
            <button
              className="icon-button mobile-menu"
              onClick={() => setMobile(true)}
              aria-label="Abrir menu"
            >
              <Menu size={21} />
            </button>
            <span>
              Área de trabalho{" "}
              <span className="breadcrumb-divider mx-2">/</span>{" "}
              <strong>
                {scopedCompany?.nome ?? nav.find((n) => n[0] === page)?.[1]}
              </strong>
            </span>
          </div>
          <div className="top-actions">
            <label className="company-switcher">
              Empresa ativa
              <select
                aria-label="Empresa ativa"
                value={companyScopeId ?? ""}
                onChange={(event) => {
                  const target = data.companies.find(
                    (c) => c.id === event.target.value,
                  );
                  if (target) openCompany(target, currentCompanyView);
                  else navigate("empresas");
                }}
              >
                <option value="">Visão consolidada</option>
                {data.companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                    {c.situacao === "arquivada" ? " · arquivada" : ""}
                  </option>
                ))}
              </select>
            </label>
            <span className="date-label topbar-brand">Cont Contábil</span>
            <span className={`pill ${demo ? "warn" : ""}`}>
              {demo ? "Demonstração" : "Acesso protegido"}
            </span>
            <div className="avatar !h-8 !w-8 text-xs">DP</div>
          </div>
        </header>
        <div className="content">
          {demo && (
            <div className="banner neutral">
              <BookOpen size={16} />
              <span>
                Você está explorando dados fictícios. Cadastros e escalas ficam
                apenas nesta sessão. As regras propostas ainda precisam de
                conferência.
              </span>
            </div>
          )}
          {scopedCompany && (
            <CompanyAdmin
              company={scopedCompany}
              data={data}
              month={month}
              view={currentCompanyView}
              onNavigate={(view) => openCompany(scopedCompany, view)}
              onBack={() => navigate("empresas")}
              onEditCompany={() => edit("empresa", scopedCompany)}
              onStatusChange={changeCompanyStatus}
              busy={busy}
            />
          )}
          {page === "inicio" && (
            <>
              <div className="page-head dashboard-hero">
                <div>
                  <div className="eyebrow">
                    CONT CONTÁBIL · DEPARTAMENTO PESSOAL
                  </div>
                  <h1>Seu mês, bem planejado.</h1>
                  <p className="subtitle">
                    Um panorama das empresas, pessoas e jornadas do seu
                    departamento pessoal.
                  </p>
                </div>
                <button
                  className="button primary"
                  onClick={() => navigate("escalas")}
                >
                  <Plus size={16} />
                  Gerar nova escala
                </button>
              </div>
              <div className="stats">
                <Stat
                  label="Empresas cadastradas"
                  value={data.companies.length}
                  note="Clientes organizados em um só lugar"
                  icon={Building2}
                />
                <Stat
                  label="Funcionários"
                  value={data.employees.length}
                  note="Pessoas com cadastro ativo"
                  icon={Users}
                />
                <Stat
                  label="Escalas salvas"
                  value={data.schedules.length}
                  note="Planejamento disponível para consulta"
                  icon={CalendarDays}
                />
                <Stat
                  label="Regras a conferir"
                  value={pendingRules}
                  note="Fontes e vigências aguardando revisão"
                  icon={ShieldCheck}
                />
              </div>
              {(!data.rules.length || pendingRules > 0) && (
                <div className="banner">
                  <AlertTriangle size={19} />
                  <div>
                    <strong>Antes de fechar o mês, confira as regras.</strong>
                    <br />
                    {!data.rules.length
                      ? "Importe os parâmetros iniciais e revise as fontes e vigências."
                      : "A proposta de transição para 42h e 40h não foi verificada em fonte oficial. Confirme datas e exceções da CCT."}{" "}
                    <button
                      className="underline font-semibold"
                      onClick={() => navigate("regras")}
                    >
                      Revisar parâmetros <span aria-hidden>↗</span>
                    </button>
                  </div>
                </div>
              )}
              <div className="grid2">
                <section className="panel">
                  <div className="panel-head">
                    <h2>Últimas escalas</h2>
                    <button
                      className="icon-button text-xs"
                      onClick={() => navigate("escalas")}
                    >
                      Ver todas <ArrowUpRight size={14} />
                    </button>
                  </div>
                  {data.schedules.length ? (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Funcionário</th>
                            <th>Competência</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {data.schedules
                            .slice(-5)
                            .reverse()
                            .map((s) => (
                              <tr key={s.id}>
                                <td>
                                  <strong>
                                    {s.nome_funcionario ??
                                      data.employees.find(
                                        (e) => e.id === s.funcionario_id,
                                      )?.nome}
                                  </strong>
                                  <span className="text-[10px] muted">
                                    {
                                      data.companies.find(
                                        (c) => c.id === s.empresa_id,
                                      )?.nome
                                    }
                                  </span>
                                </td>
                                <td>
                                  <span className="pill">
                                    {monthLabel(s.mes)}
                                  </span>
                                </td>
                                <td>
                                  <button
                                    className="icon-button"
                                    aria-label={`Abrir escala de ${s.nome_funcionario}`}
                                    onClick={() =>
                                      changeContext(() => {
                                        setCompanyId(s.empresa_id);
                                        setCompanyScopeId(s.empresa_id);
                                        setModelId("");
                                        setEmployeeId(s.funcionario_id);
                                        setMonth(s.mes.slice(0, 7));
                                        setPage("escalas");
                                      })
                                    }
                                  >
                                    <ArrowUpRight size={16} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <Empty
                      text="Nenhuma escala salva ainda."
                      action={
                        <button
                          className="button"
                          onClick={() => navigate("escalas")}
                        >
                          Criar a primeira escala
                        </button>
                      }
                    />
                  )}
                </section>
                <section className="panel">
                  <div className="panel-head">
                    <h2>Comece por aqui</h2>
                    <span className="pill">PASSO A PASSO</span>
                  </div>
                  <div className="panel-body">
                    {[
                      [
                        "1",
                        "Cadastre a empresa",
                        "Informe a CCT, os limites e as permissões.",
                        "empresas",
                      ],
                      [
                        "2",
                        "Adicione os funcionários",
                        "Nome, cargo e horário contratual. Sem CPF.",
                        "funcionarios",
                      ],
                      [
                        "3",
                        "Confira e gere a escala",
                        "Escolha o modelo, revise alertas e exporte.",
                        "escalas",
                      ],
                    ].map(([n, title, text, p]) => (
                      <button
                        className="quick-item w-full text-left"
                        key={n}
                        onClick={() => navigate(p as Page)}
                      >
                        <span className="quick-number">{n}</span>
                        <div>
                          <h3>{title}</h3>
                          <p className="muted">{text}</p>
                        </div>
                        <ChevronRight size={16} className="ml-auto muted" />
                      </button>
                    ))}
                  </div>
                </section>
              </div>
              <section className="panel">
                <div className="panel-head">
                  <h2>Suas empresas</h2>
                  <button
                    className="button small"
                    onClick={() => edit("empresa")}
                  >
                    <Plus size={14} />
                    Nova empresa
                  </button>
                </div>
                {data.companies.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Empresa</th>
                          <th>Localidade</th>
                          <th>Funcionários</th>
                          <th>Escala 6×1</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {data.companies.map((c) => (
                          <tr key={c.id}>
                            <td>
                              <strong>{c.nome}</strong>
                              <small className="muted">{c.cnpj}</small>
                            </td>
                            <td>
                              {c.cidade} / {c.uf}
                            </td>
                            <td>
                              {
                                data.employees.filter(
                                  (e) => e.empresa_id === c.id,
                                ).length
                              }
                            </td>
                            <td>
                              <span
                                className={`pill ${c.permite_6x1 ? "warn" : ""}`}
                              >
                                {c.permite_6x1
                                  ? "Autorizada na empresa"
                                  : "Não autorizada"}
                              </span>
                            </td>
                            <td>
                              <button
                                className="icon-button"
                                aria-label={`Editar ${c.nome}`}
                                onClick={() => edit("empresa", c)}
                              >
                                <ArrowUpRight size={16} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty text="Cadastre sua primeira empresa para começar." />
                )}
              </section>
            </>
          )}
          {page === "escalas" && (
            <>
              <div className="page-head">
                <div>
                  <div className="eyebrow">PLANEJAMENTO MENSAL</div>
                  <h1>Escalas de trabalho</h1>
                  <p className="subtitle">
                    Organize o mês, confira os limites e compartilhe a jornada
                    de cada pessoa.
                  </p>
                </div>
                <span className="pill">
                  <CalendarDays size={12} />
                  COMPETÊNCIA {month.slice(5)}/{month.slice(0, 4)}
                </span>
              </div>
              <section className="panel">
                <div className="panel-body">
                  <div className="filters">
                    <Field label="Empresa">
                      <select
                        value={companyId}
                        disabled={!!companyScopeId}
                        onChange={(e) =>
                          changeContext(() => {
                            setCompanyId(e.target.value);
                            setEmployeeId("");
                            setModelId("");
                          })
                        }
                      >
                        <option value="">Selecione uma empresa</option>
                        {data.companies.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.nome}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Funcionário">
                      <select
                        value={employee?.id ?? ""}
                        onChange={(e) =>
                          changeContext(() => {
                            setEmployeeId(e.target.value);
                            setModelId("");
                          })
                        }
                      >
                        <option value="">Selecione um funcionário</option>
                        {employees.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.nome}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Modelo de jornada">
                      <select
                        value={model?.id ?? ""}
                        onChange={(e) =>
                          changeContext(() => setModelId(e.target.value))
                        }
                      >
                        <option value="">Selecione um modelo</option>
                        {models.map((m) => (
                          <option
                            key={m.id}
                            value={m.id}
                            disabled={m.tipo === "6x1" && !company?.permite_6x1}
                          >
                            {m.nome}
                            {m.tipo === "6x1" && !company?.permite_6x1
                              ? " — não autorizado pela empresa"
                              : ""}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Mês da escala">
                      <input
                        type="month"
                        value={month}
                        min="1900-01"
                        max="2200-12"
                        onChange={(e) => {
                          if (/^\d{4}-\d{2}$/.test(e.target.value))
                            changeContext(() => setMonth(e.target.value));
                        }}
                      />
                    </Field>
                  </div>
                  {scheduleReadOnly && (
                    <p className="warning-text mt-4">
                      Consulta preservada: reative a empresa e o vínculo para
                      gerar ou alterar jornadas. As exportações continuam
                      disponíveis.
                    </p>
                  )}
                  {employee && (
                    <p className="muted mt-4">
                      Modelo para novas prévias: {model?.nome ?? "não definido"}
                      . A escolha individual tem precedência sobre o padrão da
                      empresa. Alterar esse cadastro não reescreve escalas já
                      salvas.
                    </p>
                  )}
                  <div className="actions justify-between mt-5">
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={restHoliday}
                        onChange={(e) => setRestHoliday(e.target.checked)}
                      />
                      Folgar nos feriados cadastrados
                    </label>
                    <button
                      className="button primary"
                      disabled={
                        scheduleReadOnly ||
                        busy ||
                        !employee ||
                        !model ||
                        !company ||
                        (model.tipo === "6x1" && !company.permite_6x1)
                      }
                      onClick={() =>
                        perform(async () => {
                          if (!employee || !model) return;
                          if (
                            dirty &&
                            !window.confirm(
                              "Substituir a prévia e descartar as alterações?",
                            )
                          )
                            return;
                          const s = createSchedule(employee, model, month);
                          setDraft(s);
                          setDirty(true);
                          setSaveState("idle");
                          notify(
                            "Prévia gerada. Confira as semanas, os alertas e salve a escala.",
                          );
                        })
                      }
                    >
                      <RefreshCw size={14} />
                      Gerar prévia
                    </button>
                  </div>
                </div>
              </section>
              {!schedule ? (
                <section className="panel">
                  <Empty
                    text="Selecione empresa, funcionário, modelo e mês para gerar uma prévia."
                    action={
                      !data.rules.length ? (
                        <button
                          className="button"
                          onClick={() => navigate("regras")}
                        >
                          Configurar parâmetros legais
                        </button>
                      ) : undefined
                    }
                  />
                </section>
              ) : (
                <>
                  <div className="stats">
                    <Stat
                      label="Horas no mês"
                      value={report ? formatMinutes(report.total) : "—"}
                      note="Total por data civil, com hora noturna reduzida"
                      icon={Clock3}
                    />
                    <Stat
                      label="Dias trabalhados"
                      value={
                        schedule.dias.filter(
                          (d) =>
                            d.data.startsWith(month) &&
                            computeDay(d, data.rules, schedule.dias).worked > 0,
                        ).length
                      }
                      note="Feriados e folgas conforme calendário"
                      icon={CalendarDays}
                    />
                    <Stat
                      label="Divisor mensal"
                      value={
                        report?.periods
                          .map((p) => p.divisor ?? "—")
                          .filter((v, i, a) => a.indexOf(v) === i)
                          .join(" / ") ?? "—"
                      }
                      note="Carga semanal × fator parametrizado"
                      icon={SlidersHorizontal}
                    />
                    <Stat
                      label="Violações impeditivas"
                      value={alertSummary.counts.violations}
                      note={`${alertSummary.counts.attention} avisos · ${alertSummary.counts.pendingSources} fontes/regras pendentes`}
                      icon={ShieldCheck}
                    />
                  </div>
                  <div className="banner neutral">
                    <BookOpen size={17} />
                    <div>
                      As semanas incluem dias dos meses vizinhos. Dias
                      adjacentes sem escala salva são projeções do modelo, não
                      registros confirmados. O total mensal usa somente os dias
                      desta competência. Clique em um dia para ajustar.
                    </div>
                  </div>
                  {report && (
                    <div className="periods">
                      {report.periods.map((p) => (
                        <div className="period" key={p.start}>
                          <span className="period-dates">
                            {dateLabel(p.start)} — {dateLabel(p.end)}
                          </span>
                          <br />
                          <strong>{p.rule?.nome ?? "Regime ausente"}</strong>
                          <div>
                            Divisor: <b>{p.divisor ?? "Não configurado"}</b>
                            {!p.rule?.confirmado && (
                              <span className="ml-2 text-[#ac8034]">
                                · a conferir
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <ScheduleAlerts
                    summary={alertSummary}
                    onSelect={openAlertDay}
                    onConfigure={() => navigate("regras")}
                    onEmployeeReview={() =>
                      employee && edit("funcionario", employee)
                    }
                  />
                  <section className="panel" aria-label="Calendário da escala">
                    <div className="panel-head">
                      <div>
                        <h2>{monthLabel(month)}</h2>
                        <p className="subtitle !mt-1 !text-xs">
                          {schedule.nome_funcionario ?? employee?.nome}{" "}
                          <span className="mx-1">·</span> {schedule.modelo_nome}
                        </p>
                      </div>
                      <div className="actions">
                        <button
                          className="button small"
                          disabled={busy || !company}
                          onClick={() =>
                            perform(async () => {
                              if (company)
                                await exportPDF(
                                  schedule,
                                  data.rules,
                                  company,
                                  employee,
                                );
                            })
                          }
                        >
                          <FileText size={14} />
                          PDF
                        </button>
                        <button
                          className="button small"
                          disabled={busy || !company}
                          onClick={() =>
                            perform(async () => {
                              if (company)
                                await exportExcel(
                                  schedule,
                                  data.rules,
                                  company,
                                  data.employees.find(
                                    (e) => e.id === schedule.funcionario_id,
                                  ),
                                );
                            })
                          }
                        >
                          <FileSpreadsheet size={14} />
                          Excel
                        </button>
                        <button
                          className="button small"
                          disabled={busy}
                          onClick={() =>
                            exportCSV(
                              schedule,
                              data.rules,
                              data.employees.find(
                                (e) => e.id === schedule.funcionario_id,
                              ),
                            )
                          }
                        >
                          <Download size={14} />
                          CSV
                        </button>
                        <button
                          className="button primary small"
                          disabled={
                            busy || scheduleReadOnly || (!dirty && !!saved)
                          }
                          onClick={() => perform(saveCurrent)}
                        >
                          <Check size={14} />
                          {saveState === "saving"
                            ? "Salvando…"
                            : dirty || !saved
                              ? "Salvar escala"
                              : "Escala salva"}
                        </button>
                      </div>
                    </div>
                    <div
                      className="calendar"
                      role="grid"
                      aria-label={`Calendário de ${monthLabel(month)}`}
                    >
                      {["SEG", "TER", "QUA", "QUI", "SEX", "SÁB", "DOM"].map(
                        (n) => (
                          <div
                            role="columnheader"
                            className="cal-heading"
                            key={n}
                          >
                            {n}
                          </div>
                        ),
                      )}
                      {Array.from(
                        {
                          length: (dateUTC(`${month}-01`).getUTCDay() + 6) % 7,
                        },
                        (_, i) => (
                          <div key={`blank-${i}`} className="day blank" />
                        ),
                      )}
                      {schedule.dias
                        .filter((d) => d.data.startsWith(month))
                        .map((d) => {
                          const dayAlerts = alertsForDate(
                            alertSummary.groups,
                            d.data,
                          );
                          const violations = dayAlerts.filter(
                            (a) => a.category === "violation",
                          );
                          const attention = dayAlerts.filter(
                            (a) => a.category === "attention",
                          );
                          const problem = violations.length
                            ? "violation"
                            : attention.length
                              ? "attention"
                              : "";
                          return (
                            <button
                              key={d.data}
                              id={`escala-dia-${d.data}`}
                              data-date={d.data}
                              data-problem={problem || undefined}
                              aria-selected={activeDate === d.data}
                              role="gridcell"
                              disabled={scheduleReadOnly}
                              className={`day ${computeDay(d, data.rules, schedule.dias).worked === 0 ? "rest" : ""} ${problem ? `has-${problem}` : ""} ${activeDate === d.data ? "selected" : ""}`}
                              onClick={() => edit("dia", d)}
                              aria-label={`${dateLabel(d.data)}${violations.length ? `, ${violations.length} violações impeditivas` : attention.length ? `, ${attention.length} avisos` : ""}: ${d.intervalos.length ? shiftText(d.intervalos) : computeDay(d, data.rules, schedule.dias).worked > 0 ? "Continuação do turno anterior" : "Folga"}. Editar.`}
                            >
                              <span className="day-number">
                                <span className="desktop-day">
                                  {+d.data.slice(-2)}
                                </span>
                                <span className="mobile-date">
                                  {dateLabel(d.data)}
                                </span>
                                {problem && (
                                  <AlertTriangle size={16} aria-hidden="true" />
                                )}
                              </span>
                              {d.intervalos.length ? (
                                <>
                                  <span className="day-time">
                                    {d.intervalos.map((s, i) => (
                                      <span key={i} className="block">
                                        {s.start} — {s.end}
                                        {span(s)[1] >= 1440 ? " +1" : ""}
                                      </span>
                                    ))}
                                  </span>
                                  <span className="day-hours">
                                    {formatMinutes(
                                      computeDay(d, data.rules, schedule.dias)
                                        .computed,
                                    )}
                                  </span>
                                </>
                              ) : (
                                <span className="rest-label">
                                  {computeDay(d, data.rules, schedule.dias)
                                    .worked > 0 ? (
                                    <>
                                      Continuação
                                      <br />
                                      {formatMinutes(
                                        computeDay(d, data.rules, schedule.dias)
                                          .computed,
                                      )}
                                    </>
                                  ) : (
                                    "Folga"
                                  )}
                                </span>
                              )}
                              {problem && (
                                <span className={`day-problem ${problem}`}>
                                  {violations.length
                                    ? `${violations.length} impedimento(s)`
                                    : `${attention.length} aviso(s)`}
                                </span>
                              )}
                              {d.feriado && (
                                <span className="holiday">{d.feriado}</span>
                              )}
                              {d.observacao && (
                                <span className="holiday special-day-label">
                                  Com observação
                                </span>
                              )}
                            </button>
                          );
                        })}
                    </div>
                    <div className="legend">
                      <span>
                        <span className="dot work-dot mr-1" />
                        Dia trabalhado
                      </span>
                      <span>
                        <span className="dot rest-dot mr-1" />
                        Folga
                      </span>
                      <span>
                        <AlertTriangle size={15} aria-hidden="true" />
                        Borda vermelha: impedimento · âmbar: atenção
                      </span>
                      <span
                        className="ml-auto save-status"
                        role="status"
                        aria-live="polite"
                      >
                        {saveLabel}
                        {dirty ? " · alterações locais" : ""}
                      </span>
                    </div>
                  </section>
                  <div className="grid2">
                    <section className="panel">
                      <div className="panel-head">
                        <h2>Conferência semanal</h2>
                        <span className="pill">SEG A DOM</span>
                      </div>
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Semana</th>
                              <th>Horas / teto</th>
                              <th>Descansos</th>
                            </tr>
                          </thead>
                          <tbody>
                            {report?.weeks.map((w) => (
                              <tr
                                key={w.start}
                                className={
                                  alertSummary.violations.some((group) =>
                                    group.periods.some(
                                      (p) =>
                                        p.start <= w.end && p.end >= w.start,
                                    ),
                                  )
                                    ? "week-conflict"
                                    : ""
                                }
                              >
                                <td>
                                  <button
                                    className="week-link"
                                    onClick={() =>
                                      openAlertDay(
                                        w.start < `${month}-01`
                                          ? `${month}-01`
                                          : w.start,
                                      )
                                    }
                                  >
                                    {dateLabel(w.start).slice(0, 5)} a{" "}
                                    {dateLabel(w.end).slice(0, 5)}
                                    {alertSummary.violations.some((group) =>
                                      group.periods.some(
                                        (p) =>
                                          p.start <= w.end && p.end >= w.start,
                                      ),
                                    )
                                      ? " · conflito"
                                      : ""}
                                  </button>
                                </td>
                                <td>
                                  <span
                                    className={`pill ${w.limit !== undefined && w.total > w.limit ? "warn" : ""}`}
                                  >
                                    {formatMinutes(w.total)} /{" "}
                                    {w.limit !== undefined
                                      ? formatMinutes(w.limit)
                                      : "—"}
                                  </span>
                                </td>
                                <td>{w.rests} dia(s)</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                    <section className="panel">
                      <div className="panel-head">
                        <h2>Continuidade do planejamento</h2>
                        <Copy size={17} className="muted" />
                      </div>
                      <div className="panel-body">
                        <p className="subtitle !mt-0">
                          Recrie as escalas em{" "}
                          <strong>{monthLabel(nextMonth(month))}</strong> com os
                          mesmos modelos. Os feriados e as vigências serão
                          recalculados. Horários e ajustes são copiados por
                          ocorrência do dia da semana (ex.: primeira
                          segunda-feira). Feriados de origem não viram folgas no
                          destino. Ciclos 12×36 seguem a âncora, sem copiar
                          ajustes manuais.
                        </p>
                        <div className="actions mt-5">
                          <button
                            className="button"
                            disabled={busy || dirty || scheduleReadOnly}
                            onClick={() => perform(() => duplicate(false))}
                          >
                            <Copy size={14} />
                            Este funcionário
                          </button>
                          <button
                            className="button"
                            disabled={busy || dirty || scheduleReadOnly}
                            onClick={() => perform(() => duplicate(true))}
                          >
                            <Building2 size={14} />
                            Toda a empresa
                          </button>
                        </div>
                        {dirty && (
                          <p className="warning-text mt-3">
                            Salve a prévia antes de duplicar.
                          </p>
                        )}
                        {model && (
                          <div className="section-divider mt-6 pt-5 border-t">
                            <h3>Texto para o Domínio</h3>
                            <p className="subtitle text-xs">
                              {dominioText(model)}
                            </p>
                            <button
                              className="button small mt-3"
                              onClick={() =>
                                perform(async () => {
                                  await navigator.clipboard.writeText(
                                    dominioText(model),
                                  );
                                  notify(
                                    "Texto do modelo copiado. Ajustes manuais do calendário não alteram este texto.",
                                  );
                                })
                              }
                            >
                              <Copy size={13} />
                              Copiar horário do modelo
                            </button>
                          </div>
                        )}
                      </div>
                    </section>
                  </div>
                </>
              )}
            </>
          )}
          {page === "empresas" && (
            <CompanyDirectory
              data={data}
              month={month}
              onCreate={() => edit("empresa")}
              onOpen={openCompany}
              onEdit={(c) => edit("empresa", c)}
            />
          )}
          {page === "funcionarios" && (
            <EmployeeDirectory
              data={data}
              companyId={companyScopeId ?? undefined}
              month={month}
              onEdit={(e) => edit("funcionario", e)}
              onOpen={openEmployee}
              onSchedules={employeeSchedules}
              onToggleStatus={toggleEmployeeStatus}
            />
          )}
          {page === "employee-detail" && detailEmployee && scopedCompany && (
            <EmployeeDetails
              employee={detailEmployee}
              company={scopedCompany}
              data={{ ...data, logs: scopedData.logs }}
              month={month}
              onEdit={(e) => edit("funcionario", e)}
              onSchedules={employeeSchedules}
              onClose={() => setPage("funcionarios")}
            />
          )}
          {page === "modelos" && (
            <>
              <div className="page-head">
                <div>
                  <div className="eyebrow">JORNADAS REUTILIZÁVEIS</div>
                  <h1>Modelos de jornada</h1>
                  <p className="subtitle">
                    Padronize horários e personalize turnos por dia da semana.
                  </p>
                </div>
                <button
                  className="button primary"
                  onClick={() => edit("modelo")}
                >
                  <Plus size={16} />
                  Novo modelo
                </button>
              </div>
              <div className="grid2">
                {scopedData.models.map((m) => (
                  <section className="panel" key={m.id}>
                    <div className="panel-head">
                      <h2>{m.nome}</h2>
                      <span className="pill">{m.tipo}</span>
                    </div>
                    <div className="panel-body">
                      <p className="subtitle !mt-0 !text-xs">
                        {dominioText(m)}
                      </p>
                      <p className="muted text-[11px] mt-4">
                        {m.empresa_id
                          ? data.companies.find((c) => c.id === m.empresa_id)
                              ?.nome
                          : "Disponível para todas as suas empresas"}
                      </p>
                      <div className="actions mt-5">
                        <button
                          className="button small"
                          onClick={() => edit("modelo", m)}
                        >
                          {companyScopeId && !m.empresa_id
                            ? "Personalizar nesta empresa"
                            : "Editar modelo"}
                        </button>
                        <button
                          className="button small"
                          onClick={() =>
                            perform(async () => {
                              await navigator.clipboard.writeText(
                                dominioText(m),
                              );
                              notify("Horário copiado para colar no Domínio.");
                            })
                          }
                        >
                          <Copy size={13} />
                          Copiar para o Domínio
                        </button>
                      </div>
                    </div>
                  </section>
                ))}
              </div>
              {!scopedData.models.length && (
                <section className="panel">
                  <Empty text="Crie um modelo ou importe os modelos iniciais em Parâmetros legais." />
                </section>
              )}
              <div className="banner">
                <AlertTriangle size={17} />
                <div>
                  42h em cinco dias equivale a 8h24 por dia. Essa distribuição,
                  o modelo com 10h e o ciclo 12×36 precisam ser compatíveis com
                  os limites e a CCT da empresa; o modelo não autoriza exceções
                  por si só.
                </div>
              </div>
            </>
          )}
          {page === "feriados" && (
            <>
              {scopedCompany && (
                <div className="banner neutral">
                  <Flag size={18} />
                  <div>
                    Este calendário mostra as datas oficiais aplicáveis a{" "}
                    {scopedCompany.nome}. A edição da data legal é
                    compartilhada; o funcionamento por empresa será configurado
                    em etapa própria.
                    <button
                      className="button small"
                      onClick={() => navigate("feriados")}
                    >
                      Gerenciar calendário global
                    </button>
                  </div>
                </div>
              )}
              <div className="page-head">
                <div>
                  <div className="eyebrow">CALENDÁRIO DE DESCANSO</div>
                  <h1>Feriados</h1>
                  <p className="subtitle">
                    Nacionais, estaduais e municipais. O gerador considera a
                    localidade da empresa.
                  </p>
                </div>
                <div className="actions">
                  <button
                    className="button"
                    disabled={busy || !!companyScopeId}
                    onClick={() =>
                      perform(async () => {
                        const year = Number(month.slice(0, 4));
                        if (demo) {
                          const { initialHolidays } =
                            await import("@/lib/presets");
                          const hs = initialHolidays(year)
                            .filter(
                              (h) =>
                                !data.holidays.some(
                                  (x) => x.data === h.data && x.nome === h.nome,
                                ),
                            )
                            .map((h) => ({ ...h, id: crypto.randomUUID() }));
                          setData((d) => ({
                            ...d,
                            holidays: [...d.holidays, ...hs],
                          }));
                        } else {
                          await importHolidays(year);
                          await refresh();
                        }
                        notify(
                          `Feriados fixos nacionais e de PE importados para ${year}. Cadastre feriados móveis e municipais após conferência.`,
                        );
                      })
                    }
                  >
                    <Download size={14} />
                    Importar fixos {month.slice(0, 4)}
                  </button>
                  <button
                    className="button primary"
                    disabled={!!companyScopeId}
                    onClick={() => edit("feriado")}
                  >
                    <Plus size={16} />
                    Novo feriado
                  </button>
                </div>
              </div>
              <div className="banner">
                <Flag size={18} />
                <span>
                  A importação cobre datas fixas nacionais e a Data Magna de PE.
                  Não inclui feriados móveis, pontos facultativos ou feriados
                  municipais. Confira o calendário oficial de cada cidade.
                </span>
              </div>
              <section className="panel">
                {scopedData.holidays.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Data</th>
                          <th>Feriado</th>
                          <th>Abrangência</th>
                          <th>Localidade</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {[...scopedData.holidays]
                          .sort((a, b) => a.data.localeCompare(b.data))
                          .map((h) => (
                            <tr key={h.id}>
                              <td>{dateLabel(h.data)}</td>
                              <td>
                                <strong>{h.nome}</strong>
                              </td>
                              <td>
                                <span className="pill">{h.abrangencia}</span>
                              </td>
                              <td>
                                {h.cidade ? h.cidade + " / " : ""}
                                {h.uf ?? "Brasil"}
                              </td>
                              <td>
                                <button
                                  className="button small"
                                  disabled={!!companyScopeId}
                                  onClick={() => edit("feriado", h)}
                                >
                                  Editar
                                </button>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty text="Nenhum feriado cadastrado. Importe os fixos e complete o calendário local." />
                )}
              </section>
            </>
          )}
          {page === "regras" && (
            <>
              <div className="page-head">
                <div>
                  <div className="eyebrow">TRANSPARÊNCIA EM CADA CÁLCULO</div>
                  <h1>Parâmetros legais</h1>
                  <p className="subtitle">
                    Valores, vigências e fontes editáveis. A regra mais recente
                    em vigor vale para cada data.
                  </p>
                </div>
                <div className="actions">
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() =>
                      perform(async () => {
                        if (demo) {
                          notify(
                            "A demonstração já inclui os parâmetros e modelos iniciais.",
                          );
                          return;
                        }
                        await importDefaults(data);
                        await refresh();
                        notify(
                          "Cadastros iniciais importados. Revise antes de confirmar as regras.",
                        );
                      })
                    }
                  >
                    <Download size={14} />
                    Importar referências
                  </button>
                  <button
                    className="button primary"
                    onClick={() => edit("regra")}
                  >
                    <Plus size={15} />
                    Nova regra
                  </button>
                </div>
              </div>
              <div className="banner">
                <AlertTriangle size={19} />
                <div>
                  <strong>Vigências propostas, não validadas.</strong>
                  <br />
                  Não foi confirmada a premissa da EC nº 141/2026. As fases de
                  42h e 40h são hipóteses fornecidas no pedido. Confira o ato
                  oficial, a data de corte (15 ou 16/12) e a CCT. Não aprove uma
                  escala com base apenas nesses exemplos.
                </div>
              </div>
              <section className="panel">
                {data.rules.length ? (
                  [...data.rules]
                    .sort(
                      (a, b) =>
                        a.chave.localeCompare(b.chave) ||
                        a.inicio_vigencia.localeCompare(b.inicio_vigencia),
                    )
                    .map((r) => (
                      <div className="legal-card" key={r.id}>
                        <div className="actions justify-between">
                          <div>
                            <h3>{r.nome}</h3>
                            <p className="subtitle !mt-1 !text-[11px]">
                              Vigência a partir de{" "}
                              {dateLabel(r.inicio_vigencia)} · {r.chave}
                            </p>
                          </div>
                          <div className="actions">
                            <span
                              className={`pill ${r.confirmado ? "" : "warn"}`}
                            >
                              {r.confirmado
                                ? "Conferida"
                                : "Pendente de conferência"}
                            </span>
                            <button
                              className="button small"
                              onClick={() => edit("regra", r)}
                            >
                              Editar regra
                            </button>
                          </div>
                        </div>
                        <div className="legal-values">
                          {Object.entries(r.valor).map(([k, v]) => (
                            <span key={k}>
                              {k.replaceAll("_", " ")}:{" "}
                              <b>
                                {typeof v === "boolean"
                                  ? v
                                    ? "sim"
                                    : "não"
                                  : v}
                              </b>
                            </span>
                          ))}
                        </div>
                        <p className="alert-source">Fonte: {r.fonte}</p>
                        <p className="warning-text mt-2">{r.observacao}</p>
                      </div>
                    ))
                ) : (
                  <Empty text="Importe as referências iniciais ou cadastre suas próprias regras com fonte." />
                )}
              </section>
              <div className="banner neutral">
                <BookOpen size={18} />
                <span>
                  Os cálculos leem estes valores do banco. Na semana com mudança
                  de regime, o motor usa preventivamente o menor teto e gera um
                  alerta explícito. Essa política de conferência não presume uma
                  fórmula legal de proporcionalização.
                </span>
              </div>
            </>
          )}
          {page === "historico" && (
            <AuditHistory
              logs={scopedData.logs}
              companies={data.companies}
              userId={user?.id}
              demo={demo}
              loading={!demo && !!companyScopeId && companyAudit.loading}
              error={!demo && !!companyScopeId ? companyAudit.error : undefined}
              hasMore={!demo && !!companyScopeId && companyAudit.hasMore}
              onLoadMore={() => void loadMoreHistory()}
            />
          )}
          <p className="footer-note">
            Cont Contábil · Gerador de Jornadas
            <br />
            Confira a legislação vigente e a convenção coletiva antes de aprovar
            as escalas.
          </p>
        </div>
      </main>
      {modal && (
        <Dialog
          title={`${modal.row ? "Editar" : "Cadastrar"} ${{ empresa: "empresa", funcionario: "funcionário", modelo: "modelo de jornada", feriado: "feriado", regra: "parâmetro legal", dia: "dia da escala" }[modal.kind]}`}
          close={() => setModal(null)}
        >
          <form onSubmit={formSubmit}>
            <div className="form-grid">
              {modal.kind === "empresa" && (
                <CompanyFields
                  company={modal.row as unknown as Company | undefined}
                  models={data.models}
                />
              )}
              {modal.kind === "funcionario" && (
                <EmployeeFields
                  employee={modal.row as unknown as Employee | undefined}
                  companies={data.companies}
                  models={data.models}
                  companyId={companyScopeId ?? undefined}
                />
              )}
              {modal.kind === "modelo" && (
                <>
                  {(companyScopeId || modal.row?.id) && (
                    <input
                      type="hidden"
                      name="empresa_id"
                      value={
                        companyScopeId ?? String(modal.row?.empresa_id ?? "")
                      }
                    />
                  )}
                  <Field label="Nome do modelo">
                    <input
                      name="nome"
                      required
                      defaultValue={String(modal.row?.nome ?? "")}
                    />
                  </Field>
                  <Field label="Tipo de jornada">
                    <select
                      name="tipo"
                      defaultValue={String(modal.row?.tipo ?? "5x2")}
                    >
                      {["5x2", "6x1", "12x36", "turnos", "personalizado"].map(
                        (t) => (
                          <option key={t}>{t}</option>
                        ),
                      )}
                    </select>
                  </Field>
                  <div className="span2">
                    <Field label="Disponível para">
                      <select
                        name="empresa_id"
                        disabled={!!companyScopeId || !!modal.row?.id}
                        defaultValue={String(modal.row?.empresa_id ?? "")}
                      >
                        <option value="">Todas as minhas empresas</option>
                        {data.companies.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.nome}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <p className="subtitle span2 !text-xs !mt-0">
                    Use 08:00-12:00, 13:00-17:24. Deixe em branco para folga.
                    Horários noturnos: 22:00-05:00 +1. Os dias abaixo valem para
                    modelos semanais e turnos.
                  </p>
                  <div className="week-editor span2">
                    {dayNames.map((n, i) => (
                      <div className="week-row" key={i}>
                        <label htmlFor={`dia${i}`}>{n.slice(0, 3)}</label>
                        <input
                          id={`dia${i}`}
                          name={`dia${i}`}
                          aria-label={`Horários de ${n}`}
                          placeholder="Folga"
                          defaultValue={shiftText(
                            (modal.row?.padrao as WeekPattern | undefined)?.[
                              String(i)
                            ] ??
                              (i > 0 && i < 6
                                ? [
                                    { start: "08:00", end: "12:00" },
                                    { start: "13:00", end: "17:24" },
                                  ]
                                : []),
                          )}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="section-divider span2 border-t pt-4">
                    <h3>Somente para ciclo 12×36</h3>
                    <p className="subtitle !text-xs mb-4">
                      O ciclo alterna dia de turno e dia de descanso a partir da
                      data inicial. Cadastre intervalos e confira a CCT.
                    </p>
                    <div className="form-grid">
                      <Field label="Primeiro dia de turno">
                        <input
                          name="ciclo_inicio"
                          type="date"
                          defaultValue={String(modal.row?.ciclo_inicio ?? "")}
                        />
                      </Field>
                      <Field label="Turno e pausas">
                        <input
                          name="turno"
                          placeholder="07:00-12:00, 13:00-19:00"
                          defaultValue={shiftText(
                            (modal.row?.turno ?? []) as Shift[],
                          )}
                        />
                      </Field>
                    </div>
                  </div>
                </>
              )}
              {modal.kind === "feriado" && (
                <>
                  <Field label="Nome do feriado">
                    <input
                      name="nome"
                      required
                      defaultValue={String(modal.row?.nome ?? "")}
                    />
                  </Field>
                  <Field label="Data">
                    <input
                      name="data"
                      type="date"
                      required
                      defaultValue={String(modal.row?.data ?? "")}
                    />
                  </Field>
                  <Field label="Abrangência">
                    <select
                      name="abrangencia"
                      defaultValue={String(
                        modal.row?.abrangencia ?? "municipal",
                      )}
                    >
                      <option value="nacional">Nacional</option>
                      <option value="estadual">Estadual</option>
                      <option value="municipal">Municipal</option>
                    </select>
                  </Field>
                  <Field label="UF (estadual ou municipal)">
                    <input
                      name="uf"
                      maxLength={2}
                      pattern="[A-Za-z]{2}"
                      defaultValue={String(modal.row?.uf ?? "PE")}
                    />
                  </Field>
                  <Field label="Cidade (municipal)">
                    <input
                      name="cidade"
                      defaultValue={String(modal.row?.cidade ?? "")}
                    />
                  </Field>
                </>
              )}
              {modal.kind === "regra" && (
                <>
                  <Field label="Nome da regra">
                    <input
                      name="nome"
                      required
                      defaultValue={String(modal.row?.nome ?? "")}
                    />
                  </Field>
                  <LegalFields row={modal.row} />
                  <Field label="Início da vigência">
                    <input
                      name="inicio"
                      type="date"
                      required
                      defaultValue={String(modal.row?.inicio_vigencia ?? "")}
                    />
                  </Field>
                  <Field label="Fonte / publicação oficial">
                    <input
                      name="fonte"
                      required
                      defaultValue={String(modal.row?.fonte ?? "")}
                    />
                  </Field>
                  <div className="span2">
                    <Field label="Observações e incertezas">
                      <textarea
                        name="observacao"
                        defaultValue={String(modal.row?.observacao ?? "")}
                      />
                    </Field>
                  </div>
                  <label className="check-label span2">
                    <input
                      type="checkbox"
                      name="confirmado"
                      defaultChecked={Boolean(modal.row?.confirmado)}
                    />
                    Conferi a fonte, os valores e a vigência desta regra.
                  </label>
                  <p className="warning-text span2">
                    Confirmar registra sua conferência; não é certificação
                    jurídica. Alterações recalculam a conferência das escalas
                    existentes.
                  </p>
                </>
              )}
              {modal.kind === "dia" && (
                <>
                  <p className="span2 muted">
                    {dateLabel(String(modal.row?.data))} · {employee?.nome}
                  </p>
                  <DayEditor
                    key={String(modal.row?.data)}
                    day={modal.row as unknown as Day}
                    onChange={setEditedDay}
                  />
                  {editedDay && editedReport && (
                    <section
                      className="span2 editor-conference"
                      aria-label="Conferência da edição"
                      aria-live="polite"
                    >
                      <h3>Impacto na escala</h3>
                      {editedReport.weeks
                        .filter(
                          (w) =>
                            w.start <= addDays(editedDay.data, 1) &&
                            w.end >= editedDay.data,
                        )
                        .map((w) => (
                          <p key={w.start}>
                            Semana de {dateLabel(w.start)}:{" "}
                            <strong>{formatMinutes(w.total)}</strong>
                            {report?.weeks.find(
                              (original) => original.start === w.start,
                            ) &&
                              ` (antes: ${formatMinutes(report.weeks.find((original) => original.start === w.start)!.total)})`}
                          </p>
                        ))}
                      {editedAlerts.map((group) => (
                        <p
                          key={group.id}
                          className={
                            group.category === "violation"
                              ? "inline-violation"
                              : "warning-text"
                          }
                        >
                          <strong>
                            {group.category === "violation"
                              ? "Impedimento"
                              : "Atenção"}
                            :
                          </strong>{" "}
                          {(() => {
                            const occurrence =
                              group.occurrences.find(
                                (o) => o.date === editedDay.data,
                              ) ??
                              group.occurrences.find(
                                (o) =>
                                  o.period &&
                                  o.period.start <= editedDay.data &&
                                  o.period.end >= editedDay.data,
                              ) ??
                              group.occurrences.find(
                                (o) => !previousOccurrences.has(o.id),
                              ) ??
                              group.occurrences[0];
                            return `${dateLabel(occurrence.date)} · ${occurrence.message}`;
                          })()}
                        </p>
                      ))}
                      <p className="muted">
                        Fontes pendentes são conferidas separadamente. Horários
                        válidos podem ser salvos na prévia mesmo com alertas;
                        isso não aprova a escala.
                      </p>
                    </section>
                  )}
                </>
              )}
            </div>
            <div className="dialog-actions">
              <button
                className="button"
                type="button"
                onClick={() => setModal(null)}
              >
                Cancelar
              </button>
              <button
                className="button primary"
                disabled={busy || (modal.kind === "dia" && !editedDay)}
              >
                {busy ? (
                  <LoaderCircle size={15} className="animate-spin" />
                ) : (
                  <Check size={15} />
                )}
                Salvar {modal.kind === "dia" ? "na prévia" : "cadastro"}
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {confirmation && (
        <Dialog title={confirmation.title} close={() => setConfirmation(null)}>
          <p className="subtitle !mt-0">{confirmation.message}</p>
          <div className="dialog-actions">
            <button className="button" onClick={() => setConfirmation(null)}>
              Cancelar
            </button>
            <button
              className="button primary"
              onClick={() => {
                const action = confirmation.accept;
                setConfirmation(null);
                action();
              }}
            >
              Confirmar
            </button>
          </div>
        </Dialog>
      )}
      {toast && (
        <div className={`toast ${toast.error ? "error" : ""}`} role="status">
          {toast.text}
          <button aria-label="Fechar mensagem" onClick={() => setToast(null)}>
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
