// One-off / occasional maintenance script — NOT run by the deployed app.
//
// Run it locally (it needs real network access to Nominatim, which most
// serverless hosts like Vercel restrict/timeout on at request time):
//
//   node scripts/geocode-agencies.mjs
//
// It reads data/agencies-source.json, geocodes any agency that isn't
// already in data/agency-coordinates.json, and writes the result back to
// that file — respecting Nominatim's ~1 request/second usage policy.
// Commit the updated data/agency-coordinates.json afterwards; the app reads
// it as a static import, so there is nothing to geocode at request time.
import { readFile, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = path.join(__dirname, "..", "src", "data", "agencies-source.json");
const CACHE_PATH = path.join(__dirname, "..", "src", "data", "agency-coordinates.json");
const NOMINATIM_DELAY_MS = 1100;

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

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
  const agencies = await readJson(SOURCE_PATH, []);
  const cache = await readJson(CACHE_PATH, {});

  const pending = agencies.filter((agency) => !cache[agency.id]);
  console.log(`${agencies.length} agencies total, ${pending.length} need geocoding.`);

  for (const [index, agency] of pending.entries()) {
    const result = await geocodeOne(agency);
    if (result) {
      cache[agency.id] = result;
      console.log(`  ✓ (${index + 1}/${pending.length}) ${agency.name} -> ${result.lat}, ${result.lon}`);
    }

    // Save progress after every lookup so an interrupted run doesn't lose work.
    await writeFile(CACHE_PATH, JSON.stringify(cache, null, 2) + "\n", "utf-8");

    if (index < pending.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, NOMINATIM_DELAY_MS));
    }
  }

  console.log("Done. data/agency-coordinates.json is up to date.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
