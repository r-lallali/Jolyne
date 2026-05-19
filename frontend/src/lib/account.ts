// Client HTTP pour /api/account/* (profil + photos). Toutes les routes
// (sauf cloudinary-config) requièrent une session user → credentials:include.

const BASE = process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? "";

export interface ProfileDTO {
  display_name: string;
  bio: string;
  birthdate?: string | null; // ISO yyyy-mm-dd
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
  return api<AccountDTO>("GET", "/api/account");
}

export async function updateAccount(p: ProfileDTO): Promise<AccountDTO> {
  return api<AccountDTO>("PUT", "/api/account", p);
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
