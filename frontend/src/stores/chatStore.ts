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

  setStatus: (s: ChatStatus) => void;
  matched: (peerNick: string) => void;
  pushMe: (body: string) => void;
  pushPeer: (body: string) => void;
  peerLeft: () => void;
  error: (code: string) => void;
  reset: () => void;
}

let nextId = 0;

// Store éphémère : volontairement non persisté. Recharger la page = perdre
// la conversation. Cohérent avec "messages éphémères, pas de persistance"
// (CLAUDE.md & PLAN.md §4 Phase 1).
export const useChatStore = create<ChatState>((set) => ({
  status: "idle",
  peerNick: null,
  messages: [],
  errorCode: null,

  setStatus: (status) => set({ status }),
  matched: (peerNick) =>
    set({ status: "matched", peerNick, messages: [], errorCode: null }),
  pushMe: (body) =>
    set((s) => ({
      messages: [...s.messages, { id: ++nextId, from: "me", body }],
    })),
  pushPeer: (body) =>
    set((s) => ({
      messages: [...s.messages, { id: ++nextId, from: "peer", body }],
    })),
  peerLeft: () => set({ status: "queued", peerNick: null }),
  error: (errorCode) => set({ status: "error", errorCode }),
  reset: () =>
    set({
      status: "idle",
      peerNick: null,
      messages: [],
      errorCode: null,
    }),
}));
