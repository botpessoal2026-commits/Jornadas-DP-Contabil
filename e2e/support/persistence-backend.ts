import type { Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
type Row = Record<string, unknown>;
export const userA = "a1000000-0000-4000-8000-000000000001";
export const userB = "a1000000-0000-4000-8000-000000000002";

/** Persistent test transport; SDK sessions and application UI remain real. */
export async function backend(page: Page, legacy = false) {
  const users: Array<{
    id: string;
    email: string;
    username: string | null;
    metadata?: Row;
    confirmed?: boolean;
    password?: string;
  }> = [
    {
      id: userA,
      email: "primeira@example.invalid",
      username: legacy ? null : "primeira.dp",
    },
    { id: userB, email: "segunda@example.invalid", username: "segunda.dp" },
  ];
  const tables: Record<string, Row[]> = Object.fromEntries(
    [
      "empresas",
      "funcionarios",
      "modelos_jornada",
      "parametros_legais",
      "feriados",
      "escalas",
      "log_alteracoes",
      "datas_especiais",
      "estabelecimentos",
      "registros_operacionais",
    ].map((name) => [name, []]),
  );
  const writes: string[] = [];
  const unexpected: string[] = [];
  const signups: Row[] = [];
  const rotations: Row[] = [];
  let rotationUnavailable = false;
  let failReadback = false;
  let failNextWriteReadback = false;
  const user = (id: string) => {
    const found = users.find((item) => item.id === id)!;
    return {
      id,
      email: found.email,
      aud: "authenticated",
      role: "authenticated",
      app_metadata: { provider: "email" },
      user_metadata: found.metadata ?? {},
      created_at: "2026-01-01T00:00:00Z",
    };
  };
  const token = (id: string) =>
    [
      Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
        "base64url",
      ),
      Buffer.from(
        JSON.stringify({
          sub: id,
          aud: "authenticated",
          role: "authenticated",
          exp: Math.floor(Date.now() / 1000) + 86400,
        }),
      ).toString("base64url"),
      "transport-test-only",
    ].join(".");
  const actor = (authorization?: string) => {
    try {
      return JSON.parse(
        Buffer.from(
          (authorization ?? "").split(" ")[1].split(".")[1],
          "base64url",
        ).toString(),
      ).sub as string;
    } catch {
      return "";
    }
  };
  const session = (id: string) => ({
    access_token: token(id),
    refresh_token: `test-refresh-${id}`,
    token_type: "bearer",
    expires_in: 86400,
    expires_at: Math.floor(Date.now() / 1000) + 86400,
    user: user(id),
  });
  const respond = async (
    route: Parameters<Parameters<Page["route"]>[1]>[0],
    value: unknown,
    status = 200,
  ) => {
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(value),
    });
  };
  await page.route(/https?:\/\/[^/]+\.supabase\.(?:co|in)\//, async (route) => {
    unexpected.push(route.request().url());
    await route.abort();
  });
  await page.route("**/api/auth/username", async (route) => {
    if (route.request().method() === "GET")
      return respond(route, { available: true });
    const body = route.request().postDataJSON();
    const found = users.find(
      (item) => item.username === String(body.username).trim().toLowerCase(),
    );
    if (!found || body.password !== "senha-teste-123")
      return respond(
        route,
        { error: "Usuário ou senha inválidos.", code: "invalid_credentials" },
        401,
      );
    return respond(route, {
      access_token: token(found.id),
      refresh_token: `test-refresh-${found.id}`,
    });
  });
  await page.route("**/auth/v1/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.pathname.endsWith("/user")) {
      const id = actor(request.headers().authorization);
      return id
        ? respond(route, user(id))
        : respond(route, { message: "Unauthorized" }, 401);
    }
    if (url.pathname.endsWith("/logout")) return respond(route, {});
    if (url.pathname.endsWith("/signup")) {
      const body = request.postDataJSON() as Row;
      signups.push(body);
      if (users.some((item) => item.email === body.email))
        return respond(
          route,
          { code: "user_already_exists", message: "User already registered" },
          422,
        );
      const created = {
        id: randomUUID(),
        email: String(body.email),
        username: null,
        metadata: body.data as Row,
        confirmed: false,
        password: String(body.password),
      };
      users.push(created);
      return respond(route, { user: user(created.id), session: null });
    }
    if (url.pathname.endsWith("/token")) {
      const body = request.postDataJSON();
      const found = users.find(
        (item) =>
          item.email === body.email ||
          `test-refresh-${item.id}` === body.refresh_token,
      );
      if (
        !found ||
        (body.email && body.password !== (found.password ?? "senha-teste-123"))
      )
        return respond(
          route,
          {
            error: "invalid_grant",
            error_description: "Invalid login credentials",
          },
          400,
        );
      if (found.confirmed === false)
        return respond(
          route,
          { code: "email_not_confirmed", message: "Email not confirmed" },
          400,
        );
      return respond(route, session(found.id));
    }
    unexpected.push(url.pathname);
    return respond(route, { message: "Unexpected Auth route" }, 400);
  });
  await page.route("**/rest/v1/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    const path = url.pathname.split("/rest/v1/")[1];
    const id = actor(request.headers().authorization);
    if (!id) return respond(route, { message: "Unauthorized" }, 401);
    if (path === "nomes_login") {
      const found = users.find((item) => item.id === id)!;
      return respond(
        route,
        found.username ? [{ usuario: found.username, user_id: id }] : [],
      );
    }
    if (path.startsWith("rpc/")) {
      const rpc = path.slice(4),
        body = request.postDataJSON();
      if (rpc === "definir_nome_usuario") {
        const found = users.find((item) => item.id === id)!;
        found.username = body.p_usuario;
        return respond(route, found.username);
      }
      if (rpc === "salvar_registro_empresa") {
        const name = String(body.p_tabela),
          values = body.p_valores as Row;
        const rowId = body.p_id ?? randomUUID();
        const previous = tables[name].find(
          (item) => item.id === rowId && item.user_id === id,
        );
        const next = { ...previous, ...values, id: rowId, user_id: id };
        tables[name] = [
          ...tables[name].filter((item) => item.id !== rowId),
          next,
        ];
        writes.push(name);
        return respond(route, rowId);
      }
      if (rpc === "salvar_revezamento_12x36") {
        rotations.push(body);
        if (rotationUnavailable)
          return respond(
            route,
            { code: "PGRST202", message: "Function not found" },
            404,
          );
        const next = structuredClone(tables);
        if (
          !next.empresas.some(
            (company) =>
              company.id === body.p_empresa && company.user_id === id,
          )
        )
          return respond(route, { message: "Sem permissão" }, 403);
        for (const item of body.p_modelos as Row[]) {
          const destination = item.destino as Row;
          if (
            !next.modelos_jornada.some((model) => model.id === destination.id)
          )
            next.modelos_jornada.push({ ...destination, user_id: id });
        }
        for (const assignment of body.p_vinculos as Row[]) {
          const employee = next.funcionarios.find(
            (item) =>
              item.id === assignment.funcionario_id &&
              item.empresa_id === body.p_empresa &&
              item.user_id === id,
          );
          if (
            !employee ||
            (employee.modelo_padrao_id ?? null) !==
              assignment.modelo_padrao_esperado_id
          )
            return respond(route, { message: "Vínculo alterado" }, 409);
          employee.modelo_padrao_id = assignment.modelo_id;
        }
        for (const item of body.itens as Row[]) {
          const old = next.escalas.find(
            (schedule) =>
              schedule.funcionario_id === item.funcionario_id &&
              schedule.mes === item.mes &&
              schedule.user_id === id,
          );
          if (
            old &&
            ["aprovada", "publicada", "fechada"].includes(String(old.status))
          )
            return respond(route, { message: "Escala bloqueada" }, 409);
          next.escalas = next.escalas.filter((schedule) => schedule !== old);
          next.escalas.push({
            ...item,
            id: old?.id ?? randomUUID(),
            user_id: id,
            status: "rascunho",
            revisao: Number(old?.revisao ?? -1) + 1,
          });
        }
        Object.assign(tables, next);
        writes.push("revezamento");
        if (failNextWriteReadback) {
          failReadback = true;
          failNextWriteReadback = false;
        }
        return respond(route, null);
      }
      if (rpc === "salvar_escalas" || rpc === "salvar_escalas_empresa") {
        for (const item of body.itens as Row[]) {
          if (
            !tables.empresas.some(
              (c) => c.id === item.empresa_id && c.user_id === id,
            )
          )
            return respond(route, { message: "Sem permissão" }, 403);
          const old = tables.escalas.find(
            (s) =>
              s.user_id === id &&
              s.funcionario_id === item.funcionario_id &&
              s.mes === item.mes,
          );
          tables.escalas = tables.escalas.filter((s) => s !== old);
          tables.escalas.push({
            ...item,
            id: old?.id ?? randomUUID(),
            user_id: id,
            situacao: "rascunho",
            revisao: Number(old?.revisao ?? -1) + 1,
            versao: 0,
          });
          writes.push("escalas");
        }
        return respond(route, null);
      }
      unexpected.push(rpc);
      return respond(route, { message: "Unexpected RPC" }, 400);
    }
    if (!(path in tables)) {
      unexpected.push(path);
      return respond(route, { message: "Unexpected table" }, 400);
    }
    if (request.method() === "POST") {
      const value = request.postDataJSON();
      const row = { ...value, id: randomUUID(), user_id: id };
      tables[path].push(row);
      writes.push(path);
      if (failNextWriteReadback) {
        failReadback = true;
        failNextWriteReadback = false;
      }
      return respond(route, row, 201);
    }
    if (failReadback && path === "empresas")
      return respond(
        route,
        { message: "Readback temporarily unavailable" },
        503,
      );
    let rows = tables[path].filter((item) => item.user_id === id);
    for (const [key, value] of url.searchParams)
      if (value.startsWith("eq."))
        rows = rows.filter((item) => String(item[key]) === value.slice(3));
    await route.fulfill({
      contentType: "application/json",
      headers: {
        "content-range": rows.length
          ? `0-${rows.length - 1}/${rows.length}`
          : "*/0",
      },
      body: JSON.stringify(rows),
    });
  });
  return {
    users,
    tables,
    writes,
    unexpected,
    signups,
    rotations,
    setRotationUnavailable: (value: boolean) => {
      rotationUnavailable = value;
    },
    sessionFor: session,
    confirmEmail: (email: string) => {
      const found = users.find((u) => u.email === email);
      if (found) found.confirmed = true;
    },
    seedCompany: (id: string, name: string) =>
      tables.empresas.push({
        id: randomUUID(),
        user_id: id,
        nome: name,
        cnpj: "",
        cidade: "Recife",
        uf: "PE",
        cct: "",
        situacao: "ativa",
        permite_6x1: false,
        limite_diario_minutos: null,
        usa_banco_horas: false,
      }),
    failAfterNextWrite: () => {
      failNextWriteReadback = true;
    },
    restoreReadback: () => {
      failReadback = false;
    },
  };
}
