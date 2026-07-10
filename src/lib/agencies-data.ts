import agenciesSource from "@/data/agencies-source.json";
import agencyCoordinates from "@/data/agency-coordinates.json";

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

// Auto-generated from suivi_ecrans.xlsx — one entry per agency ("Groupe"),
// with its address and the de-duplicated list of screens installed there.
// Regenerate data/agencies-source.json by re-running the extraction against
// a refreshed export.
export const AGENCIES: AgencyRecord[] = agenciesSource as AgencyRecord[];

type CoordinateMap = Record<string, { lat: number; lon: number }>;

// Populated by `node scripts/geocode-agencies.mjs` (run locally/in CI, not
// at request time — see that script for why). Agencies not yet in the map
// are simply left off the returned list rather than breaking anything.
export function getGeocodedAgencies(): GeocodedAgency[] {
  const coordinates = agencyCoordinates as CoordinateMap;

  return AGENCIES.flatMap((agency) => {
    const coordinate = coordinates[agency.id];
    return coordinate ? [{ ...agency, ...coordinate }] : [];
  });
}