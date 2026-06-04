"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { Fragment } from "react";
import { cn } from "@/lib/cn";
import { useT, useUILang } from "@/lib/i18n";
import { LEGAL_DOCS, type Block, type Inline } from "./content";

// Variants partagés pour le stagger d'entrée — mêmes valeurs que /account
// pour cohérence visuelle de l'app.
const sectionVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.32, ease: "easeOut" as const },
  },
};

const linkClass =
  "underline underline-offset-2 hover:text-neutral-900 dark:hover:text-neutral-100";

// Rend une suite de segments (texte simple, gras, lien) en nœuds React.
function renderInline(inline: Inline) {
  return inline.map((seg, i) => {
    if (typeof seg === "string") return <Fragment key={i}>{seg}</Fragment>;
    if ("b" in seg) return <strong key={i}>{seg.b}</strong>;
    return (
      <a key={i} href={seg.href} className={linkClass}>
        {seg.link}
      </a>
    );
  });
}

// Rend un bloc. `first` retire la marge haute du premier bloc d'une section
// (le titre porte déjà `mb-3`).
function renderBlock(block: Block, first: boolean) {
  const gap = first ? undefined : "mt-3";
  if (block.kind === "ul") {
    return (
      <ul className={cn("list-disc space-y-2 pl-5", gap)}>
        {block.items.map((item, i) => (
          <li key={i}>{renderInline(item)}</li>
        ))}
      </ul>
    );
  }
  const muted =
    block.kind === "pMuted" && "text-sm text-neutral-500 dark:text-neutral-400";
  return <p className={cn(muted, gap)}>{renderInline(block.content)}</p>;
}

export function LegalContent() {
  const t = useT();
  const lang = useUILang();
  const doc = LEGAL_DOCS[lang];

  return (
    <motion.main
      className="mx-auto min-h-dvh max-w-2xl px-6 pb-16 pt-[calc(env(safe-area-inset-top)+3.5rem)] sm:px-8 sm:pb-20 sm:pt-20"
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: {
          transition: { staggerChildren: 0.06, delayChildren: 0.04 },
        },
      }}
    >
      <motion.div variants={sectionVariants}>
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-neutral-500 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
        >
          ← {t.common.back}
        </Link>
      </motion.div>

      <motion.header variants={sectionVariants} className="mt-8 mb-10">
        <h1 className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
          {doc.title}
        </h1>
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
          {doc.updated}
        </p>
      </motion.header>

      <div className="space-y-10 text-[15px] leading-relaxed text-neutral-700 dark:text-neutral-300">
        {doc.sections.map((section) => (
          <motion.section key={section.heading} variants={sectionVariants}>
            <h2 className="mb-3 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
              {section.heading}
            </h2>
            {section.blocks.map((block, i) => (
              <Fragment key={i}>{renderBlock(block, i === 0)}</Fragment>
            ))}
          </motion.section>
        ))}
      </div>
    </motion.main>
  );
}
