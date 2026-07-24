#!/usr/bin/env node
// Pushes src/data/agencies-source.json into Upstash Redis so the app reads
// it at runtime instead of importing the file directly.
//
// Only agencies-source.json is seeded from here — it's the output of the
// separate suivi_ecrans.xlsx extraction script, so that one still needs to
// exist locally as the extraction script's output before this can push it.
// agency-coordinates.json has no local copy anymore: scripts/geocode-agencies.mjs
// reads/writes that one directly against Redis (agencies:coordinates).
//
// Run this once to seed Redis initially, and again whenever the extraction
// script regenerates src/data/agencies-source.json from a refreshed export.
//
// Usage: node scripts/seed-agencies.mjs
// Requires the same Redis env vars as the app (UPSTASH_REDIS_REST_URL /
// UPSTASH_REDIS_REST_TOKEN, or whatever your Vercel integration named
// them — check .env.local).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Redis } from "@upstash/redis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = path.join(__dirname, "..", "src", "data", "agencies-source.json");

const AGENCIES_SOURCE_KEY = "agencies:source";

async function main() {
  const redis = Redis.fromEnv();

  const sourceRaw = await readFile(SOURCE_PATH, "utf8");
  const source = JSON.parse(sourceRaw);

  await redis.set(AGENCIES_SOURCE_KEY, source);

  console.log(`Seeded ${source.length} agencies into Redis at "${AGENCIES_SOURCE_KEY}".`);
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
