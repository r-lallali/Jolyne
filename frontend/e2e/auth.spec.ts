import { expect, test } from "@playwright/test";

// Auth contre le vrai backend + Postgres : validation côté client, signup
// réel (connexion immédiate — la vérification d'email arrive après, via le
// lien loggé côté serveur), et erreur 401 sur mauvais mot de passe.

test("signup réel : validation client puis connexion immédiate", async ({
  page,
}) => {
  const email = `e2e-${Date.now()}@example.com`;

  await page.goto("/");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.getByRole("button", { name: "Inscription" }).click();

  // Validation client : mots de passe différents → erreur, aucun appel API.
  await page.getByPlaceholder("ton@email.com").fill(email);
  await page
    .getByPlaceholder("mot de passe (8 caractères min)")
    .fill("motdepasse-e2e");
  await page.getByPlaceholder("Confirme ton mot de passe").fill("différent");
  await page.getByRole("button", { name: "Créer le compte" }).click();
  await expect(
    page.getByText("Les mots de passe ne correspondent pas"),
  ).toBeVisible();

  // Signup réel → compte créé et session ouverte immédiatement : le bouton
  // haut-droite affiche l'email du compte à la place de « Se connecter ».
  await page.getByPlaceholder("Confirme ton mot de passe").fill("motdepasse-e2e");
  await page.getByRole("button", { name: "Créer le compte" }).click();
  await expect(page.getByRole("button", { name: email })).toBeVisible({
    timeout: 10_000,
  });
});

test("login avec identifiants inconnus affiche l'erreur du backend", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.getByPlaceholder("ton@email.com").fill("inconnu-e2e@example.com");
  await page
    .getByPlaceholder("mot de passe (8 caractères min)")
    .fill("mauvais-mot-de-passe");
  await page.getByRole("button", { name: "Se connecter" }).last().click();
  await expect(
    page.getByText("Email ou mot de passe incorrect"),
  ).toBeVisible({ timeout: 10_000 });
});
