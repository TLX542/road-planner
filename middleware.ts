import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const AUTH_COOKIE = "site_auth";

// Gatekeeper: every request must carry the site_auth cookie (set by
// /api/login after checking the password against SITE_PASSWORD), except
// requests for the login page/API and Next's own static assets — those have
// to stay reachable or no one could ever get to the form that lets them in.
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/login") || pathname.startsWith("/api/login")) {
    return NextResponse.next();
  }

  const isAuthed = request.cookies.get(AUTH_COOKIE)?.value === "ok";
  if (isAuthed) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("from", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Run on everything except Next's internal static/image assets and the
  // favicon, so the theme-init script, fonts, etc. can still load on the
  // login page itself.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};