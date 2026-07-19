import { expect, test } from "@playwright/test";

// Auth contre le vrai backend + Postgres, via la page dédiée /auth :
// critères de mot de passe (rouge → vert, rejoués côté serveur), signup
// réel (connexion immédiate — la vérification d'email arrive après, via le
// lien loggé côté serveur), et erreur 401 sur mauvais mot de passe.

test("signup réel : critères de mot de passe puis connexion immédiate", async ({
  page,
}) => {
  const email = `e2e-${Date.now()}@example.com`;

  await page.goto("/");
  await page.getByRole("link", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/auth$/);

  // La page démarre en connexion → bascule inscription par le lien.
  await page.getByRole("button", { name: "Inscription" }).click();

  // La checklist des critères est affichée sous le champ mot de passe.
  await expect(page.getByText("Au moins 8 caractères")).toBeVisible();

  // Mot de passe sans majuscule ni chiffre → erreur critères, aucun signup.
  await page.getByPlaceholder("Adresse e-mail").fill(email);
  await page.getByPlaceholder("Mot de passe", { exact: true }).fill("motdepasse");
  await page.getByPlaceholder("Confirmer le mot de passe").fill("motdepasse");
  await page.getByRole("button", { name: "Créer le compte" }).click();
  await expect(
    page.getByText("Le mot de passe ne respecte pas tous les critères"),
  ).toBeVisible();

  // Critères remplis mais confirmation différente → erreur de correspondance.
  await page
    .getByPlaceholder("Mot de passe", { exact: true })
    .fill("Motdepasse-e2e1");
  await page.getByPlaceholder("Confirmer le mot de passe").fill("Différent-1");
  await page.getByRole("button", { name: "Créer le compte" }).click();
  await expect(
    page.getByText("Les mots de passe ne correspondent pas"),
  ).toBeVisible();

  // Signup réel → compte créé, session ouverte, retour home : l'avatar
  // haut-droite porte l'email du compte en aria-label.
  await page.getByPlaceholder("Confirmer le mot de passe").fill("Motdepasse-e2e1");
  await page.getByRole("button", { name: "Créer le compte" }).click();
  await expect(page.getByRole("button", { name: email })).toBeVisible({
    timeout: 10_000,
  });
});

test("login avec identifiants inconnus affiche l'erreur du backend", async ({
  page,
}) => {
  await page.goto("/auth");
  await page.getByPlaceholder("Adresse e-mail").fill("inconnu-e2e@example.com");
  await page
    .getByPlaceholder("Mot de passe", { exact: true })
    .fill("Mauvais-mdp-1");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByText("Email ou mot de passe incorrect")).toBeVisible({
    timeout: 10_000,
  });
});
