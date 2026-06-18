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
}

export interface LessonNode {
  id: number;
  slug: string;
  title: string;
  xp: number;
  item_count: number;
  stars: number;
  completed: boolean;
  locked: boolean;
}

export interface UnitNode {
  slug: string;
  title: string;
  lessons: LessonNode[];
}

export interface CourseTree {
  lang: string;
  title: string;
  units: UnitNode[];
}

export interface PlayItem {
  target: string;
  meaning: string;
}

export interface LessonPlay {
  id: number;
  title: string;
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
}

export interface CompleteResult {
  xp_awarded: number;
  stars: number;
  state: LearnState;
  new_achievements: string[];
  streak_increased: boolean;
  new_streak_milestone: number;
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
): Promise<CompleteResult> {
  const res = await fetch(`${BASE}/api/learn/lessons/${id}/complete`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mistakes }),
  });
  if (!res.ok) throw new LearnError(`learn: ${res.status}`, res.status);
  return (await res.json()) as CompleteResult;
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
