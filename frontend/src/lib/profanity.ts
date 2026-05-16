// Mirror client de la blocklist serveur (backend/internal/moderation/profanity.go).
// Le serveur reste l'autorité — cette copie sert uniquement à donner un
// retour visuel immédiat dans le SetupView avant la requête WS. Toute
// modification doit être répliquée dans les deux fichiers, sinon on
// risque un faux négatif côté front (le serveur rejette quand même).

const TERMS: readonly string[] = [
  "porn",
  "sexe",
  "fuck",
  "puta",
  "pute",
  "anal",
  "nigger",
  "faggot",
  "tranny",
  "cp",
  "loli",
  "pedo",
  "pedophile",
  "pedofilo",
];

const ACCENT_MAP: Record<string, string> = {
  à: "a", á: "a", â: "a", ä: "a", ã: "a", å: "a",
  è: "e", é: "e", ê: "e", ë: "e",
  ì: "i", í: "i", î: "i", ï: "i",
  ò: "o", ó: "o", ô: "o", ö: "o", õ: "o",
  ù: "u", ú: "u", û: "u", ü: "u",
  ñ: "n", ç: "c",
};

const LEET_MAP: Record<string, string> = {
  "0": "o", "1": "i", "!": "i", "3": "e", "4": "a",
  "@": "a", "5": "s", $: "s", "7": "t",
};

function normalize(s: string): string {
  let out = "";
  for (const raw of s.toLowerCase()) {
    const stripped = ACCENT_MAP[raw] ?? raw;
    const unleet = LEET_MAP[stripped] ?? stripped;
    if (/[\p{L}\p{N}]/u.test(unleet)) out += unleet;
  }
  return out;
}

export function containsProfanity(s: string): boolean {
  const n = normalize(s);
  return TERMS.some((t) => n.includes(t));
}
