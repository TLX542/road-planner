import { Redis } from "@upstash/redis";

export type AgencyScreen = {
  brand: string;
  model: string;
  // how many identical (brand, model) units are recorded at this agency
  count: number;
};

export type AgencyRecord = {
  id: string;
  name: string;
  address: string;
  screens: AgencyScreen[];
};

export type GeocodedAgency = AgencyRecord & {
  lat: number;
  lon: number;
};

type CoordinateMap = Record<string, { lat: number; lon: number }>;

const AGENCIES_SOURCE_KEY = "agencies:source";
const AGENCY_COORDINATES_KEY = "agencies:coordinates";

// Same client/env-var convention as lib/visited-agencies.ts.
const redis = Redis.fromEnv();

// These only change when scripts/seed-agencies.mjs is re-run (i.e. when
// suivi_ecrans.xlsx is re-extracted or coordinates are regenerated) — not
// on every request — so a warm serverless instance can safely cache them
// in module scope instead of round-tripping to Redis each time.
let cachedAgencies: AgencyRecord[] | null = null;
let cachedCoordinates: CoordinateMap | null = null;

async function loadAgencies(): Promise<AgencyRecord[]> {
  if (cachedAgencies) return cachedAgencies;

  const data = await redis.get<AgencyRecord[]>(AGENCIES_SOURCE_KEY);
  if (!data) {
    throw new Error(
      `No agency data found in Redis at "${AGENCIES_SOURCE_KEY}". Run scripts/seed-agencies.mjs first.`,
    );
  }
  cachedAgencies = data;
  return data;
}

async function loadCoordinates(): Promise<CoordinateMap> {
  if (cachedCoordinates) return cachedCoordinates;

  const data = await redis.get<CoordinateMap>(AGENCY_COORDINATES_KEY);
  // Missing coordinates is non-fatal — same behavior as before: agencies
  // without a coordinate entry are just left off the geocoded list.
  cachedCoordinates = data ?? {};
  return cachedCoordinates;
}

export async function getAgencies(): Promise<AgencyRecord[]> {
  return loadAgencies();
}

export async function getGeocodedAgencies(): Promise<GeocodedAgency[]> {
  const [agencies, coordinates] = await Promise.all([loadAgencies(), loadCoordinates()]);

  return agencies.flatMap((agency) => {
    const coordinate = coordinates[agency.id];
    return coordinate ? [{ ...agency, ...coordinate }] : [];
  });
}