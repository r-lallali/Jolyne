import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useChatStore } from "@/stores/chatStore";

const store = () => useChatStore.getState();

describe("chatStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    store().reset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("matched() repart d'une conversation vierge et pose les flags bot/salle d'attente", () => {
    store().pushMe("m1", "reliquat d'une conv précédente");
    store().matched("Léa", true, true);
    const s = store();
    expect(s.status).toBe("matched");
    expect(s.peerNick).toBe("Léa");
    expect(s.messages).toEqual([]);
    expect(s.peerIsBot).toBe(true);
    expect(s.waitingRoom).toBe(true);
    expect(s.matchedAt).not.toBeNull();
  });

  it("pushPeer déduplique par ID (greeting du prof IA re-publié)", () => {
    store().matched("Prof", true);
    store().pushPeer("g1", "Bonjour !");
    store().pushPeer("g1", "Bonjour !");
    expect(store().messages).toHaveLength(1);
  });

  it("l'indicateur peer écrit s'auto-efface après 3,5 s et tombe à l'arrivée du message", () => {
    store().matched("Léa");
    store().receivePeerTyping();
    expect(store().peerTyping).toBe(true);
    vi.advanceTimersByTime(3_600);
    expect(store().peerTyping).toBe(false);

    store().receivePeerTyping();
    store().pushPeer("p1", "me voilà");
    expect(store().peerTyping).toBe(false);
  });

  it("applyCorrection patche le message ciblé et ignore un ID inconnu", () => {
    store().matched("Léa");
    store().pushMe("m1", "je suis allé");
    const c = { original: "je suis allé", corrected: "je suis allée", fromMe: false, at: Date.now() };
    store().applyCorrection("m1", c);
    store().applyCorrection("fantôme", c);
    const msgs = store().messages;
    expect(msgs[0]?.correction?.corrected).toBe("je suis allée");
    expect(msgs).toHaveLength(1);
  });

  it("peerLeft bascule en post_chat en gardant le contexte ; farewell garde le récap", () => {
    store().matched("Léa");
    store().pushPeer("p1", "salut");
    store().peerLeft();
    expect(store().status).toBe("post_chat");
    expect(store().endedBy).toBe("peer");
    expect(store().peerNick).toBe("Léa");

    store().farewell();
    // Le récap (nick + messages + endedBy) survit jusqu'au reset explicite.
    expect(store().status).toBe("ended");
    expect(store().peerNick).toBe("Léa");
    expect(store().messages).toHaveLength(1);
    expect(store().endedBy).toBe("peer");
  });

  it("reset ramène l'état initial complet", () => {
    store().matched("Léa", true, true);
    store().pushMe("m1", "coucou");
    store().showFriendPrompt();
    store().tandemProposed();
    store().reset();
    const s = store();
    expect(s.status).toBe("idle");
    expect(s.peerNick).toBeNull();
    expect(s.messages).toEqual([]);
    expect(s.friendPrompt).toBeNull();
    expect(s.tandem).toBeNull();
    expect(s.peerIsBot).toBe(false);
    expect(s.waitingRoom).toBe(false);
  });

  it("les transitions friend prompt suivent la machine à états", () => {
    store().showFriendPrompt();
    expect(store().friendPrompt).toEqual({ kind: "shown" });
    store().selfAcceptFriend();
    expect(store().friendPrompt).toEqual({ kind: "self_accepted" });
    store().friendMade(42);
    expect(store().friendPrompt).toEqual({ kind: "made", friendId: 42 });
  });
});
