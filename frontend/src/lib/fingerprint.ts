import FingerprintJS from "@fingerprintjs/fingerprintjs";

const STORAGE_KEY = "jolyne_fp";

let promise: Promise<string> | null = null;

// getFingerprint renvoie un identifiant device stable, mis en cache dans
// localStorage. Lazy : ne charge la lib qu'au premier appel.
export function getFingerprint(): Promise<string> {
  if (promise) return promise;
  promise = (async () => {
    if (typeof window !== "undefined") {
      const cached = window.localStorage.getItem(STORAGE_KEY);
      if (cached) return cached;
    }
    const fp = await FingerprintJS.load();
    const r = await fp.get();
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, r.visitorId);
    }
    return r.visitorId;
  })();
  return promise;
}
