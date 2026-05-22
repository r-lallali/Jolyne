"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { signPhotoUpload, uploadToCloudinary, verifyPhoto } from "@/lib/account";

interface Props {
  isVerified: boolean;
  hasProfilePhoto: boolean;
  onVerified: () => void;
}

export function VerificationCard({ isVerified, hasProfilePhoto, onVerified }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [confidence, setConfidence] = useState<number | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Close camera and stop track stream
  const stopCamera = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
  }, [stream]);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  const startCamera = async () => {
    setError(null);
    setSuccess(false);
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: 640, height: 480 },
        audio: false,
      });
      setStream(mediaStream);
      setIsOpen(true);
      // Wait for ref update and play video
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
      }, 100);
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
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5 text-neutral-900 dark:text-neutral-50 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-emerald-500 text-neutral-50 shadow-md shadow-emerald-500/20">
            <CheckIcon className="size-5" />
          </div>
          <div>
            <h3 className="font-semibold text-neutral-900 dark:text-emerald-400">Compte Certifié</h3>
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
            <span className="rounded-full bg-indigo-500/10 px-2.5 py-0.5 text-[10px] font-medium text-indigo-600 dark:text-indigo-400">
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
              className="w-full rounded-xl bg-neutral-100 px-4 py-2.5 text-xs font-semibold text-neutral-400 dark:bg-neutral-900 dark:text-neutral-500"
            >
              {"Ajouter une photo d'abord"}
            </button>
          ) : (
            <button
              onClick={startCamera}
              className="w-full rounded-xl bg-neutral-900 px-4 py-2.5 text-xs font-semibold text-neutral-50 shadow-md shadow-neutral-900/10 hover:opacity-95 transition-all dark:bg-neutral-50 dark:text-neutral-900 dark:shadow-neutral-50/5"
            >
              Vérifier mon profil
            </button>
          )}
        </div>
      </div>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="relative w-full max-w-md overflow-hidden rounded-3xl bg-neutral-950 p-6 text-center shadow-2xl border border-neutral-800"
            >
              <h3 className="text-lg font-bold text-neutral-50">Vérification en Direct</h3>
              <p className="text-xs text-neutral-400 mt-1">
                {"Centrez votre visage dans le cercle et regardez l'objectif."}
              </p>

              {/* Video Container with circular mask overlay */}
              <div className="relative mx-auto my-6 overflow-hidden rounded-2xl bg-neutral-900 aspect-square max-w-[280px]">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="h-full w-full object-cover scale-x-[-1]"
                />
                {/* Circular face guide overlay */}
                <div className="absolute inset-0 pointer-events-none border-[12px] border-neutral-950/70 flex items-center justify-center">
                  <div className="w-[180px] h-[180px] rounded-full border-2 border-dashed border-indigo-500/80 shadow-[0_0_0_9999px_rgba(10,10,10,0.6)] animate-pulse" />
                </div>
              </div>

              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={() => {
                    stopCamera();
                    setIsOpen(false);
                  }}
                  className="rounded-xl bg-neutral-800 px-4 py-2.5 text-xs font-semibold text-neutral-300 hover:bg-neutral-700 transition-colors"
                >
                  Annuler
                </button>
                <button
                  onClick={captureAndVerify}
                  className="rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-semibold text-neutral-50 shadow-md shadow-indigo-600/20 hover:bg-indigo-500 transition-colors"
                >
                  Prendre le selfie
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
