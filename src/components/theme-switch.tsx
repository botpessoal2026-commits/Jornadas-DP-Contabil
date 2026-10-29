"use client";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export default function ThemeSwitch() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    try {
      const preferred = localStorage.getItem("cont-contabil-theme") === "dark";
      setDark(preferred);
      document.documentElement.dataset.theme = preferred ? "dark" : "light";
    } catch {
      // The control still works when the browser disables preference storage.
    }
  }, []);
  function change() {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    try {
      localStorage.setItem("cont-contabil-theme", next ? "dark" : "light");
    } catch {
      // Do not prevent choosing the theme in a private browser session.
    }
  }
  return (
    <button
      type="button"
      className="icon-button theme-switch"
      aria-label={dark ? "Ativar tema claro" : "Ativar tema escuro"}
      aria-pressed={dark}
      title={dark ? "Tema claro" : "Tema escuro"}
      onClick={change}
    >
      {dark ? (
        <Sun size={18} aria-hidden="true" />
      ) : (
        <Moon size={18} aria-hidden="true" />
      )}
    </button>
  );
}
