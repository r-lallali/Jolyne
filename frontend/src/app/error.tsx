"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Caught error in error.tsx:", error);
  }, [error]);

  return (
    <div className="flex h-screen w-full flex-col items-center justify-center bg-red-900 text-white z-50">
      <h2 className="text-4xl font-bold">Something went wrong!</h2>
      <p className="mt-4 text-lg font-mono bg-black/50 p-4 rounded">{error.message}</p>
      <button
        className="mt-6 px-4 py-2 bg-white text-black rounded"
        onClick={() => reset()}
      >
        Try again
      </button>
    </div>
  );
}
