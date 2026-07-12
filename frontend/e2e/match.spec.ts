import { expect, test, type Page } from "@playwright/test";

// Le test au cœur du produit : deux visiteurs anonymes (fr↔en croisés)
// traversent le setup, se font apparier par les files Redis, et échangent
// des messages via WebSocket. Zéro mock — si ce test passe, le chemin
// setup → matchmaking → chat fonctionne de bout en bout.
//
// Piège i18n : choisir sa langue parlée BASCULE la langue de l'UI
// (i18n résout via sessionStore.speaks avant navigator.language). Après la
// sélection, Alice voit l'UI en français, Bob en anglais — d'où les
// libellés passés par participant.

interface UIStrings {
  start: string;
  msgPlaceholder: string;
  send: string;
}

const FR: UIStrings = { start: "Commencer", msgPlaceholder: "Ton message…", send: "Envoyer" };
const EN: UIStrings = { start: "Start", msgPlaceholder: "Your message…", send: "Send" };

async function completeSetup(
  page: Page,
  nick: string,
  speaks: string,
  wants: string,
  ui: UIStrings,
) {
  await page.goto("/");
  // PseudoInput est un input invisible sous des spans animés : pas de
  // placeholder DOM, son nom accessible vient de l'aria-label. À ce stade
  // l'UI est encore en français (locale du navigateur).
  await page.getByRole("textbox", { name: "ton pseudo" }).fill(nick);
  await page.getByRole("button", { name: "Suivant" }).click();

  // Deux grilles de langues : la première = je parle, la seconde = je veux
  // pratiquer (les libellés sont natifs, indépendants de la langue d'UI).
  const grids = page.locator("div.grid");
  await grids.nth(0).getByRole("button", { name: speaks }).click();
  await grids.nth(1).getByRole("button", { name: wants }).click();

  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: ui.start }).click();
}

test("deux visiteurs se matchent et échangent des messages", async ({
  browser,
}) => {
  // Deux navigations complètes + matchmaking réel : budget large.
  test.setTimeout(90_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const alice = await ctxA.newPage();
  const bob = await ctxB.newPage();

  await completeSetup(alice, "AliceE2E", "Français", "English", FR);
  await completeSetup(bob, "BobE2E", "English", "Français", EN);

  // Match : chaque page affiche l'input de chat avec le pseudo du peer.
  const aliceInput = alice.getByPlaceholder(FR.msgPlaceholder);
  const bobInput = bob.getByPlaceholder(EN.msgPlaceholder);
  await expect(aliceInput).toBeVisible({ timeout: 20_000 });
  await expect(bobInput).toBeVisible({ timeout: 20_000 });
  await expect(alice.getByText("BobE2E").first()).toBeVisible();
  await expect(bob.getByText("AliceE2E").first()).toBeVisible();

  // Aller-retour de messages relayés par le serveur.
  await aliceInput.fill("Bonjour depuis Alice !");
  await alice.getByRole("button", { name: FR.send }).click();
  await expect(bob.getByText("Bonjour depuis Alice !")).toBeVisible({
    timeout: 10_000,
  });

  await bobInput.fill("Hello back from Bob!");
  await bob.getByRole("button", { name: EN.send }).click();
  await expect(alice.getByText("Hello back from Bob!")).toBeVisible({
    timeout: 10_000,
  });

  await ctxA.close();
  await ctxB.close();
});
