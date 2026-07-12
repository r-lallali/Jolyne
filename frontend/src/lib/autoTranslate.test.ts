import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAutoTranslations } from "@/lib/autoTranslate";
import { guessSourceLang, translateText } from "@/lib/translate";

vi.mock("@/lib/translate", () => ({
  guessSourceLang: vi.fn(() => "en"),
  translateText: vi.fn(),
}));

const opts = { enabled: true, expected: "en", target: "fr" };

describe("useAutoTranslations", () => {
  beforeEach(() => {
    vi.mocked(translateText).mockReset();
    vi.mocked(guessSourceLang).mockReturnValue("en");
  });

  it("traduit les messages entrants et expose id → traduction", async () => {
    vi.mocked(translateText).mockResolvedValue({
      translated: "bonjour",
    } as Awaited<ReturnType<typeof translateText>>);
    const { result } = renderHook(() =>
      useAutoTranslations([{ id: "1", body: "hello" }], opts),
    );
    await waitFor(() => expect(result.current["1"]).toBe("bonjour"));
    expect(translateText).toHaveBeenCalledWith("hello", "en", "fr");
  });

  it("n'affiche rien si la traduction est identique à l'original", async () => {
    vi.mocked(translateText).mockResolvedValue({
      translated: "Bonjour",
    } as Awaited<ReturnType<typeof translateText>>);
    const { result } = renderHook(() =>
      useAutoTranslations([{ id: "1", body: "bonjour" }], opts),
    );
    await waitFor(() => expect(translateText).toHaveBeenCalled());
    expect(result.current["1"]).toBeUndefined();
  });

  it("ne retente jamais un message déjà traité, même après échec", async () => {
    vi.mocked(translateText).mockRejectedValue(new Error("réseau"));
    const items = [{ id: "1", body: "hello" }];
    const { result, rerender } = renderHook(
      ({ i }) => useAutoTranslations(i, opts),
      { initialProps: { i: items } },
    );
    await waitFor(() => expect(translateText).toHaveBeenCalledTimes(1));
    rerender({ i: [...items] });
    // Toujours un seul appel : l'échec est mémorisé, pas de boucle réseau.
    expect(translateText).toHaveBeenCalledTimes(1);
    expect(result.current["1"]).toBeUndefined();
  });

  it("reste inerte si désactivé ou sans langue cible", () => {
    renderHook(() =>
      useAutoTranslations([{ id: "1", body: "hello" }], {
        ...opts,
        enabled: false,
      }),
    );
    renderHook(() =>
      useAutoTranslations([{ id: "2", body: "hello" }], {
        ...opts,
        target: null,
      }),
    );
    expect(translateText).not.toHaveBeenCalled();
  });

  it("purge le cache quand la langue cible change (nouveau setup)", async () => {
    vi.mocked(translateText).mockResolvedValue({
      translated: "bonjour",
    } as Awaited<ReturnType<typeof translateText>>);
    const { result, rerender } = renderHook(
      ({ target }) => useAutoTranslations([{ id: "1", body: "hello" }], { ...opts, target }),
      { initialProps: { target: "fr" as string | null } },
    );
    await waitFor(() => expect(result.current["1"]).toBe("bonjour"));

    vi.mocked(translateText).mockResolvedValue({
      translated: "hola",
    } as Awaited<ReturnType<typeof translateText>>);
    rerender({ target: "es" });
    // Le cache est purgé puis le message retraduit vers la nouvelle langue.
    await waitFor(() => expect(result.current["1"]).toBe("hola"));
    expect(translateText).toHaveBeenLastCalledWith("hello", "en", "es");
  });
});
