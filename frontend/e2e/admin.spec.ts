import { expect, test } from "@playwright/test";

// Le middleware Next protège /admin/* : sans cookie admin, redirection vers
// /admin/login (l'entrée publique du back-office).
test("visiter /admin sans cookie redirige vers /admin/login", async ({
  page,
}) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login$/);
});
