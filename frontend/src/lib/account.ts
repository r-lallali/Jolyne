// Client HTTP pour /api/account/* (profil + photos). Toutes les routes
// (sauf cloudinary-config) requièrent une session user → credentials:include.
//
// Le backend HTML-escape les champs texte (règle d'or #2). On les décode
// ici pour que les formulaires affichent du texte propre.

import { decodeEntities } from "@/lib/sanitize";

const BASE = process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? "";

export interface PromptDTO {
  prompt: string; // clé i18n d'un prompt fermé, "" = slot vide
  answer: string;
}

export interface ProfileDTO {
  display_name: string;
  bio: string;
  birthdate?: string | null; // ISO yyyy-mm-dd
  prompts: [PromptDTO, PromptDTO, PromptDTO];
  is_verified?: boolean;
}

export interface PhotoDTO {
  position: number; // 1..6
  public_id: string;
}

export interface AccountDTO {
  profile: ProfileDTO;
  photos: PhotoDTO[];
}

export interface UploadSig {
  timestamp: number;
  api_key: string;
  signature: string;
  folder: string;
  cloud_name: string;
}

export class AccountError extends Error {
  status: number;
  constructor(msg: string, status: number) {
    super(msg);
    this.status = status;
  }
}

async function api<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new AccountError(`account: ${res.status}`, res.status);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function fetchAccount(): Promise<AccountDTO> {
  return decodeAccount(await api<AccountDTO>("GET", "/api/account"));
}

export async function updateAccount(p: ProfileDTO): Promise<AccountDTO> {
  return decodeAccount(await api<AccountDTO>("PUT", "/api/account", p));
}

function decodeAccount(acc: AccountDTO): AccountDTO {
  return {
    ...acc,
    profile: {
      ...acc.profile,
      display_name: decodeEntities(acc.profile.display_name),
      bio: decodeEntities(acc.profile.bio),
      prompts: acc.profile.prompts.map((q) => ({
        prompt: q.prompt,
        answer: decodeEntities(q.answer),
      })) as [PromptDTO, PromptDTO, PromptDTO],
    },
  };
}

export async function signPhotoUpload(): Promise<UploadSig> {
  return api<UploadSig>("POST", "/api/account/photos/sign", {});
}

export async function setPhoto(
  position: number,
  publicId: string,
): Promise<PhotoDTO> {
  return api<PhotoDTO>("POST", "/api/account/photos", {
    position,
    public_id: publicId,
  });
}

export async function deletePhoto(position: number): Promise<void> {
  await api<void>("DELETE", `/api/account/photos/${position}`);
}

let cloudNameCache: string | null = null;
export async function fetchCloudName(): Promise<string> {
  if (cloudNameCache) return cloudNameCache;
  const res = await fetch(`${BASE}/api/account/cloudinary-config`);
  if (!res.ok) throw new AccountError(`config: ${res.status}`, res.status);
  const data = (await res.json()) as { cloud_name: string };
  cloudNameCache = data.cloud_name;
  return data.cloud_name;
}

// uploadToCloudinary : POST direct au endpoint Cloudinary avec la signature
// produite par le backend. Renvoie le public_id du fichier uploadé.
export async function uploadToCloudinary(
  file: File,
  sig: UploadSig,
): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("api_key", sig.api_key);
  fd.append("timestamp", String(sig.timestamp));
  fd.append("signature", sig.signature);
  fd.append("folder", sig.folder);
  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${sig.cloud_name}/image/upload`,
    { method: "POST", body: fd },
  );
  if (!res.ok) throw new AccountError(`cloudinary: ${res.status}`, res.status);
  const data = (await res.json()) as { public_id: string };
  return data.public_id;
}

// cloudinaryUrl : construit l'URL d'affichage depuis le public_id.
// Crop face-aware + WebP auto par défaut.
export function cloudinaryUrl(
  cloudName: string,
  publicId: string,
  opts?: { w?: number; h?: number },
): string {
  const transforms = [
    "c_fill",
    "g_face",
    "f_auto",
    "q_auto",
    opts?.w ? `w_${opts.w}` : "w_512",
    opts?.h ? `h_${opts.h}` : "h_512",
  ].join(",");
  return `https://res.cloudinary.com/${cloudName}/image/upload/${transforms}/${publicId}`;
}

export interface VerifyResult {
  verified: boolean;
  confidence: number;
  error?: string;
}

export async function verifyPhoto(livePhotoId: string): Promise<VerifyResult> {
  return api<VerifyResult>("POST", "/api/account/verify", {
    live_photo_id: livePhotoId,
  });
}
