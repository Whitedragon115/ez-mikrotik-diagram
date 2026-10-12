"use client";

const KEY = "theme";

/** Inline script for <head>: applies a saved theme before first paint to avoid a flash. */
export const themeInitScript = `try{var t=localStorage.getItem("${KEY}");if(t)document.documentElement.dataset.theme=t}catch(e){}`;

export default function ThemeToggle() {
  const toggle = () => {
    const root = document.documentElement;
    const dark = root.dataset.theme
      ? root.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
    root.dataset.theme = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {}
  };
  return (
    <button className="btn" onClick={toggle} title="Toggle theme">
      ◐ Theme
    </button>
  );
}
