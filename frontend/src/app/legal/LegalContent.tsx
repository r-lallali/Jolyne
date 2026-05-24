"use client";

import { motion } from "framer-motion";
import Link from "next/link";

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

export function LegalContent() {
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
          ← Retour
        </Link>
      </motion.div>

      <motion.header variants={sectionVariants} className="mt-8 mb-10">
        <h1 className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
          Mentions légales
        </h1>
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
          Dernière mise à jour : 14 mai 2026
        </p>
      </motion.header>

      <div className="space-y-10 text-[15px] leading-relaxed text-neutral-700 dark:text-neutral-300">
        <motion.section variants={sectionVariants}>
          <h2 className="mb-3 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Éditeur
          </h2>
          <p>
            Jolyne est un service de chat anonyme exploité par Ralys, particulier
            domicilié en France. Contact :{" "}
            <a
              href="mailto:lallaliralys@gmail.com"
              className="underline underline-offset-2 hover:text-neutral-900 dark:hover:text-neutral-100"
            >
              lallaliralys@gmail.com
            </a>
            .
          </p>
          <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
            Hébergement : OVH SAS, 2 rue Kellermann, 59100 Roubaix, France.
          </p>
        </motion.section>

        <motion.section variants={sectionVariants}>
          <h2 className="mb-3 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Conditions d&apos;utilisation
          </h2>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              Le service est réservé aux personnes âgées de <strong>16 ans ou plus</strong>.
              L&apos;accès est conditionné à l&apos;acceptation explicite de cette
              condition d&apos;âge avant chaque session.
            </li>
            <li>
              Sont strictement interdits : propos haineux, discriminatoires,
              menaces, harcèlement, contenu à caractère sexuel explicite,
              partage d&apos;informations personnelles d&apos;autrui (doxing),
              spam, ou toute incitation à la violence.
            </li>
            <li>
              Tout signalement déclenche une revue humaine et peut entraîner
              une suspension temporaire ou définitive du compte/appareil.
              Les bannissements définitifs ne sont prononcés qu&apos;après
              examen par un modérateur humain.
            </li>
            <li>
              L&apos;utilisateur s&apos;engage à respecter les lois en vigueur
              dans son pays de résidence.
            </li>
          </ul>
        </motion.section>

        <motion.section variants={sectionVariants}>
          <h2 className="mb-3 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Données personnelles (RGPD)
          </h2>
          <p>
            Jolyne minimise au maximum la collecte de données. Concrètement :
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              <strong>Le contenu des messages n&apos;est jamais conservé ni
              journalisé.</strong> Il transite uniquement entre les deux
              participants pendant la durée de la conversation.
            </li>
            <li>
              Un identifiant d&apos;appareil (fingerprint) est calculé côté
              client et utilisé pour appliquer les quotas gratuits et empêcher
              le contournement de bannissement. Il n&apos;est jamais associé
              à un nom ou un email côté serveur.
            </li>
            <li>
              L&apos;IP est hashée avant tout enregistrement applicatif. Les
              logs serveur ne contiennent que des métadonnées techniques
              (durée de session, paire de langues, code retour).
            </li>
            <li>
              En cas de signalement, les N derniers messages capturés sont
              chiffrés au repos et purgés automatiquement après 90 jours.
            </li>
            <li>
              <strong>Bot prof IA :</strong> si aucun partenaire humain
              n&apos;est disponible au bout de 10 secondes, un bot prof IA
              (badge « 🤖 Prof IA » affiché côté chat) prend la main pour
              que tu puisses pratiquer. Le contenu des messages échangés
              avec ce bot est transmis en temps réel à Anthropic (éditeur
              du modèle Claude) afin de générer ses réponses. Aucun
              identifiant utilisateur n&apos;est joint à ces appels, et
              Anthropic ne conserve pas ces échanges pour entraîner ses
              modèles (politique commerciale standard). Si tu ne souhaites
              pas que tes messages soient traités par Anthropic, ne
              continue pas la conversation après l&apos;apparition du
              badge — clique sur « Suivant » pour ré-essayer un match
              humain.
            </li>
          </ul>
          <p className="mt-3">
            <strong>Droit à l&apos;effacement</strong> : tu peux demander la
            suppression de toute donnée te concernant en écrivant à l&apos;adresse
            de contact ci-dessus. Réponse sous 30 jours.
          </p>
        </motion.section>

        <motion.section variants={sectionVariants}>
          <h2 className="mb-3 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Modération et Digital Services Act
          </h2>
          <p>
            Point de contact pour les signalements de contenus illégaux,
            les demandes d&apos;information des autorités, ou toute question
            relative à la modération :
          </p>
          <p className="mt-2">
            <a
              href="mailto:lallaliralys@gmail.com"
              className="underline underline-offset-2 hover:text-neutral-900 dark:hover:text-neutral-100"
            >
              lallaliralys@gmail.com
            </a>
          </p>
          <p className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">
            Conformément au règlement (UE) 2022/2065 sur les services numériques
            (DSA), Jolyne traite les signalements crédibles dans un délai
            raisonnable. Tu peux contester un bannissement en répondant à
            l&apos;email de notification.
          </p>
        </motion.section>

        <motion.section variants={sectionVariants}>
          <h2 className="mb-3 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Cookies et stockage local
          </h2>
          <p>
            Jolyne n&apos;utilise <strong>aucun cookie de tracking</strong>.
            Le navigateur stocke localement :
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>Ton pseudo et tes préférences de langue (pour les retrouver à ta prochaine visite).</li>
            <li>Ton fingerprint d&apos;appareil (pour les quotas).</li>
            <li>Ta préférence de thème (clair/sombre).</li>
          </ul>
          <p className="mt-3">
            Tu peux tout effacer en vidant le stockage local de ton navigateur
            pour ce site.
          </p>
        </motion.section>
      </div>
    </motion.main>
  );
}
