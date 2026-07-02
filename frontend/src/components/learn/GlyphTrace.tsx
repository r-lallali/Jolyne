"use client";

import { useEffect, useRef, useState } from "react";
import { Volume2 } from "lucide-react";
import { useT } from "@/lib/i18n";
import { speak, speechSupported } from "@/lib/speech";

// Exercice de TRACÉ : l'apprenant trace le signe au doigt par-dessus un
// glyphe-fantôme. Le tracé est une pratique (pas de pénalité de cœur) : on
// débloque « Continuer » une fois qu'assez de trait a été dessiné.
//
// Amélioration progressive : si l'item fournit des chemins SVG (`strokes`), on
// anime l'ordre des traits en guide (rejouable). Sans données de traits, le
// fantôme suffit — fonctionne pour tous les signes sans donnée par glyphe.
const CANVAS = 300; // résolution interne du canvas (px)
const MIN_POINTS = 12; // points dessinés requis pour valider la pratique

export function GlyphTrace({
  glyph,
  targetLang,
  strokes,
  onDone,
}: {
  glyph: string;
  targetLang: string;
  strokes?: string[];
  onDone: (mistakes: number) => void;
}) {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [points, setPoints] = useState(0);
  // replay : remonte l'animation SVG en changeant la clé.
  const [replay, setReplay] = useState(0);
  const hasStrokes = Array.isArray(strokes) && strokes.length > 0;

  // Réinitialise quand on change de signe (remontage via key amont, mais on
  // sécurise l'état local au cas où).
  useEffect(() => {
    setPoints(0);
    const c = canvasRef.current;
    if (c) {
      const ctx = c.getContext("2d");
      ctx?.clearRect(0, 0, c.width, c.height);
    }
  }, [glyph]);

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * CANVAS,
      y: ((e.clientY - r.top) / r.height) * CANVAS,
    };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    drawing.current = true;
    last.current = pos(e);
    canvasRef.current?.setPointerCapture(e.pointerId);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx || !last.current) return;
    const p = pos(e);
    ctx.strokeStyle = "#10b981"; // emerald-500
    ctx.lineWidth = 14;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    setPoints((n) => n + 1);
  }

  function end() {
    drawing.current = false;
    last.current = null;
  }

  function clear() {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
    setPoints(0);
  }

  const enough = points >= MIN_POINTS;

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">
          {t.learn.script.tracePrompt}
        </p>
        {speechSupported() && (
          <button
            type="button"
            onClick={() => speak(glyph, targetLang)}
            aria-label={t.learn.listen}
            className="rounded-full bg-sky-100 p-2 text-sky-600 transition-colors hover:bg-sky-200 dark:bg-sky-500/15 dark:text-sky-400"
          >
            <Volume2 className="size-5" aria-hidden />
          </button>
        )}
      </div>

      <div className="relative mx-auto mt-5 aspect-square w-full max-w-[300px]">
        {/* Grille de repère */}
        <div className="pointer-events-none absolute inset-0 rounded-2xl border-2 border-dashed border-neutral-200 dark:border-neutral-800">
          <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-neutral-200/70 dark:bg-neutral-800/70" />
          <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-neutral-200/70 dark:bg-neutral-800/70" />
        </div>

        {/* Glyphe-fantôme (guide de fond) */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11rem] leading-none text-neutral-200 dark:text-neutral-800"
        >
          {glyph}
        </div>

        {/* Animation de l'ordre des traits (si données disponibles) */}
        {hasStrokes && (
          <svg
            key={replay}
            aria-hidden
            viewBox="0 0 100 100"
            className="pointer-events-none absolute inset-0 h-full w-full"
          >
            <style>{`@keyframes glyph-stroke{to{stroke-dashoffset:0}}`}</style>
            {strokes!.map((d, i) => (
              <path
                key={i}
                d={d}
                fill="none"
                stroke="#0ea5e9"
                strokeWidth={6}
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength={1}
                style={{
                  strokeDasharray: 1,
                  strokeDashoffset: 1,
                  animation: `glyph-stroke 0.8s ease forwards`,
                  animationDelay: `${i * 0.85}s`,
                }}
              />
            ))}
          </svg>
        )}

        {/* Surface de tracé */}
        <canvas
          ref={canvasRef}
          width={CANVAS}
          height={CANVAS}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          className="absolute inset-0 h-full w-full touch-none rounded-2xl"
        />
      </div>

      <div className="mt-4 flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={clear}
          className="rounded-full px-3 py-1.5 text-xs font-medium text-neutral-500 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
        >
          {t.learn.script.traceClear}
        </button>
        {hasStrokes && (
          <button
            type="button"
            onClick={() => setReplay((r) => r + 1)}
            className="rounded-full px-3 py-1.5 text-xs font-medium text-sky-600 transition-colors hover:text-sky-800 dark:text-sky-400"
          >
            {t.learn.script.showStrokes}
          </button>
        )}
      </div>

      <div className="flex-1" />
      <button
        type="button"
        disabled={!enough}
        onClick={() => onDone(0)}
        className="mt-4 w-full rounded-xl bg-emerald-500 py-3 text-sm font-bold text-white transition-opacity disabled:opacity-40"
      >
        {t.learn.next}
      </button>
    </div>
  );
}
