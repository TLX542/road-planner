import { Redis } from "@upstash/redis";

const VISITED_SET_KEY = "agencies:visited";

// @vercel/kv is deprecated — Vercel KV moved to Upstash Redis under Vercel
// Integrations. `Redis.fromEnv()` reads whichever REST URL/token env vars
// the integration injected (commonly KV_REST_API_URL / KV_REST_API_TOKEN,
// or UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN depending on the
// integration version — check the project's Environment Variables tab in
// the Vercel dashboard after connecting it if this throws).
const redis = Redis.fromEnv();

/**
 * Which agencies have been marked "visited". Backed by Redis so the state
 * is shared and permanent for everyone who loads the site — not just the
 * browser that clicked it. A plain filesystem write wouldn't survive here:
 * Vercel's serverless functions get a fresh, read-only-ish filesystem per
 * invocation (see the comment in app/api/agencies/route.ts).
 */
export async function getVisitedAgencyIds(): Promise<Set<string>> {
  const ids = await redis.smembers(VISITED_SET_KEY);
  return new Set(ids);
}

export async function setAgencyVisited(agencyId: string, visited: boolean): Promise<void> {
  if (visited) {
    await redis.sadd(VISITED_SET_KEY, agencyId);
  } else {
    await redis.srem(VISITED_SET_KEY, agencyId);
  }
}