import { describe, expect, it } from "vitest";

import { decodeEntities, sanitizeMessage } from "@/lib/sanitize";

describe("decodeEntities", () => {
  it("décode exactement les 5 entités produites par html.EscapeString (Go)", () => {
    expect(decodeEntities("&lt;b&gt;")).toBe("<b>");
    expect(decodeEntities("l&#39;ami")).toBe("l'ami");
    expect(decodeEntities("&#34;quote&#34;")).toBe('"quote"');
    expect(decodeEntities("a &amp; b")).toBe("a & b");
  });

  it("ne décode pas les autres entités (sur-décodage intentionnellement refusé)", () => {
    expect(decodeEntities("&#x27;")).toBe("&#x27;");
    expect(decodeEntities("&nbsp;")).toBe("&nbsp;");
  });

  it("ne double-décode pas (&amp;lt; devient &lt;, pas <)", () => {
    expect(decodeEntities("&amp;lt;script&amp;gt;")).toBe("&lt;script&gt;");
  });
});

describe("sanitizeMessage", () => {
  it("neutralise un payload XSS échappé par le serveur", () => {
    const escaped = "&lt;img src=x onerror=alert(1)&gt;";
    const out = sanitizeMessage(escaped);
    expect(out).not.toContain("<img");
    expect(out).not.toContain("onerror");
  });

  it("strip les balises mais garde leur contenu (KEEP_CONTENT)", () => {
    expect(sanitizeMessage("&lt;b&gt;gras&lt;/b&gt;")).toBe("gras");
  });

  it("laisse le texte ordinaire intact, apostrophes et emojis compris", () => {
    expect(sanitizeMessage("J&#39;adore 🎉 &amp; toi ?")).toBe(
      "J'adore 🎉 & toi ?",
    );
    // Quirk connu : DOMPurify ré-encode un `<` nu à la sérialisation, donc
    // « 2 < 3 » ressort « 2 &lt; 3 » et s'affiche tel quel (React rend un
    // text node). Sûr mais cosmétiquement faux — à corriger un jour dans
    // sanitizeMessage, ce test documente l'état actuel.
    expect(sanitizeMessage("2 &lt; 3 se dit &#34;deux&#34;")).toBe(
      '2 &lt; 3 se dit "deux"',
    );
  });

  it("neutralise du HTML brut arrivé sans échappement (faille upstream)", () => {
    const out = sanitizeMessage("<script>alert(1)</script>salut");
    expect(out).not.toContain("<script");
    expect(out).toContain("salut");
  });
});
