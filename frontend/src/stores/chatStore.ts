import { create } from "zustand";

export type ChatStatus =
  | "idle"
  | "connecting"
  | "queued"
  | "matched"
  | "ended"
  | "error";

export interface MessageCorrection {
  original: string;
  corrected: string;
  note?: string;
  // true si JE suis le correcteur. Sert à choisir le wording côté UI :
  //   - moi correcteur → "Tu as corrigé"
  //   - peer correcteur → "{peerNick} t'a corrigé"
  fromMe: boolean;
}

export interface ChatMessage {
  // ID éphémère partagé entre les deux peers : généré côté expéditeur,
  // relayé tel quel par le serveur, utilisé pour ancrer une correction.
  id: string;
  from: "me" | "peer";
  body: string;
  correction?: MessageCorrection;
}

interface ChatState {
  status: ChatStatus;
  peerNick: string | null;
  messages: ChatMessage[];
  errorCode: string | null;
  errorMessage: string | null;
  peerTyping: boolean;

  setStatus: (s: ChatStatus) => void;
  matched: (peerNick: string) => void;
  pushMe: (id: string, body: string) => void;
  pushPeer: (id: string, body: string) => void;
  // Patch d'un message existant avec une correction. Si le message ciblé
  // n'existe plus (purge / mismatch), la correction est ignorée.
  applyCorrection: (targetId: string, c: MessageCorrection) => void;
  receivePeerTyping: () => void;
  peerLeft: () => void;
  farewell: () => void;
  error: (code: string, message?: string) => void;
  reset: () => void;
}

// Timer du "peer écrit…" : module-level car il n'y a qu'une seule conv à
// la fois. Auto-clear après 3.5s sans nouvel event typing.
let peerTypingTimer: ReturnType<typeof setTimeout> | null = null;
const PEER_TYPING_AUTO_CLEAR_MS = 3_500;

function clearTypingTimer() {
  if (peerTypingTimer) {
    clearTimeout(peerTypingTimer);
    peerTypingTimer = null;
  }
}

// Store éphémère : volontairement non persisté. Recharger la page = perdre
// la conversation. Cohérent avec "messages éphémères, pas de persistance"
// (CLAUDE.md & PLAN.md §4 Phase 1).
export const useChatStore = create<ChatState>((set) => ({
  status: "idle",
  peerNick: null,
  messages: [],
  errorCode: null,
  errorMessage: null,
  peerTyping: false,

  setStatus: (status) => set({ status }),

  matched: (peerNick) => {
    clearTypingTimer();
    set({
      status: "matched",
      peerNick,
      messages: [],
      errorCode: null,
      errorMessage: null,
      peerTyping: false,
    });
  },

  pushMe: (id, body) =>
    set((s) => ({
      messages: [...s.messages, { id, from: "me", body }],
    })),

  pushPeer: (id, body) => {
    // L'arrivée d'un message du peer signifie qu'il a fini de taper.
    clearTypingTimer();
    set((s) => ({
      messages: [...s.messages, { id, from: "peer", body }],
      peerTyping: false,
    }));
  },

  applyCorrection: (targetId, c) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === targetId ? { ...m, correction: c } : m,
      ),
    })),

  receivePeerTyping: () => {
    clearTypingTimer();
    peerTypingTimer = setTimeout(() => {
      peerTypingTimer = null;
      set({ peerTyping: false });
    }, PEER_TYPING_AUTO_CLEAR_MS);
    set({ peerTyping: true });
  },

  peerLeft: () => {
    clearTypingTimer();
    set({ status: "queued", peerNick: null, peerTyping: false });
  },

  farewell: () => {
    clearTypingTimer();
    set({
      status: "ended",
      peerNick: null,
      messages: [],
      errorCode: null,
      errorMessage: null,
      peerTyping: false,
    });
  },

  error: (errorCode, errorMessage) => {
    clearTypingTimer();
    set({
      status: "error",
      errorCode,
      errorMessage: errorMessage ?? null,
      peerTyping: false,
    });
  },

  reset: () => {
    clearTypingTimer();
    set({
      status: "idle",
      peerNick: null,
      messages: [],
      errorCode: null,
      errorMessage: null,
      peerTyping: false,
    });
  },
}));
