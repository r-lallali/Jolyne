// Icônes SVG inline de la feuille d'auth (CSP stricte : aucune image
// externe). Le G Google garde ses couleurs de marque, le reste suit
// currentColor.

export function GoogleIcon() {
  return (
    <svg className="size-4 shrink-0" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3.01h3.88c2.27-2.09 3.58-5.17 3.58-8.82z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.88-3.01c-1.07.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.72-4.95H1.27v3.11A12 12 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.28A7.21 7.21 0 0 1 4.9 12c0-.79.14-1.56.38-2.28V6.61H1.27a12 12 0 0 0 0 10.78l4.01-3.11z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.76 0 3.34.61 4.58 1.8l3.44-3.44A11.53 11.53 0 0 0 12 0 12 12 0 0 0 1.27 6.61l4.01 3.11C6.22 6.88 8.87 4.77 12 4.77z"
      />
    </svg>
  );
}

export function AppleIcon() {
  return (
    <svg
      className="size-4 shrink-0"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M16.37 1.43c0 1.14-.47 2.2-1.23 3.02-.8.87-2.1 1.54-3.18 1.46-.13-1.1.44-2.27 1.18-3.08.82-.9 2.22-1.54 3.23-1.4zM20.8 17.02c-.57 1.3-.84 1.88-1.57 3.03-1.02 1.6-2.46 3.6-4.25 3.61-1.58.02-1.99-1.04-4.14-1.02-2.15.01-2.6 1.05-4.19 1.03-1.79-.02-3.15-1.82-4.17-3.42-2.83-4.55-3.13-9.82-1.24-12.62 1.34-1.99 3.46-3.16 5.45-3.16 2.03 0 3.3 1.05 4.98 1.05 1.63 0 2.62-1.05 4.97-1.05 1.77 0 3.65.97 4.99 2.63-4.38 2.4-3.67 8.65-.83 9.92z" />
    </svg>
  );
}

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export function MailIcon() {
  return (
    <svg className="size-4 shrink-0" viewBox="0 0 24 24" {...stroke} aria-hidden>
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}

export function BackIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" {...stroke} aria-hidden>
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" {...stroke} aria-hidden>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

export function EyeIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" {...stroke} aria-hidden>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function EyeOffIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" {...stroke} aria-hidden>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 19c-6 0-10-7-10-7a17.5 17.5 0 0 1 4.06-4.94" />
      <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c6 0 10 7 10 7a17.5 17.5 0 0 1-2.16 2.93" />
      <path d="M9.88 9.88a3 3 0 0 0 4.24 4.24" />
      <path d="M2 2l20 20" />
    </svg>
  );
}
