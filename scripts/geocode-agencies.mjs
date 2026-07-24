// One-off / occasional maintenance script — NOT run by the deployed app.
//
// Run it locally (it needs real network access to Nominatim, which most
// serverless hosts like Vercel restrict/timeout on at request time):
//
//   node scripts/geocode-agencies.mjs
//
// Reads the agency list from Redis (agencies:source — seeded there by
// scripts/seed-agencies.mjs from src/data/agencies-source.json), geocodes
// any agency that isn't already in the Redis coordinate cache
// (agencies:coordinates), and writes each result straight back to Redis as
// it goes — respecting Nominatim's ~1 request/second usage policy. There is
// no local agency-coordinates.json anymore; Redis is the only copy, same as
// the easter-egg photos.
//
// Requires the same Redis env vars as the app (UPSTASH_REDIS_REST_URL /
// UPSTASH_REDIS_REST_TOKEN, or whatever your Vercel integration named them —
// check .env.local).
import { Redis } from "@upstash/redis";

const AGENCIES_SOURCE_KEY = "agencies:source";
const AGENCY_COORDINATES_KEY = "agencies:coordinates";
const NOMINATIM_DELAY_MS = 1100;

const redis = Redis.fromEnv();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function geocodeQuery(query) {
  const params = new URLSearchParams({
    format: "jsonv2",
    addressdetails: "0",
    limit: "1",
    q: query,
  });

  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "road-trip-planner-geocode-script/1.0 (run locally, one-off)",
    },
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  const match = data[0];
  const lat = match?.lat !== undefined ? Number(match.lat) : NaN;
  const lon = match?.lon !== undefined ? Number(match.lon) : NaN;

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }

  return { lat, lon };
}

// Some addresses in the source spreadsheet don't resolve on the first,
// most specific query (typos, unusual street names, or a "Groupe" name
// that isn't actually the city). Rather than dropping the agency entirely,
// fall back to looser queries so it still gets *a* marker, even if the
// last resort places it at city-center instead of the exact street.
async function geocodeOne(agency) {
  const attempts = [
    { label: "address + city", query: `${agency.address}, ${agency.name}, France` },
    { label: "address only", query: `${agency.address}, France` },
    { label: "city only (approximate)", query: `${agency.name}, France` },
  ];

  for (let i = 0; i < attempts.length; i += 1) {
    const attempt = attempts[i];
    const result = await geocodeQuery(attempt.query);

    if (result) {
      if (i > 0) {
        console.log(`    (matched via fallback: ${attempt.label})`);
      }
      return result;
    }

    if (i < attempts.length - 1) {
      await sleep(NOMINATIM_DELAY_MS);
    }
  }

  console.error(`  ✗ ${agency.name}: no match at any fallback level`);
  return null;
}

async function main() {
  const agencies = await redis.get(AGENCIES_SOURCE_KEY);
  if (!agencies) {
    console.error(
      `No agency data found in Redis at "${AGENCIES_SOURCE_KEY}". Run scripts/seed-agencies.mjs first.`,
    );
    process.exit(1);
  }

  const cache = (await redis.get(AGENCY_COORDINATES_KEY)) ?? {};

  const pending = agencies.filter((agency) => !cache[agency.id]);
  console.log(`${agencies.length} agencies total, ${pending.length} need geocoding.`);

  for (const [index, agency] of pending.entries()) {
    const result = await geocodeOne(agency);
    if (result) {
      cache[agency.id] = result;
      console.log(`  ✓ (${index + 1}/${pending.length}) ${agency.name} -> ${result.lat}, ${result.lon}`);

      // Save progress after every lookup so an interrupted run doesn't lose
      // work — same as the old file-write-per-iteration behavior.
      await redis.set(AGENCY_COORDINATES_KEY, cache);
    }

    if (index < pending.length - 1) {
      await sleep(NOMINATIM_DELAY_MS);
    }
  }

  console.log("Done. Redis agencies:coordinates is up to date.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
