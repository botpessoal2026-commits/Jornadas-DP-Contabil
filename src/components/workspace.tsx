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
import { supabase, demoOnly } from "@/lib/supabase";
import {
  emptyData,
  importDefaults,
  importHolidays,
  loadData,
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
import { demoData } from "@/lib/demo";
import LegalFields from "./legal-fields";
import { exportCSV, exportExcel, exportPDF } from "@/lib/exports";

type Page =
  | "inicio"
  | "escalas"
  | "empresas"
  | "funcionarios"
  | "modelos"
  | "feriados"
  | "regras"
  | "historico";
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
  useEffect(() => {
    const old = document.activeElement as HTMLElement;
    el.current?.querySelector<HTMLElement>("input,select,button")?.focus();
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "Tab") {
        const elements = el.current?.querySelectorAll<HTMLElement>(
          "button,input,select,textarea,[href]",
        );
        if (!elements?.length) return;
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
  }, [close]);
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
    if (!modelId && data.models.length) setModelId(data.models[0].id);
  }, [data, companyId, modelId]);
  const company = data.companies.find((c) => c.id === companyId);
  const employees = data.employees.filter((e) => e.empresa_id === companyId);
  const employee = employees.find((e) => e.id === employeeId) ?? employees[0];
  const models = data.models.filter(
    (m) => !m.empresa_id || m.empresa_id === companyId,
  );
  const model = models.find((m) => m.id === modelId) ?? models[0];
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
          )
        : null,
    [schedule, company, data.rules],
  );
  const pendingRules = data.rules.filter((r) => !r.confirmado).length;
  const changeContext = (callback: () => void) => {
    if (
      dirty &&
      !window.confirm("Há alterações não salvas. Descartar e trocar a seleção?")
    )
      return;
    callback();
    setDraft(null);
    setDirty(false);
  };
  async function perform(action: () => Promise<void>) {
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
    if (demo) {
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
      setData(
        (d) =>
          ({
            ...d,
            [key]: id
              ? d[key].map((r) => (r.id === id ? { ...r, ...value } : r))
              : [...d[key], { ...value, id: crypto.randomUUID() }],
          }) as Data,
      );
    } else {
      await saveRow(table, value, id);
      await refresh();
    }
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
    if (demo)
      setData((d) => ({
        ...d,
        schedules: [
          ...d.schedules.filter(
            (s) =>
              !items.some(
                (i) => s.funcionario_id === i.funcionario_id && s.mes === i.mes,
              ),
          ),
          ...items.map((i) => ({ ...i, id: i.id || crypto.randomUUID() })),
        ],
      }));
    else {
      await saveSchedules(items);
      await refresh();
    }
  }
  async function saveCurrent() {
    if (!schedule) return;
    await persistSchedules([schedule]);
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
    if (!modal) return;
    const fd = new FormData(event.currentTarget);
    const id = modal.row?.id as string | undefined;
    await perform(async () => {
      if (modal.kind === "empresa") {
        const cnpj = pick(fd, "cnpj").replace(/\D/g, "");
        if (!cnpjValid(cnpj))
          throw new Error("Informe um CNPJ válido com 14 dígitos.");
        const limit = pick(fd, "limite");
        await rowSave(
          "empresas",
          {
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
        await rowSave(
          "funcionarios",
          {
            empresa_id: pick(fd, "empresa_id"),
            nome: pick(fd, "nome"),
            cargo: pick(fd, "cargo"),
            horario_contratual: pick(fd, "horario"),
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
        const shifts = parseShifts(pick(fd, "intervalos"));
        const changed = schedule.dias.map((d) =>
          d.data === modal.row?.data
            ? {
                ...d,
                intervalos: shifts,
                folga: !shifts.length,
                observacao: pick(fd, "observacao"),
              }
            : d,
        );
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
  const edit = (kind: Modal["kind"], row?: object) =>
    setModal({ kind, row: row as Record<string, unknown> });
  const navigate = (p: Page) => {
    setPage(p);
    setMobile(false);
  };
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
          <div className="brand">
            <span className="brand-icon">
              <CalendarDays size={24} />
            </span>
            <div>
              Gerador de Jornadas<small>DEPARTAMENTO PESSOAL</small>
            </div>
          </div>
          <div>
            <div className="eyebrow text-[#a8c5a5]">
              MAIS CLAREZA PARA CADA JORNADA
            </div>
            <h1>
              Tempo bem
              <br />
              organizado.
              <br />
              <span className="text-[#b8d19b]">Pessoas em dia.</span>
            </h1>
            <p>
              Empresas, pessoas e escalas em um só lugar. Planeje o mês com
              regras transparentes e mais tranquilidade para o seu DP.
            </p>
          </div>
          <p className="text-xs">Planejamento · Conferência · Organização</p>
        </section>
        <section className="login-form">
          <div className="login-box">
            <div className="eyebrow">GERADOR DE JORNADAS</div>
            <h1>
              {demoOnly
                ? "Demonstração pessoal"
                : authMode === "signup"
                  ? "Crie seu acesso"
                  : authMode === "reset"
                    ? "Recupere seu acesso"
                    : authMode === "password"
                      ? "Defina uma nova senha"
                      : "Bem-vindo ao seu DP"}
            </h1>
            <p className="subtitle">
              {demoOnly
                ? "Explore o planejamento de jornadas com dados fictícios."
                : authMode === "login"
                  ? "Entre para organizar as jornadas das suas empresas."
                  : "Use seu e-mail de trabalho para continuar."}
            </p>
            {!supabase && (
              <div className="banner mt-6">
                <AlertTriangle size={18} />
                <div>
                  {demoOnly
                    ? "Esta versão é uma demonstração pessoal. As alterações ficam somente nesta sessão, sem acesso a cadastros reais."
                    : "A conexão com o Supabase ainda não foi configurada. Você pode explorar a demonstração com dados fictícios."}
                </div>
              </div>
            )}
            {!demoOnly && (
              <>
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
                          authMode === "login"
                            ? "current-password"
                            : "new-password"
                        }
                        placeholder="Pelo menos 8 caracteres"
                      />
                    </Field>
                  )}
                  <button
                    className="button primary"
                    disabled={busy || !supabase}
                  >
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
                    {authMode === "signup"
                      ? "Já tenho uma conta"
                      : "Criar conta"}
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
              </>
            )}
            <div className="mt-7 border-t border-[#dce5dc] pt-6">
              <button
                className={`button w-full ${demoOnly ? "primary" : ""}`}
                onClick={() => {
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
        <div className="brand">
          <span className="brand-icon">
            <CalendarDays size={23} />
          </span>
          <div>
            Gerador
            <br />
            de Jornadas<small>DEPARTAMENTO PESSOAL</small>
          </div>
        </div>
        <div className="nav-label">ÁREA DE TRABALHO</div>
        {nav.slice(0, 5).map(([id, label, Icon]) => (
          <button
            key={id}
            className={`nav ${page === id ? "active" : ""}`}
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
            <small className="text-[#89a99b]">
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
              Área de trabalho <span className="mx-2 text-[#b3c0b4]">/</span>{" "}
              <strong>{nav.find((n) => n[0] === page)?.[1]}</strong>
            </span>
          </div>
          <div className="top-actions">
            <span className="date-label">Departamento Pessoal</span>
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
          {page === "inicio" && (
            <>
              <div className="page-head">
                <div>
                  <div className="eyebrow">ORGANIZAÇÃO QUE FAZ A DIFERENÇA</div>
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
                        onChange={(e) =>
                          changeContext(() => {
                            setCompanyId(e.target.value);
                            setEmployeeId("");
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
                          changeContext(() => setEmployeeId(e.target.value))
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
                          <option key={m.id} value={m.id}>
                            {m.nome}
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
                      disabled={busy || !employee || !model || !company}
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
                      label="Alertas de conferência"
                      value={report?.alerts.length ?? 0}
                      note={`${report?.alerts.filter((a) => a.severity === "erro").length ?? 0} alertas de limite ou configuração`}
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
                          <span className="uppercase tracking-wide text-[9px]">
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
                  <section className="panel">
                    <div className="panel-head">
                      <div>
                        <h2 className="capitalize">{monthLabel(month)}</h2>
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
                          onClick={() => exportCSV(schedule, data.rules)}
                        >
                          <Download size={14} />
                          CSV
                        </button>
                        <button
                          className="button primary small"
                          disabled={busy}
                          onClick={() => perform(saveCurrent)}
                        >
                          <Check size={14} />
                          {dirty ? "Salvar escala" : "Salvar novamente"}
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
                        .map((d) => (
                          <button
                            key={d.data}
                            role="gridcell"
                            className={`day ${computeDay(d, data.rules, schedule.dias).worked === 0 ? "rest" : ""}`}
                            onClick={() => edit("dia", d)}
                            aria-label={`${dateLabel(d.data)}: ${d.intervalos.length ? shiftText(d.intervalos) : computeDay(d, data.rules, schedule.dias).worked > 0 ? "Continuação do turno anterior" : "Folga"}. Editar.`}
                          >
                            <span className="day-number">
                              {+d.data.slice(-2)}
                              {report?.alerts.some(
                                (a) =>
                                  a.date === d.data && a.severity === "erro",
                              ) && <span className="dot" />}
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
                            {d.feriado && (
                              <span className="holiday">{d.feriado}</span>
                            )}
                            {d.observacao && (
                              <span className="holiday text-[#52765b]">
                                Com observação
                              </span>
                            )}
                          </button>
                        ))}
                    </div>
                    <div className="legend">
                      <span>
                        <span className="dot !bg-[#7ba477] mr-1" />
                        Dia trabalhado
                      </span>
                      <span>
                        <span className="dot !bg-[#c8d1c0] mr-1" />
                        Folga
                      </span>
                      <span>
                        <span className="dot mr-1" />
                        Alerta para conferir
                      </span>
                      <span className="ml-auto">
                        {dirty ? "Prévia não salva" : "Escala salva"}
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
                              <tr key={w.start}>
                                <td>
                                  {dateLabel(w.start).slice(0, 5)} a{" "}
                                  {dateLabel(w.end).slice(0, 5)}
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
                            disabled={busy || dirty}
                            onClick={() => perform(() => duplicate(false))}
                          >
                            <Copy size={14} />
                            Este funcionário
                          </button>
                          <button
                            className="button"
                            disabled={busy || dirty}
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
                          <div className="mt-6 pt-5 border-t border-[#e4eae0]">
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
                  <section className="panel">
                    <div className="panel-head">
                      <h2>Alertas e fontes</h2>
                      <span className="pill warn">
                        {report?.alerts.length ?? 0} PARA CONFERIR
                      </span>
                    </div>
                    <div className="alert-list">
                      {report?.alerts.length ? (
                        report.alerts.map((a, i) => (
                          <div
                            className={`alert-row ${a.severity === "erro" ? "error" : ""}`}
                            key={i}
                          >
                            <AlertTriangle size={16} />
                            <div>
                              <strong>{dateLabel(a.date)}</strong> · {a.message}
                              <div className="alert-source">
                                {a.rule} · {a.source}
                              </div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="panel-body muted text-xs">
                          Sem alertas nos parâmetros cadastrados. Isso não
                          substitui a conferência da CCT.
                        </div>
                      )}
                    </div>
                  </section>
                </>
              )}
            </>
          )}
          {page === "empresas" && (
            <>
              <div className="page-head">
                <div>
                  <div className="eyebrow">SEUS CLIENTES</div>
                  <h1>Empresas</h1>
                  <p className="subtitle">
                    Mantenha as convenções e permissões de cada empresa
                    organizadas.
                  </p>
                </div>
                <button
                  className="button primary"
                  onClick={() => edit("empresa")}
                >
                  <Plus size={16} />
                  Nova empresa
                </button>
              </div>
              <section className="panel">
                {data.companies.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Empresa / CNPJ</th>
                          <th>Localidade</th>
                          <th>Limite diário</th>
                          <th>Configurações</th>
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
                              {c.limite_diario_minutos
                                ? formatMinutes(c.limite_diario_minutos)
                                : "Parâmetro legal"}
                            </td>
                            <td>
                              <div className="actions">
                                <span
                                  className={`pill ${c.permite_6x1 ? "warn" : ""}`}
                                >
                                  {c.permite_6x1 ? "6×1 autorizada" : "Sem 6×1"}
                                </span>
                                {c.usa_banco_horas && (
                                  <span className="pill">Banco de horas</span>
                                )}
                              </div>
                              <small className="muted block mt-2">
                                {c.cct || "CCT ainda não informada"}
                              </small>
                            </td>
                            <td>
                              <button
                                className="button small"
                                onClick={() => edit("empresa", c)}
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
                  <Empty text="Cadastre a primeira empresa para começar." />
                )}
              </section>
              <div className="banner">
                <ShieldCheck size={18} />
                <div>
                  Limites específicos e autorização de 6×1 devem ter respaldo no
                  instrumento aplicável. O banco de horas é um cadastro de
                  permissão: não cancela alertas nem mantém saldo financeiro.
                </div>
              </div>
            </>
          )}
          {page === "funcionarios" && (
            <>
              <div className="page-head">
                <div>
                  <div className="eyebrow">PESSOAS E CONTRATOS</div>
                  <h1>Funcionários</h1>
                  <p className="subtitle">
                    Cadastros essenciais para planejar jornadas. Não coletamos
                    CPF.
                  </p>
                </div>
                <button
                  className="button primary"
                  disabled={!data.companies.length}
                  onClick={() => edit("funcionario")}
                >
                  <Plus size={16} />
                  Novo funcionário
                </button>
              </div>
              <section className="panel">
                {data.employees.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Nome / cargo</th>
                          <th>Empresa</th>
                          <th>Horário contratual</th>
                          <th>Descansos contratuais</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {data.employees.map((e) => (
                          <tr key={e.id}>
                            <td>
                              <strong>{e.nome}</strong>
                              <small className="muted">{e.cargo}</small>
                            </td>
                            <td>
                              {
                                data.companies.find(
                                  (c) => c.id === e.empresa_id,
                                )?.nome
                              }
                            </td>
                            <td>{e.horario_contratual || "Não informado"}</td>
                            <td>
                              {e.dias_descanso
                                .map((d) => dayNames[d].slice(0, 3))
                                .join(", ")}
                            </td>
                            <td>
                              <button
                                className="button small"
                                onClick={() => edit("funcionario", e)}
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
                  <Empty
                    text={
                      data.companies.length
                        ? "Nenhum funcionário cadastrado."
                        : "Cadastre uma empresa antes de adicionar funcionários."
                    }
                  />
                )}
              </section>
              <div className="banner neutral">
                <BookOpen size={17} />
                <span>
                  Os descansos contratuais ficam registrados no cadastro. O
                  gerador segue os dias do modelo selecionado; confira se o
                  modelo corresponde ao contrato antes de salvar.
                </span>
              </div>
            </>
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
                {data.models.map((m) => (
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
                          Editar modelo
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
              {!data.models.length && (
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
                    disabled={busy}
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
                {data.holidays.length ? (
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
                        {[...data.holidays]
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
            <>
              <div className="page-head">
                <div>
                  <div className="eyebrow">RASTREABILIDADE</div>
                  <h1>Histórico de alterações</h1>
                  <p className="subtitle">
                    Últimos 100 registros de alterações da sua conta, gerados
                    pelo banco.
                  </p>
                </div>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => perform(refresh)}
                >
                  <RefreshCw size={14} />
                  Atualizar
                </button>
              </div>
              <section className="panel">
                {data.logs.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Data e hora</th>
                          <th>Cadastro</th>
                          <th>Ação</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.logs.map((l) => (
                          <tr key={l.id}>
                            <td>
                              {new Date(l.alterado_em).toLocaleString("pt-BR", {
                                timeZone: "America/Sao_Paulo",
                              })}
                            </td>
                            <td>{l.tabela.replaceAll("_", " ")}</td>
                            <td>
                              <span className="pill">
                                {(
                                  {
                                    INSERT: "Inclusão",
                                    UPDATE: "Alteração",
                                    DELETE: "Exclusão",
                                  } as Record<string, string>
                                )[l.acao] ?? l.acao}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty
                    text={
                      demo
                        ? "O histórico do banco não é simulado na demonstração."
                        : "Nenhuma alteração registrada ainda."
                    }
                  />
                )}
              </section>
            </>
          )}
          <p className="footer-note">
            Gerador de Jornadas · Planejamento para Departamento Pessoal
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
                <>
                  <Field label="Nome da empresa">
                    <input
                      name="nome"
                      required
                      maxLength={160}
                      defaultValue={String(modal.row?.nome ?? "")}
                    />
                  </Field>
                  <Field label="CNPJ">
                    <input
                      name="cnpj"
                      required
                      inputMode="numeric"
                      maxLength={18}
                      placeholder="00.000.000/0000-00"
                      defaultValue={String(modal.row?.cnpj ?? "")}
                    />
                  </Field>
                  <Field label="Cidade">
                    <input
                      name="cidade"
                      required
                      maxLength={100}
                      defaultValue={String(modal.row?.cidade ?? "Recife")}
                    />
                  </Field>
                  <Field label="UF">
                    <input
                      name="uf"
                      required
                      pattern="[A-Za-z]{2}"
                      maxLength={2}
                      defaultValue={String(modal.row?.uf ?? "PE")}
                    />
                  </Field>
                  <div className="span2">
                    <Field label="CCT aplicável e fundamento das permissões">
                      <textarea
                        name="cct"
                        placeholder="Informe o sindicato, a convenção e as cláusulas aplicáveis."
                        defaultValue={String(modal.row?.cct ?? "")}
                      />
                    </Field>
                  </div>
                  <Field label="Limite diário permitido (horas decimais, opcional)">
                    <input
                      name="limite"
                      type="number"
                      min="0.01"
                      max="24"
                      step="0.01"
                      placeholder="Ex.: 8,4 para 8h24"
                      defaultValue={
                        modal.row?.limite_diario_minutos
                          ? Number(modal.row.limite_diario_minutos) / 60
                          : ""
                      }
                    />
                  </Field>
                  <p className="warning-text self-end">
                    Em branco: segue o parâmetro legal vigente. Um limite
                    específico exige conferência da CCT.
                  </p>
                  <label className="check-label">
                    <input
                      name="permite_6x1"
                      type="checkbox"
                      defaultChecked={Boolean(modal.row?.permite_6x1)}
                    />
                    Permite escala 6×1 pela CCT
                  </label>
                  <label className="check-label">
                    <input
                      name="banco"
                      type="checkbox"
                      defaultChecked={Boolean(modal.row?.usa_banco_horas)}
                    />
                    Usa banco de horas
                  </label>
                </>
              )}
              {modal.kind === "funcionario" && (
                <>
                  <Field label="Empresa">
                    <select
                      name="empresa_id"
                      required
                      defaultValue={String(modal.row?.empresa_id ?? companyId)}
                    >
                      {data.companies.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nome}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Nome do funcionário">
                    <input
                      name="nome"
                      required
                      maxLength={160}
                      defaultValue={String(modal.row?.nome ?? "")}
                    />
                  </Field>
                  <Field label="Cargo">
                    <input
                      name="cargo"
                      maxLength={120}
                      defaultValue={String(modal.row?.cargo ?? "")}
                    />
                  </Field>
                  <Field label="Horário contratual">
                    <input
                      name="horario"
                      placeholder="Ex.: 42h semanais, seg a sex"
                      defaultValue={String(modal.row?.horario_contratual ?? "")}
                    />
                  </Field>
                  <div className="span2">
                    <label>Dias de descanso contratuais</label>
                    <div className="actions mt-3">
                      {dayNames.map((n, i) => (
                        <label key={i} className="check-label">
                          <input
                            type="checkbox"
                            name="descanso"
                            value={i}
                            defaultChecked={(
                              (modal.row?.dias_descanso ?? [0, 6]) as number[]
                            ).includes(i)}
                          />
                          {n.slice(0, 3)}
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              )}
              {modal.kind === "modelo" && (
                <>
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
                  <div className="span2 border-t border-[#e1e9de] pt-4">
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
                  <div className="span2">
                    <Field label="Intervalos de trabalho (vazio = folga)">
                      <input
                        name="intervalos"
                        placeholder="08:00-12:00, 13:00-17:24"
                        defaultValue={shiftText(
                          (modal.row?.intervalos ?? []) as Shift[],
                        )}
                      />
                    </Field>
                  </div>
                  <div className="span2">
                    <Field label="Observação">
                      <textarea
                        name="observacao"
                        defaultValue={String(modal.row?.observacao ?? "")}
                      />
                    </Field>
                  </div>
                  <p className="warning-text span2">
                    Use +1 para término no dia seguinte. Confira os alertas após
                    ajustar o dia e salve a escala.
                  </p>
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
              <button className="button primary" disabled={busy}>
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
