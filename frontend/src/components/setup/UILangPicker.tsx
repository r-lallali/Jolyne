"use client";

import { useState } from "react";
import { SUPPORTED_LANGS, useT, useUILang } from "@/lib/i18n";
import type { UILang } from "@/lib/i18n/types";
import { useSessionStore } from "@/stores/sessionStore";

// Petit dropdown discret en pied d'écran setup pour forcer la langue UI.
// "Auto" = on retombe sur la résolution speaks → navigator → en.
export function UILangPicker() {
  const t = useT();
  const current = useUILang();
  const setUILang = useSessionStore((s) => s.setUILang);
  const stored = useSessionStore((s) => s.uiLang);
  const [open, setOpen] = useState(false);

  const choose = (v: UILang | null) => {
    setUILang(v);
    setOpen(false);
  };

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-xs text-neutral-500 underline-offset-4 transition-colors hover:text-neutral-900 hover:underline dark:text-neutral-500 dark:hover:text-neutral-100"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {t.langs[current]} ▾
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 overflow-hidden rounded-lg border border-neutral-200 bg-white py-1 text-xs shadow-lg dark:border-neutral-800 dark:bg-neutral-950"
        >
          {SUPPORTED_LANGS.map((lang) => {
            const active = stored === lang;
            return (
              <li key={lang}>
                <button
                  type="button"
                  onClick={() => choose(lang)}
                  className={
                    active
                      ? "block w-full whitespace-nowrap px-4 py-1.5 text-left font-medium text-neutral-900 dark:text-neutral-50"
                      : "block w-full whitespace-nowrap px-4 py-1.5 text-left text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900"
                  }
                >
                  {t.langs[lang]}
                </button>
              </li>
            );
          })}
          <li className="my-1 border-t border-neutral-200 dark:border-neutral-800" />
          <li>
            <button
              type="button"
              onClick={() => choose(null)}
              className={
                stored === null
                  ? "block w-full whitespace-nowrap px-4 py-1.5 text-left font-medium text-neutral-900 dark:text-neutral-50"
                  : "block w-full whitespace-nowrap px-4 py-1.5 text-left text-neutral-500 hover:bg-neutral-100 dark:text-neutral-500 dark:hover:bg-neutral-900"
              }
            >
              Auto
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
