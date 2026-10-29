const workspacePages = [
  "inicio",
  "escalas",
  "empresas",
  "funcionarios",
  "modelos",
  "feriados",
  "regras",
  "historico",
  "operacoes",
  "relatorios",
  "company-overview",
  "company-settings",
  "employee-detail",
] as const;

export type WorkspacePage = (typeof workspacePages)[number];
export type WorkspaceLocation = {
  page: WorkspacePage;
  companyId: string | null;
  employeeId: string | null;
  month?: string;
  scheduleView?: "individual" | "team";
  demo?: boolean;
};

type LocationInput = {
  page?: string;
  companyId?: string | null;
  employeeId?: string | null;
  month?: string | null;
  scheduleView?: string | null;
  demo?: boolean;
  companyRequested?: boolean;
  employeeRequested?: boolean;
};

function referenceId(value?: string | null) {
  const id = value?.trim();
  return id && id.length <= 200 && !/[\u0000-\u001f\u007f]/u.test(id)
    ? id
    : null;
}

function monthValue(value?: string | null) {
  return value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : undefined;
}

function normalizeLocation(input: LocationInput): WorkspaceLocation {
  let companyId = referenceId(input.companyId);
  let page: WorkspacePage =
    input.page === undefined
      ? companyId
        ? "company-overview"
        : "inicio"
      : workspacePages.some((candidate) => candidate === input.page)
        ? (input.page as WorkspacePage)
        : "empresas";

  if (companyId && page === "inicio") page = "company-overview";
  if (
    !companyId &&
    (input.companyRequested ||
      input.employeeRequested ||
      ["company-overview", "company-settings", "employee-detail"].includes(
        page,
      ))
  )
    page = "empresas";
  if (page === "empresas") companyId = null;

  const employeeId = companyId ? referenceId(input.employeeId) : null;
  if (page === "employee-detail" && !employeeId) page = "funcionarios";
  const month = monthValue(input.month);
  return {
    page,
    companyId,
    employeeId,
    ...(month ? { month } : {}),
    scheduleView: input.scheduleView === "team" ? "team" : "individual",
    demo: input.demo === true,
  };
}

/** URL references do not grant access; resolve them against authorized data. */
export function parseWorkspaceLocation(search: string): WorkspaceLocation {
  const params = new URLSearchParams(search);
  const value = (name: string) => {
    const values = params.getAll(name);
    return values.length === 1 ? values[0] : undefined;
  };
  return normalizeLocation({
    page: params.has("pagina") ? (value("pagina") ?? "") : undefined,
    companyId: value("empresa"),
    employeeId: value("funcionario"),
    month: value("mes"),
    scheduleView: value("visao") === "equipe" ? "team" : "individual",
    demo: value("demo") === "1",
    companyRequested: params.has("empresa"),
    employeeRequested: params.has("funcionario"),
  });
}

/** Build local links only, keeping company and employee references together. */
export function workspaceHref(input: {
  page: string;
  companyId?: string | null;
  employeeId?: string | null;
  month?: string;
  scheduleView?: "individual" | "team";
  demo?: boolean;
}): string {
  const location = normalizeLocation({
    ...input,
    companyRequested: Boolean(input.companyId?.trim()),
    employeeRequested: Boolean(input.employeeId?.trim()),
  });
  const params = new URLSearchParams();
  if (location.companyId) params.set("empresa", location.companyId);
  if (location.page !== "inicio") params.set("pagina", location.page);
  if (location.employeeId) params.set("funcionario", location.employeeId);
  if (location.month) params.set("mes", location.month);
  if (location.scheduleView === "team") params.set("visao", "equipe");
  if (location.demo) params.set("demo", "1");
  return params.size ? `/?${params.toString()}` : "/";
}
