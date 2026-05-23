import { create } from "zustand";

export type ChatStatus =
  | "idle"
  | "connecting"
  | "queued"
  | "matched"
  // Conversation terminée (peer parti OU moi qui choisis Suivant), on
  // attend que l'utilisateur décide de re-queue ou de quitter via le
  // PostChatView. La WS est encore ouverte et le backend attend lui aussi.
  | "post_chat"
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
  // Date.now() à l'insertion / mise à jour. Sert à autoriser une édition
  // par le correcteur dans une fenêtre de N secondes après l'envoi.
  at: number;
}

export interface ChatMessage {
  // ID éphémère partagé entre les deux peers : généré côté expéditeur,
  // relayé tel quel par le serveur, utilisé pour ancrer une correction.
  id: string;
  from: "me" | "peer";
  body: string;
  // Date.now() à l'insertion en store, côté receveur ou côté expéditeur.
  // Sert uniquement à l'affichage tooltip "envoyé à 14:32" — pas relayé.
  at: number;
  correction?: MessageCorrection;
}

// État du prompt ami 10-min :
//   - null               : pas de prompt (avant 10 min, ou anonyme)
//   - "shown"            : le serveur a envoyé friend_prompt, j'attends
//   - "self_accepted"    : j'ai cliqué Accepter, j'attends le peer
//   - { kind: "made", friendId } : les deux ont accepté, on est amis
//   - "skipped"          : fenêtre expirée sans double accept
export type FriendPromptState =
  | null
  | { kind: "shown" }
  | { kind: "self_accepted" }
  | { kind: "made"; friendId: number }
  | { kind: "skipped" };

// Profil public du peer si authentifié — photo principale Cloudinary
// (public_id) + 3 slots Q&R. null si peer anonyme ou profil non chargé.
export interface PeerProfile {
  photoId: string;
  prompts: { prompt: string; answer: string }[];
  verified?: boolean;
}

interface ChatState {
  status: ChatStatus;
  peerNick: string | null;
  messages: ChatMessage[];
  errorCode: string | null;
  errorMessage: string | null;
  peerTyping: boolean;
  // Qui a mis fin à la conversation. Sert au PostChatCard à adapter le
  // wording ("X a quitté" vs "Conversation terminée"). null hors post_chat.
  endedBy: "peer" | "self" | null;
  // Prompt ami 10-min (uniquement si les deux peers sont authentifiés).
  friendPrompt: FriendPromptState;
  peerProfile: PeerProfile | null;
  // True si le peer est un bot prof IA (cf. backend internal/ws/bot_manager.go).
  // Le front affiche un badge "🤖 Prof IA" et masque le prompt friend.
  peerIsBot: boolean;
  // Timestamp du dernier match (ms). Sert au ring de cooldown anti-zap du
  // bouton Suivant. On le persiste dans le store plutôt qu'en state local
  // de ChatView pour qu'un remount (switch d'onglet "mes conversations" →
  // retour) ne relance pas l'animation à zéro.
  matchedAt: number | null;

  setStatus: (s: ChatStatus) => void;
  matched: (peerNick: string, isBot?: boolean) => void;
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
  // Friend prompt transitions
  showFriendPrompt: () => void;
  selfAcceptFriend: () => void;
  friendMade: (friendId: number) => void;
  friendSkipped: () => void;
  setPeerProfile: (p: PeerProfile | null) => void;
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
  endedBy: null,
  friendPrompt: null,
  peerProfile: null,
  peerIsBot: false,
  matchedAt: null,

  setStatus: (status) => set({ status }),

  matched: (peerNick, isBot) => {
    clearTypingTimer();
    set({
      status: "matched",
      peerNick,
      messages: [],
      errorCode: null,
      errorMessage: null,
      peerTyping: false,
      endedBy: null,
      friendPrompt: null,
      peerProfile: null,
      peerIsBot: !!isBot,
      matchedAt: Date.now(),
    });
  },

  pushMe: (id, body) =>
    set((s) => ({
      messages: [...s.messages, { id, from: "me", body, at: Date.now() }],
    })),

  pushPeer: (id, body) => {
    // L'arrivée d'un message du peer signifie qu'il a fini de taper.
    clearTypingTimer();
    set((s) => ({
      messages: [
        ...s.messages,
        { id, from: "peer", body, at: Date.now() },
      ],
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
    // On NE re-queue PAS automatiquement : on bascule sur l'écran de fin
    // (PostChatCard inline) qui propose Suivant/Quitter. peerNick est
    // conservé pour pouvoir l'afficher dans le récap. Uniquement déclenché
    // côté receveur — pour le côté qui clique Suivant/Quitter on re-queue
    // ou on stop direct sans passer par le post_chat.
    set({ status: "post_chat", peerTyping: false, endedBy: "peer" });
  },

  farewell: () => {
    clearTypingTimer();
    // On garde peerNick / messages / endedBy : pendant la sortie animée
    // de ChatView vers FarewellView, la PostChatCard reste affichée et
    // doit conserver son titre ("X a quitté" / "Conversation terminée").
    // Le vrai nettoyage des données arrive au reset() après le farewell.
    set({
      status: "ended",
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
      endedBy: null,
      friendPrompt: null,
      peerProfile: null,
      peerIsBot: false,
      matchedAt: null,
    });
  },

  showFriendPrompt: () => set({ friendPrompt: { kind: "shown" } }),
  selfAcceptFriend: () => set({ friendPrompt: { kind: "self_accepted" } }),
  friendMade: (friendId) =>
    set({ friendPrompt: { kind: "made", friendId } }),
  friendSkipped: () => set({ friendPrompt: { kind: "skipped" } }),
  setPeerProfile: (p) => set({ peerProfile: p }),
}));
