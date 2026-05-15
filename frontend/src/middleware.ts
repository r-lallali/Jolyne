import { NextResponse, type NextRequest } from "next/server";

// Middleware Next.js : protège /admin/* en exigeant la présence du cookie
// `jolyne_admin` (set par le backend Go après login réussi). La validation
// cryptographique se fait côté backend à chaque requête API — ici on filtre
// juste les visiteurs non connectés.
//
// CLAUDE.md §"Back-office" : échec → 404 plutôt que 401, pour ne pas
// révéler l'existence de la route. Sur le middleware, on redirige vers
// /admin/login plutôt que renvoyer 404, parce que /admin/login EST
// l'entrée publique normale du back-office.
export function middleware(req: NextRequest) {
  if (req.nextUrl.pathname === "/admin/login") {
    return NextResponse.next();
  }
  if (!req.nextUrl.pathname.startsWith("/admin")) {
    return NextResponse.next();
  }
  if (!req.cookies.get("jolyne_admin")) {
    const url = req.nextUrl.clone();
    url.pathname = "/admin/login";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/admin/:path*",
};
