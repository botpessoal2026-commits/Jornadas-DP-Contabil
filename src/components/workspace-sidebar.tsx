"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Building2,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  Clock3,
  FileText,
  Flag,
  History,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  X,
} from "lucide-react";
import type { WorkspacePage } from "@/lib/workspace-navigation";
import Brand from "./brand";
import { brandAssets } from "@/lib/brand-assets";

const navigationGroups = [
  {
    label: "Painel",
    items: [{ page: "inicio", label: "Visão geral", icon: LayoutDashboard }],
  },
  {
    label: "Planejamento",
    items: [
      { page: "escalas", label: "Escalas mensais", icon: CalendarDays },
      { page: "modelos", label: "Modelos de jornada", icon: Clock3 },
      { page: "feriados", label: "Feriados", icon: Flag },
      { page: "operacoes", label: "Operações", icon: ClipboardList },
    ],
  },
  {
    label: "Cadastros",
    items: [
      { page: "empresas", label: "Empresas", icon: Building2 },
      { page: "funcionarios", label: "Funcionários", icon: Users },
    ],
  },
  {
    label: "Conferência e relatórios",
    items: [
      { page: "relatorios", label: "Relatórios", icon: FileText },
      { page: "historico", label: "Histórico", icon: History },
    ],
  },
  {
    label: "Configurações",
    items: [
      { page: "regras", label: "Parâmetros legais", icon: SlidersHorizontal },
    ],
  },
] as const;

export type SidebarPage =
  (typeof navigationGroups)[number]["items"][number]["page"];

type Props = {
  page: WorkspacePage;
  companyScoped: boolean;
  mobileOpen: boolean;
  onNavigate: (page: SidebarPage) => void;
  onCloseMobile: () => void;
  /** Existing account/logout controls keep their authorization and dirty guards. */
  children: ReactNode;
};

function activeSection(page: WorkspacePage): SidebarPage {
  if (page === "company-overview") return "inicio";
  if (page === "company-settings") return "empresas";
  if (page === "employee-detail") return "funcionarios";
  return page;
}

export default function WorkspaceSidebar({
  page,
  companyScoped,
  mobileOpen,
  onNavigate,
  onCloseMobile,
  children,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileViewport, setMobileViewport] = useState(false);
  const menuRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const closeMobileRef = useRef(onCloseMobile);
  const current = activeSection(page);

  useEffect(() => {
    closeMobileRef.current = onCloseMobile;
  }, [onCloseMobile]);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("cont-contabil-sidebar") === "compact");
    } catch {
      // Navigation also works without browser preference storage.
    }
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const update = () => setMobileViewport(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const media = window.matchMedia("(max-width: 760px)");
    if (!media.matches) {
      closeMobileRef.current();
      return;
    }
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMobileRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        menuRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex="0"]',
        ) ?? [],
      ).filter((element) => element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    const onResize = () => {
      if (!media.matches) closeMobileRef.current();
    };
    document.addEventListener("keydown", handleKey);
    media.addEventListener("change", onResize);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKey);
      media.removeEventListener("change", onResize);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus();
    };
  }, [mobileOpen]);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(
        "cont-contabil-sidebar",
        next ? "compact" : "expanded",
      );
    } catch {
      // A preference failure must not block navigation.
    }
  }

  return (
    <aside
      ref={menuRef}
      id="workspace-menu"
      className={`sidebar workspace-sidebar ${collapsed ? "is-collapsed" : ""} ${mobileOpen ? "open" : ""}`}
      aria-label="Menu principal"
      role={mobileViewport && mobileOpen ? "dialog" : undefined}
      aria-modal={(mobileViewport && mobileOpen) || undefined}
      aria-hidden={(mobileViewport && !mobileOpen) || undefined}
      inert={mobileViewport && !mobileOpen}
    >
      <div className="sidebar-controls">
        <span className="sidebar-context">
          {companyScoped ? "Empresa ativa" : "Escritório"}
        </span>
        <button
          type="button"
          className="sidebar-collapse"
          aria-label={
            collapsed ? "Expandir menu lateral" : "Recolher menu lateral"
          }
          aria-expanded={!collapsed}
          aria-controls="workspace-navigation"
          title={collapsed ? "Expandir menu lateral" : "Recolher menu lateral"}
          onClick={toggleCollapsed}
        >
          {collapsed ? (
            <PanelLeftOpen size={18} aria-hidden="true" />
          ) : (
            <PanelLeftClose size={18} aria-hidden="true" />
          )}
        </button>
        <button
          ref={closeRef}
          type="button"
          className="sidebar-close"
          aria-label="Fechar menu"
          onClick={onCloseMobile}
        >
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      <div className="sidebar-full-brand">
        <Brand light className="sidebar-brand" />
      </div>
      <div className="sidebar-symbol">
        <Image
          src={brandAssets.symbol}
          alt="Cont Contábil — Gerador de Jornadas"
          width={44}
          height={44}
          priority
        />
      </div>
      <nav id="workspace-navigation" aria-label="Áreas de trabalho">
        {navigationGroups.map((group) => (
          <section
            key={group.label}
            className="sidebar-group"
            aria-label={group.label}
          >
            <div className="sidebar-group-label" aria-hidden="true">
              {group.label}
            </div>
            {group.items.map(({ page: target, label, icon: Icon }) => (
              <button
                key={target}
                type="button"
                className={`nav ${current === target ? "active" : ""}`}
                aria-label={label}
                aria-current={current === target ? "page" : undefined}
                title={label}
                onClick={() => onNavigate(target)}
              >
                <Icon size={18} aria-hidden="true" />
                <span className="sidebar-link-label">{label}</span>
                {current === target && (
                  <ChevronRight
                    size={14}
                    className="sidebar-active-arrow"
                    aria-hidden="true"
                  />
                )}
              </button>
            ))}
          </section>
        ))}
      </nav>
      <div className="side-note sidebar-review-note">
        <ShieldCheck size={18} aria-hidden="true" />
        <span>
          Confira os parâmetros e o instrumento aplicável antes de aprovar.
        </span>
      </div>
      <div className="sidebar-account">{children}</div>
    </aside>
  );
}
