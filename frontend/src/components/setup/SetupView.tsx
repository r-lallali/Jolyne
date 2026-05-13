"use client";

import { useShallow } from "zustand/shallow";
import { AgeGate } from "@/components/AgeGate";
import { LangPicker } from "@/components/setup/LangPicker";
import { PseudoInput } from "@/components/setup/PseudoInput";
import { useMatch } from "@/hooks/useMatch";
import { useSessionStore } from "@/stores/sessionStore";

export function SetupView() {
  const { pseudo, speaks, wants, ageAccepted, setPseudo, setLangs, acceptAge } =
    useSessionStore(useShallow((s) => s));
  const { start } = useMatch();

  const pair = speaks && wants ? { speaks, wants } : null;
  const canStart =
    pseudo.length >= 3 && pair !== null && ageAccepted;

  return (
    <div className="flex w-full max-w-md flex-col gap-10">
      <header className="text-center">
        <h1 className="text-lg font-medium tracking-wide text-neutral-300">
          Jolyne
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Parle avec un natif. 1-vs-1, texte uniquement.
        </p>
      </header>

      <PseudoInput value={pseudo} onChange={setPseudo} />

      <LangPicker
        value={pair}
        onChange={(p) => setLangs(p.speaks, p.wants)}
      />

      <AgeGate value={ageAccepted} onChange={acceptAge} />

      <button
        type="button"
        onClick={start}
        disabled={!canStart}
        className="rounded-md bg-neutral-100 px-4 py-2.5 text-sm font-medium text-neutral-950 transition-opacity disabled:opacity-30"
      >
        Commencer
      </button>
    </div>
  );
}
