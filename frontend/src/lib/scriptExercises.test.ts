import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildScriptExercises } from "@/lib/scriptExercises";
import { speechSupported } from "@/lib/speech";
import type { PlayItem } from "@/lib/learn";

// Le TTS navigateur pilote l'exercice « listen » : mocké pour des tests
// déterministes (jsdom n'a pas SpeechSynthesis).
vi.mock("@/lib/speech", () => ({ speechSupported: vi.fn(() => false) }));

const kana = (target: string, sound: string): PlayItem => ({
  target,
  meaning: sound,
  sound,
});

describe("buildScriptExercises", () => {
  beforeEach(() => {
    vi.mocked(speechSupported).mockReturnValue(false);
  });

  it("renvoie [] sans items exploitables", () => {
    expect(buildScriptExercises([])).toEqual([]);
    expect(buildScriptExercises([{ target: "", meaning: "a" }])).toEqual([]);
  });

  it("alterne recognize/recall, avec recall en repli quand le TTS est absent", () => {
    const ex = buildScriptExercises([kana("あ", "a"), kana("い", "i"), kana("う", "u")]);
    const kinds = ex.filter((e) => e.kind !== "trace" && e.kind !== "match").map((e) => e.kind);
    expect(kinds).toEqual(["recognize", "recall", "recall"]);
  });

  it("propose l'exercice listen quand le TTS est disponible", () => {
    vi.mocked(speechSupported).mockReturnValue(true);
    const ex = buildScriptExercises([kana("あ", "a"), kana("い", "i"), kana("う", "u")]);
    expect(ex.some((e) => e.kind === "listen")).toBe(true);
  });

  it("un item avec jamo devient une composition Hangul complète", () => {
    const ex = buildScriptExercises([
      { target: "가", sound: "ga", meaning: "ga", parts: ["ㄱ", "ㅏ"] },
      kana("나", "na"),
    ]);
    const compose = ex.find((e) => e.kind === "compose");
    if (!compose || compose.kind !== "compose") throw new Error("compose attendu");
    expect(compose.parts).toEqual(["ㄱ", "ㅏ"]);
    for (const p of compose.parts) expect(compose.tiles).toContain(p);
  });

  it("un item à 4 formes devient un QCM de forme positionnelle arabe", () => {
    const forms = ["ب", "بـ", "ـبـ", "ـب"];
    const ex = buildScriptExercises([
      { target: "ب", sound: "b", meaning: "b", forms },
      kana("ت", "t"),
    ]);
    const f = ex.find((e) => e.kind === "forms");
    if (!f || f.kind !== "forms") throw new Error("forms attendu");
    expect(f.position).toBeGreaterThanOrEqual(1);
    expect(f.position).toBeLessThanOrEqual(3);
    expect(f.answer).toBe(forms[f.position]);
    expect(f.options).toContain(f.answer);
  });

  it("saupoudre au plus deux tracés, uniquement sur des signes uniques", () => {
    const ex = buildScriptExercises([
      kana("あ", "a"),
      kana("い", "i"),
      kana("う", "u"),
      { target: "みず", sound: "mizu", meaning: "eau" },
    ]);
    const traces = ex.filter((e) => e.kind === "trace");
    expect(traces.length).toBeLessThanOrEqual(2);
    for (const t of traces) {
      if (t.kind !== "trace") continue;
      expect([...t.glyph]).toHaveLength(1);
    }
  });

  it("termine par une association signe ↔ son cohérente (≥ 3 items)", () => {
    const items = [kana("あ", "a"), kana("い", "i"), kana("う", "u"), kana("え", "e")];
    const ex = buildScriptExercises(items);
    const last = ex[ex.length - 1];
    if (last?.kind !== "match") throw new Error("association attendue en fin");
    expect(last.pairs.length).toBeLessThanOrEqual(4);
    for (const p of last.pairs) {
      const src = items.find((it) => it.target === p.glyph);
      expect(src?.sound).toBe(p.sound);
    }
  });

  it("propage le sens traduit des mots de lecture, pas celui des signes isolés", () => {
    const ex = buildScriptExercises([
      { target: "みず", sound: "mizu", meaning: "eau" },
      kana("あ", "a"),
    ]);
    const word = ex.find((e) => e.kind === "recognize");
    if (!word || word.kind !== "recognize") throw new Error("recognize attendu");
    expect(word.meaning).toBe("eau");
    const sign = ex.find((e) => e.kind === "recall");
    if (sign && sign.kind === "recall") expect(sign.meaning).toBeUndefined();
  });
});
