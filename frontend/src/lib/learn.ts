// Client HTTP pour /api/learn — le mode Cours. Toutes les routes requièrent une
// session user (credentials:include). Le contenu (cours/leçons) est de confiance
// (seed embarqué + générateur Claude) ; React l'échappe au rendu.

const BASE = process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? "";

export class LearnError extends Error {
  status: number;
  constructor(msg: string, status: number) {
    super(msg);
    this.status = status;
  }
}

export interface CourseSummary {
  lang: string;
  title: string;
  unit_count: number;
  lesson_count: number;
  // Progression de l'apprenant : leçons complétées (jouées ou placées) et
  // inscription — sert à séparer « reprendre » des cours à découvrir.
  completed_lessons: number;
  enrolled: boolean;
}

export interface LessonNode {
  id: number;
  slug: string;
  title: string;
  // "vocab" (défaut) ou "script" (leçon d'écriture). Absent ⇒ vocab.
  kind?: string;
  xp: number;
  item_count: number;
  stars: number;
  completed: boolean;
  locked: boolean;
  placed: boolean;
}

export interface UnitNode {
  slug: string;
  title: string;
  // "script" pour une unité d'apprentissage de l'écriture (dérivé de sa 1re leçon).
  kind?: string;
  lessons: LessonNode[];
}

export interface CourseTree {
  lang: string;
  title: string;
  units: UnitNode[];
  enrolled: boolean;
  unit_count: number;
}

export interface PlayItem {
  target: string;
  meaning: string;
  // ----- champs script (leçons d'écriture) -----
  sound?: string;
  forms?: string[];
  parts?: string[];
  strokes?: string[];
  example?: string;
  example_sound?: string;
  // Sens du mot d'exemple dans la langue de l'apprenant (ajout au carnet).
  example_meaning?: string;
}

export interface LessonPlay {
  id: number;
  title: string;
  kind?: string;
  xp: number;
  items: PlayItem[];
}

export interface LearnState {
  total_xp: number;
  daily_goal: number;
  daily_xp: number;
  hearts: number;
  max_hearts: number;
  next_heart_in_sec: number;
  current_streak: number;
  longest_streak: number;
  streak_at_risk: boolean;
  achievements: string[];
  premium: boolean;
  unlimited_hearts: boolean;
  can_ask_heart: boolean;
  incoming_heart_requests: number;
}

export interface CompleteResult {
  xp_awarded: number;
  stars: number;
  state: LearnState;
  new_achievements: string[];
  streak_increased: boolean;
  new_streak_milestone: number;
  failed: boolean;
}

export interface HeartRequest {
  id: number;
  requester_id: number;
  created_at: string;
}

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { credentials: "include" });
  if (!res.ok) throw new LearnError(`learn: ${res.status}`, res.status);
  return (await res.json()) as T;
}

export async function listCourses(): Promise<CourseSummary[]> {
  const data = await getJSON<{ courses: CourseSummary[] }>("/api/learn/courses");
  return data.courses ?? [];
}

export function getCourseTree(lang: string): Promise<CourseTree> {
  return getJSON<CourseTree>(`/api/learn/courses/${lang}`);
}

export function getLesson(id: number, from: string): Promise<LessonPlay> {
  return getJSON<LessonPlay>(`/api/learn/lessons/${id}?from=${encodeURIComponent(from)}`);
}

export function getState(): Promise<LearnState> {
  return getJSON<LearnState>("/api/learn/state");
}

export async function completeLesson(
  id: number,
  mistakes: number,
  failed = false,
): Promise<CompleteResult> {
  const res = await fetch(`${BASE}/api/learn/lessons/${id}/complete`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mistakes, failed }),
  });
  if (!res.ok) throw new LearnError(`learn: ${res.status}`, res.status);
  return (await res.json()) as CompleteResult;
}

// enrollCourse : choisit le niveau de départ (saute les unités antérieures) et
// renvoie l'arbre mis à jour.
export async function enrollCourse(
  lang: string,
  startUnit: number,
): Promise<CourseTree> {
  const res = await fetch(`${BASE}/api/learn/courses/${lang}/placement`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ start_unit: startUnit }),
  });
  if (!res.ok) throw new LearnError(`learn: ${res.status}`, res.status);
  return (await res.json()) as CourseTree;
}

// requestHeart : demande un cœur à un ami (1/jour). Renvoie false si le quota
// du jour est déjà consommé.
export async function requestHeart(friendUserId: number): Promise<boolean> {
  const res = await fetch(`${BASE}/api/learn/hearts/request`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ friend_user_id: friendUserId }),
  });
  if (!res.ok) throw new LearnError(`learn: ${res.status}`, res.status);
  const data = (await res.json()) as { ok: boolean; error?: string };
  return data.ok;
}

export async function listHeartRequests(): Promise<HeartRequest[]> {
  const data = await getJSON<{ requests: HeartRequest[] }>(
    "/api/learn/hearts/requests",
  );
  return data.requests ?? [];
}

export async function grantHeart(id: number): Promise<boolean> {
  const res = await fetch(`${BASE}/api/learn/hearts/requests/${id}/grant`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new LearnError(`learn: ${res.status}`, res.status);
  const data = (await res.json()) as { ok: boolean };
  return data.ok;
}

export async function setDailyGoal(goal: number): Promise<LearnState> {
  const res = await fetch(`${BASE}/api/learn/state/daily-goal`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ goal }),
  });
  if (!res.ok) throw new LearnError(`learn: ${res.status}`, res.status);
  return (await res.json()) as LearnState;
}
