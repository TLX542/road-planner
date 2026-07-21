import { Redis } from "@upstash/redis";
import { NextRequest, NextResponse } from "next/server";

// Reads UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN from env
// automatically — same Upstash instance the rest of the app already uses.
const redis = Redis.fromEnv();

// Backing store for the two easter-egg marker photos. They live in Redis
// only — never committed to the repo, never shipped in the JS bundle. The
// only way to reach this route from the UI is the hidden click sequence in
// page.tsx; nothing links here.

const KEYS = {
  marc: "easter-egg:marc",
  nicolas: "easter-egg:nicolas",
} as const;

export async function GET() {
  const [marc, nicolas] = await Promise.all([
    redis.get<string>(KEYS.marc),
    redis.get<string>(KEYS.nicolas),
  ]);

  if (!marc || !nicolas) {
    return NextResponse.json({ error: "not seeded" }, { status: 404 });
  }

  return NextResponse.json({ marc, nicolas });
}

// One-time (or re-run whenever) seeding endpoint — run scripts/seed-easter-egg.mjs
// locally against your deployment, it never touches git. Gated by a secret
// so it can't be overwritten by anyone who stumbles onto the URL.
export async function POST(request: NextRequest) {
  const secretEnv = process.env.EASTER_EGG_SEED_SECRET;
  if (!secretEnv) {
    return NextResponse.json({ error: "EASTER_EGG_SEED_SECRET not configured" }, { status: 500 });
  }

  let body: { secret?: string; marc?: string; nicolas?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (body.secret !== secretEnv) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (typeof body.marc !== "string" || typeof body.nicolas !== "string") {
    return NextResponse.json(
      { error: "marc and nicolas (base64 data URLs) are required" },
      { status: 400 },
    );
  }

  await Promise.all([redis.set(KEYS.marc, body.marc), redis.set(KEYS.nicolas, body.nicolas)]);

  return NextResponse.json({ ok: true });
}