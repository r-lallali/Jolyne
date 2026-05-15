import { create } from "zustand";

export type ChatStatus =
  | "idle"
  | "connecting"
  | "queued"
  | "matched"
  | "ended"
  | "error";

export interface ChatMessage {
  id: number;
  from: "me" | "peer";
  body: string;
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
  pushMe: (body: string) => void;
  pushPeer: (body: string) => void;
  receivePeerTyping: () => void;
  peerLeft: () => void;
  error: (code: string, message?: string) => void;
  reset: () => void;
}

let nextId = 0;

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

  pushMe: (body) =>
    set((s) => ({
      messages: [...s.messages, { id: ++nextId, from: "me", body }],
    })),

  pushPeer: (body) => {
    // L'arrivée d'un message du peer signifie qu'il a fini de taper.
    clearTypingTimer();
    set((s) => ({
      messages: [...s.messages, { id: ++nextId, from: "peer", body }],
      peerTyping: false,
    }));
  },

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
