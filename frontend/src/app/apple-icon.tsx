import { ImageResponse } from "next/og";

// Apple touch icon (180×180 PNG) servie à `/apple-icon`. Reprend le J de
// Jolyne extrait de `icon.svg`, fond noir pour matcher le theme_color.
// Convention Next.js : ce fichier remplace toute déclaration manuelle de
// link rel="apple-touch-icon" dans le <head>.

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0a",
          borderRadius: 32,
        }}
      >
        <svg
          width="120"
          height="120"
          viewBox="0 0 9600 9600"
          xmlns="http://www.w3.org/2000/svg"
        >
          <g transform="translate(0,9600) scale(1,-1)" fill="#ffffff" stroke="none">
            <path d="M4160 7200 l0 -860 -1089 0 -1089 0 -6 -1702 c-4 -937 -6 -1811 -4 -1943 l3 -240 568 -3 567 -2 0 -475 c0 -261 2 -475 5 -475 3 0 166 110 363 244 196 134 510 348 696 475 l339 231 694 0 693 0 0 453 c1 248 2 736 3 1082 l2 630 833 3 832 2 0 1720 0 1720 -1705 0 -1705 0 0 -860z m2930 -860 l0 -1250 -592 2 -593 3 -3 623 -2 622 -535 0 -535 0 0 -240 0 -240 300 0 300 0 0 -132 c1 -73 2 -731 3 -1463 l2 -1330 -517 -5 -517 -5 -408 -275 c-224 -151 -413 -277 -421 -278 -11 -3 -13 41 -12 255 1 142 1 268 1 281 l-1 22 -555 0 -555 0 0 1465 0 1465 853 -2 852 -3 3 -617 2 -618 535 0 535 0 0 235 0 235 -300 0 -300 0 0 1250 0 1250 1230 0 1230 0 0 -1250z" />
          </g>
        </svg>
      </div>
    ),
    { ...size },
  );
}
