import { Redis } from "@upstash/redis";

import { HttpError } from "@/lib/trip-planner";

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

// ---------------------------------------------------------------------
// Create / update / delete
// ---------------------------------------------------------------------
//
// Everything below lets an admin add a brand-new agency, edit an existing
// one's name/address/screens, or remove one entirely, with the change
// persisted straight back to the same Redis keys getAgencies/
// getGeocodedAgencies read from. The module-scope cache is updated
// alongside every write so a warm serverless instance never serves stale
// data back to itself after its own write.

export type AgencyScreenInput = {
  brand: string;
  model: string;
  count: number;
};

export type AgencyInput = {
  name: string;
  address: string;
  screens: AgencyScreenInput[];
};

export type Coordinate = { lat: number; lon: number };

function slugifyAgencyName(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "agence";
}

// New agencies don't come from the original suivi_ecrans.xlsx import, so
// they have no pre-existing id — one is derived from the name instead,
// de-duplicated against whatever ids are already in use.
function generateAgencyId(name: string, existing: AgencyRecord[]): string {
  const base = slugifyAgencyName(name);
  const existingIds = new Set(existing.map((agency) => agency.id));
  if (!existingIds.has(base)) {
    return base;
  }

  let suffix = 2;
  while (existingIds.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

async function persistAgencies(agencies: AgencyRecord[]): Promise<void> {
  await redis.set(AGENCIES_SOURCE_KEY, agencies);
  cachedAgencies = agencies;
}

async function persistCoordinates(coordinates: CoordinateMap): Promise<void> {
  await redis.set(AGENCY_COORDINATES_KEY, coordinates);
  cachedCoordinates = coordinates;
}

function parseScreens(value: unknown): AgencyScreenInput[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new HttpError(400, "screens must be an array.");
  }

  return value.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new HttpError(400, `screens[${index}] must be an object.`);
    }

    const { brand, model, count } = entry as Record<string, unknown>;

    if (typeof brand !== "string" || brand.trim().length === 0) {
      throw new HttpError(400, `screens[${index}].brand must be a non-empty string.`);
    }
    if (typeof model !== "string" || model.trim().length === 0) {
      throw new HttpError(400, `screens[${index}].model must be a non-empty string.`);
    }
    if (typeof count !== "number" || !Number.isFinite(count) || !Number.isInteger(count) || count < 1) {
      throw new HttpError(400, `screens[${index}].count must be a positive whole number.`);
    }

    return { brand: brand.trim(), model: model.trim(), count };
  });
}

/**
 * Validates and normalizes the JSON body of a create/update agency
 * request. Throws HttpError(400, ...) with a specific, user-facing message
 * on the first problem found, so route handlers can just catch it and
 * report it back as-is.
 */
export function parseAgencyInput(body: unknown): AgencyInput {
  if (typeof body !== "object" || body === null) {
    throw new HttpError(400, "Request body must be a JSON object.");
  }

  const { name, address, screens } = body as Record<string, unknown>;

  if (typeof name !== "string" || name.trim().length === 0) {
    throw new HttpError(400, "name is required.");
  }
  if (typeof address !== "string" || address.trim().length === 0) {
    throw new HttpError(400, "address is required.");
  }

  return {
    name: name.trim(),
    address: address.trim(),
    screens: parseScreens(screens),
  };
}

/**
 * Optional manual lat/lon override on a create/update request — lets the
 * caller skip re-geocoding (e.g. the address text didn't actually change).
 * Returns undefined when neither field is present; throws if only one is,
 * or either is non-finite.
 */
export function parseOptionalCoordinate(body: unknown): Coordinate | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }

  const { lat, lon } = body as Record<string, unknown>;
  if (lat === undefined && lon === undefined) {
    return undefined;
  }

  const parsedLat = Number(lat);
  const parsedLon = Number(lon);
  if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLon)) {
    throw new HttpError(400, "lat/lon must both be finite numbers when provided.");
  }

  return { lat: parsedLat, lon: parsedLon };
}

/**
 * Adds a brand-new agency to the shared list, alongside its geocoded
 * coordinate.
 */
export async function createAgency(input: AgencyInput, coordinate: Coordinate): Promise<GeocodedAgency> {
  const [agencies, coordinates] = await Promise.all([loadAgencies(), loadCoordinates()]);

  const id = generateAgencyId(input.name, agencies);
  const record: AgencyRecord = {
    id,
    name: input.name,
    address: input.address,
    screens: input.screens,
  };

  await Promise.all([
    persistAgencies([...agencies, record]),
    persistCoordinates({ ...coordinates, [id]: coordinate }),
  ]);

  return { ...record, ...coordinate };
}

/**
 * Overwrites an existing agency's name/address/screens in place (id and
 * position in the list are preserved). Pass `coordinate` whenever the
 * address was (re-)geocoded by the caller; omit it to leave the agency's
 * existing coordinate untouched.
 */
export async function updateAgency(id: string, input: AgencyInput, coordinate?: Coordinate): Promise<GeocodedAgency> {
  const [agencies, coordinates] = await Promise.all([loadAgencies(), loadCoordinates()]);

  const index = agencies.findIndex((agency) => agency.id === id);
  if (index === -1) {
    throw new HttpError(404, `No agency found with id "${id}".`);
  }

  const record: AgencyRecord = { id, name: input.name, address: input.address, screens: input.screens };
  const updatedAgencies = [...agencies];
  updatedAgencies[index] = record;

  const updatedCoordinates = coordinate ? { ...coordinates, [id]: coordinate } : coordinates;

  await Promise.all([
    persistAgencies(updatedAgencies),
    coordinate ? persistCoordinates(updatedCoordinates) : Promise.resolve(),
  ]);

  const resolvedCoordinate = coordinate ?? coordinates[id];
  return { ...record, ...resolvedCoordinate };
}

/**
 * Removes an agency from both the source list and the coordinate map.
 * Visited/comment state (a separate Redis key — see
 * lib/visited-agencies.ts) is the caller's responsibility to clean up
 * alongside this; it isn't touched here.
 */
export async function deleteAgency(id: string): Promise<void> {
  const [agencies, coordinates] = await Promise.all([loadAgencies(), loadCoordinates()]);

  const updatedAgencies = agencies.filter((agency) => agency.id !== id);
  if (updatedAgencies.length === agencies.length) {
    throw new HttpError(404, `No agency found with id "${id}".`);
  }

  const updatedCoordinates = { ...coordinates };
  delete updatedCoordinates[id];

  await Promise.all([persistAgencies(updatedAgencies), persistCoordinates(updatedCoordinates)]);
}