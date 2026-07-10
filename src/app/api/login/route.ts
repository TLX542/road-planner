import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const AUTH_COOKIE = "site_auth";

export async function POST(request: NextRequest) {
  let password: string | undefined;

  try {
    const body = (await request.json()) as { password?: string };
    password = body.password;
  } catch {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }

  const expected = process.env.SITE_PASSWORD;

  if (!expected) {
    // Fails closed: with no password configured, no one gets in — this
    // should only happen if SITE_PASSWORD hasn't been set yet.
    return NextResponse.json(
      { error: "Aucun mot de passe n'est configuré sur le serveur (SITE_PASSWORD)." },
      { status: 500 },
    );
  }

  if (!password || password !== expected) {
    return NextResponse.json({ error: "Mot de passe incorrect." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(AUTH_COOKIE, "ok", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return response;
}