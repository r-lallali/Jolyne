"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { signPhotoUpload, uploadToCloudinary, verifyPhoto } from "@/lib/account";
import { useT } from "@/lib/i18n";

interface Props {
  isVerified: boolean;
  hasProfilePhoto: boolean;
  onVerified: () => void;
}

export function VerificationCard({ isVerified, hasProfilePhoto, onVerified }: Props) {
  const t = useT();
  const [isOpen, setIsOpen] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [confidence, setConfidence] = useState<number | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Garde streamRef sync avec l'état pour pouvoir libérer les tracks sans
  // dépendre d'une closure stale (cleanup d'unmount notamment).
  useEffect(() => {
    streamRef.current = stream;
  }, [stream]);

  const stopCamera = useCallback(() => {
    const s = streamRef.current;
    if (s) {
      s.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setStream(null);
      setVideoReady(false);
    }
  }, []);

  // Cleanup au démontage uniquement — pas de dépendance sur stream pour
  // éviter de couper le flux à chaque re-render.
  useEffect(() => {
    return () => {
      const s = streamRef.current;
      if (s) s.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Attache le MediaStream à l'élément <video> une fois que le modal est
  // monté ET que le stream existe. Évite la race condition du setTimeout :
  // sur mobile lent, videoRef.current pouvait être null à 100ms.
  useEffect(() => {
    if (!isOpen || !stream) return;
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    // iOS Safari : `autoplay` ne suffit pas, il faut un .play() explicite
    // après srcObject. On gère le rejet silencieusement (user a déjà
    // autorisé la caméra via le prompt natif → play() ne devrait pas être
    // bloqué, mais certains navigateurs lèvent une exception bénigne).
    const onPlaying = () => setVideoReady(true);
    video.addEventListener("playing", onPlaying);
    video.play().catch(() => {});
    return () => {
      video.removeEventListener("playing", onPlaying);
    };
  }, [isOpen, stream]);

  const startCamera = async () => {
    setError(null);
    setSuccess(false);

    if (typeof window === "undefined" || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError(
        "La caméra n'est pas accessible. Assurez-vous d'utiliser une connexion sécurisée HTTPS (https://) et non HTTP (http://)."
      );
      return;
    }

    try {
      // Contraintes souples : si la résolution exacte n'est pas dispo
      // (webcams basiques, front cam contraintes), `ideal` laisse le
      // navigateur retomber sur la meilleure approx au lieu d'échouer.
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      });
      setStream(mediaStream);
      setIsOpen(true);
    } catch {
      setError("Impossible d'accéder à votre caméra. Veuillez autoriser l'accès pour continuer.");
    }
  };

  const captureAndVerify = async () => {
    if (!videoRef.current || !canvasRef.current) return;

    setLoading(true);
    setError(null);

    try {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const context = canvas.getContext("2d");

      if (!context) {
        throw new Error("Impossible de démarrer le processeur d'image.");
      }

      // Draw video frame on canvas
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Convert canvas to blob
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/jpeg", 0.9)
      );

      if (!blob) {
        throw new Error("Échec de la capture d'image.");
      }

      const file = new File([blob], "selfie.jpg", { type: "image/jpeg" });

      // Stop camera feed as early as possible for privacy and efficiency
      stopCamera();
      setIsOpen(false);

      // 1. Sign photo upload for Cloudinary
      const uploadSig = await signPhotoUpload();

      // 2. Upload file
      const livePhotoId = await uploadToCloudinary(file, uploadSig);

      // 3. Call backend verification endpoint
      const result = await verifyPhoto(livePhotoId);

      if (result.verified) {
        setSuccess(true);
        setConfidence(result.confidence);
        onVerified();
      } else {
        setError(result.error ?? "Le visage ne correspond pas à la photo de profil principale.");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Une erreur est survenue lors de la vérification. Veuillez réessayer.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  if (isVerified) {
    return (
      <div className="rounded-2xl border border-emerald-700/25 bg-emerald-700/5 p-4 text-neutral-900 dark:text-neutral-50">
        <div className="flex items-center gap-3">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-neutral-50">
            <CheckIcon className="size-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-emerald-500">Compte Certifié</h3>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
              Votre identité a été vérifiée automatiquement par reconnaissance faciale.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950/40 backdrop-blur-sm shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex-1">
          <h3 className="font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
            Badge de Vérification
            <span className="rounded-full bg-emerald-700/10 px-2.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-500">
              Instantané
            </span>
          </h3>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
            Certifiez votre profil pour rassurer vos correspondants. La photo live est immédiatement détruite après analyse.
          </p>
        </div>
        <div className="shrink-0">
          {!hasProfilePhoto ? (
            <button
              disabled
              className="inline-flex items-center rounded-xl bg-neutral-100 px-4 py-2.5 text-xs font-semibold text-neutral-400 dark:bg-neutral-900 dark:text-neutral-500"
            >
              {"Ajouter une photo d'abord"}
            </button>
          ) : (
            <button
              onClick={startCamera}
              className="inline-flex items-center rounded-xl bg-emerald-700 px-4 py-2.5 text-xs font-semibold text-neutral-50 transition-opacity hover:opacity-90"
            >
              Vérifier mon profil
            </button>
          )}
        </div>
      </div>

      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {isOpen && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-neutral-950/70 p-4 pt-[max(env(safe-area-inset-top)+1rem,1rem)] backdrop-blur-md sm:items-center sm:pt-4"
            onClick={() => {
              stopCamera();
              setIsOpen(false);
            }}
          >
            <motion.div
              initial={{ scale: 0.96, y: 8 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.96, y: 8 }}
              transition={{ type: "spring", stiffness: 320, damping: 28 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-2xl dark:bg-neutral-950 dark:ring-1 dark:ring-neutral-800"
            >
              <button
                type="button"
                onClick={() => {
                  stopCamera();
                  setIsOpen(false);
                }}
                aria-label="Fermer"
                className="absolute right-3 top-3 inline-flex size-8 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-900 dark:hover:text-neutral-50"
              >
                ✕
              </button>
              <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-50">
                {t.account.verifyTitle}
              </h3>
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                {t.account.verifyHint}
              </p>

              {/* Cercle vidéo pur : la <video> est masquée en cercle,
                  encadrée par un ring soft qui pulse pendant l'attente. */}
              <div className="relative mx-auto mt-6 aspect-square w-56 sm:w-64">
                <div
                  className={`absolute inset-0 rounded-full transition-all duration-500 ${
                    videoReady
                      ? "ring-2 ring-emerald-500/60 ring-offset-4 ring-offset-white dark:ring-offset-neutral-950"
                      : "ring-2 ring-neutral-300 ring-offset-4 ring-offset-white animate-pulse dark:ring-neutral-700 dark:ring-offset-neutral-950"
                  }`}
                />
                <div className="absolute inset-1 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-900">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="h-full w-full object-cover scale-x-[-1]"
                  />
                  {!videoReady && (
                    <div className="absolute inset-0 flex items-center justify-center bg-neutral-100 dark:bg-neutral-900">
                      <Spinner className="size-6 animate-spin text-neutral-400" />
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-6 flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    stopCamera();
                    setIsOpen(false);
                  }}
                  className="flex-1 rounded-xl bg-neutral-100 px-4 py-3 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-200 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  {t.account.verifyCancel}
                </button>
                <button
                  type="button"
                  onClick={captureAndVerify}
                  disabled={!videoReady}
                  className="flex-1 rounded-xl bg-neutral-900 px-4 py-3 text-sm font-semibold text-neutral-50 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-neutral-50 dark:text-neutral-900"
                >
                  {t.account.verifyCapture}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>,
          document.body,
        )}

      <canvas ref={canvasRef} style={{ display: "none" }} />

      <AnimatePresence mode="wait">
        {loading && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-4 flex items-center gap-3 rounded-xl bg-indigo-500/5 border border-indigo-500/10 p-3 text-xs text-indigo-600 dark:text-indigo-400"
          >
            <Spinner className="size-4 animate-spin shrink-0" />
            <div className="flex-1">
              <span className="font-semibold block">Analyse biométrique en cours...</span>
              <span className="text-[10px] opacity-80 block mt-0.5">Le moteur compare vos traits faciaux à votre photo principale.</span>
            </div>
          </motion.div>
        )}

        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-4 rounded-xl bg-rose-500/5 border border-rose-500/10 p-3 text-xs text-rose-600 dark:text-rose-400"
          >
            <div className="flex gap-2">
              <div className="shrink-0 mt-0.5">
                <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <span className="font-semibold block">Échec de la vérification</span>
                <span className="block mt-0.5 text-[11px] leading-relaxed">{error}</span>
                <button
                  onClick={startCamera}
                  className="mt-2 text-[10px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-300 hover:underline"
                >
                  Réessayer
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {success && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-4 rounded-xl bg-emerald-500/5 border border-emerald-500/10 p-3 text-xs text-emerald-600 dark:text-emerald-400"
          >
            <div className="flex gap-2">
              <div className="shrink-0 mt-0.5">
                <CheckIcon className="size-4" />
              </div>
              <div>
                <span className="font-semibold block">Profil Vérifié avec Succès !</span>
                <span className="block mt-0.5 text-[11px] leading-relaxed">
                  Notre logiciel a trouvé une correspondance faciale de {(confidence ? confidence * 100 : 85).toFixed(0)}%. Le badge vert est désormais actif.
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Spinner({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.2" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}
