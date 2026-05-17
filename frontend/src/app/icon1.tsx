import { ImageResponse } from "next/og";

// PWA icon 192x192. Next.js auto-découvre tout fichier icon{N}.tsx et
// l'expose sur /icon1. Référencé dans manifest.ts.
export const size = { width: 192, height: 192 };
export const contentType = "image/png";

export default function Icon192() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          background: "#0a0a0a",
          color: "#fafafa",
          fontSize: 128,
          fontWeight: 700,
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        J
      </div>
    ),
    size,
  );
}
