export type Coordinate = { lat: number; lon: number };

export type GeocodedStop = {
  address: string;
  displayName: string;
  coordinate: Coordinate;
};

export type TripLeg = {
  from: string;
  to: string;
  distanceMeters: number;
  durationSeconds: number;
  geometry: Coordinate[];
};

export type TripPlan = {
  stops: GeocodedStop[];
  legs: TripLeg[];
  totals: {
    distanceMeters: number;
    durationSeconds: number;
  };
  routeGeometry: Coordinate[];
};

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type NominatimResult = {
  display_name?: string;
  lat?: string;
  lon?: string;
};

type OrsDirectionsGeoJsonResponse = {
  features?: Array<{
    properties?: {
      summary?: {
        distance?: number;
        duration?: number;
      };
    };
    geometry?: {
      coordinates?: [number, number][];
    };
  }>;
  error?: { message?: string };
};

const OPENROUTESERVICE_API_KEY = process.env.OPENROUTESERVICE_API_KEY;

function getOrsKey(): string {
  if (!OPENROUTESERVICE_API_KEY) {
    throw new HttpError(
      500,
      "Server is missing OPENROUTESERVICE_API_KEY. Add it in your environment variables.",
    );
  }

  return OPENROUTESERVICE_API_KEY;
}

function toHttpError(error: unknown, fallbackMessage: string): HttpError {
  if (error instanceof HttpError) {
    return error;
  }

  return new HttpError(500, fallbackMessage);
}

async function tryGeocodeQuery(query: string): Promise<GeocodedStop | null> {
  if (!query.trim()) {
    return null;
  }

  const params = new URLSearchParams({
    format: "jsonv2",
    addressdetails: "0",
    limit: "1",
    q: query.trim(),
  });

  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: {
        Accept: "application/json",
        // Nominatim's usage policy requires a descriptive User-Agent identifying the app.
        "User-Agent": "road-trip-planner/1.0 (personal project)",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      // Don't spam logs for expected 404-like situations from fallbacks
      if (response.status !== 404) {
        console.error(
          `[geocodeAddress] Nominatim geocode failed for "${query.trim()}" — status ${response.status}:`,
          bodyText,
        );
      }
      return null;
    }

    const data = (await response.json()) as NominatimResult[];
    const match = data[0];
    const lat = match?.lat !== undefined ? Number(match.lat) : NaN;
    const lon = match?.lon !== undefined ? Number(match.lon) : NaN;

    if (!match || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      return null;
    }

    return {
      address: query.trim(),
      displayName: match.display_name ?? query.trim(),
      coordinate: { lat, lon },
    };
  } catch (error) {
    // Only log unexpected errors
    if (!(error instanceof TypeError && error.message.includes('Failed to fetch'))) {
      console.error(`[geocodeAddress] Error geocoding "${query.trim()}":`, error);
    }
    return null;
  }
}

export async function geocodeAddress(address: string): Promise<GeocodedStop> {
  const trimmed = address.trim();
  if (!trimmed) {
    throw new HttpError(400, "Address cannot be empty.");
  }

  // Try the original address first
  let result = await tryGeocodeQuery(trimmed);
  if (result) {
    return result;
  }

  // For agency addresses, try extracting the core location information
  const queryParts = trimmed.split(',').map(part => part.trim()).filter(part => part.length > 0);

  // Strategy 1: Look for French postal code pattern (5 digits) and use it with following context
  for (let i = 0; i < queryParts.length; i++) {
    if (/^\d{5}$/.test(queryParts[i])) { // French postal code like 51100
      // Try postal code + next part (likely city)
      if (i + 1 < queryParts.length) {
        const postalCity = [queryParts[i], queryParts[i + 1]].join(', ');
        result = await tryGeocodeQuery(postalCity);
        if (result) return result;

        // Try postal code + next two parts (city + department/region)
        if (i + 2 < queryParts.length) {
          const postalCityDept = [queryParts[i], queryParts[i + 1], queryParts[i + 2]].join(', ');
          result = await tryGeocodeQuery(postalCityDept);
          if (result) return result;
        }
      }
      // Try just the postal code
      result = await tryGeocodeQuery(queryParts[i]);
      if (result) return result;
      break; // Assume first postal code found is the relevant one
    }
  }

  // Strategy 2: Try to find street number and name pattern
  // Look for a part that starts with digits followed by street name indicators
  for (let i = 0; i < queryParts.length; i++) {
    const part = queryParts[i];
    if (/^\d+\s+(rue|avenue|boulevard|place|allée|impasse|quai|rocade)\s+/i.test(part)) {
      // Found a street address, try it with context
      const streetPart = part;

      // Try just the street
      result = await tryGeocodeQuery(streetPart);
      if (result) return result;

      // Try street + next part (likely city)
      if (i + 1 < queryParts.length) {
        const streetCity = [streetPart, queryParts[i + 1]].join(', ');
        result = await tryGeocodeQuery(streetCity);
        if (result) return result;
      }

      // Try street + next two parts
      if (i + 2 < queryParts.length) {
        const streetCityDept = [streetPart, queryParts[i + 1], queryParts[i + 2]].join(', ');
        result = await tryGeocodeQuery(streetCityDept);
        if (result) return result;
      }
      break;
    }
  }

  // Strategy 3: Try without the first element (often a business name)
  if (queryParts.length > 2) { // Need at least 2 parts left after removing first
    const withoutBusiness = queryParts.slice(1).join(', ');
    result = await tryGeocodeQuery(withoutBusiness);
    if (result) return result;
  }

  // Strategy 4: Try the last 2-3 elements (most specific geographic parts)
  const geographicParts = queryParts.slice(Math.max(0, queryParts.length - 3));
  if (geographicParts.length >= 2) {
    const geoQuery = geographicParts.join(', ');
    result = await tryGeocodeQuery(geoQuery);
    if (result) return result;
  }

  // Strategy 5: Try just the last element (often city)
  if (queryParts.length > 0) {
    result = await tryGeocodeQuery(queryParts[queryParts.length - 1]);
    if (result) return result;
  }

  // If all strategies fail, throw the original error
  throw new HttpError(400, `Could not geocode "${trimmed}". Try a more precise address.`);
}

export async function reverseGeocode(lat: number, lon: number): Promise<GeocodedStop> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new HttpError(400, "Coordinates must be finite numbers.");
  }

  const params = new URLSearchParams({
    format: "jsonv2",
    lat: String(lat),
    lon: String(lon),
    zoom: "18",
    addressdetails: "0",
  });

  const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`, {
    headers: {
      Accept: "application/json",
      // Nominatim's usage policy requires a descriptive User-Agent identifying the app.
      "User-Agent": "road-trip-planner/1.0 (personal project)",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    console.error(
      `[reverseGeocode] Nominatim reverse geocode failed for (${lat}, ${lon}) — status ${response.status}:`,
      bodyText,
    );
    throw new HttpError(
      502,
      `Reverse geocoding failed for (${lat}, ${lon}) (status ${response.status}): ${
        bodyText.slice(0, 300) || "no response body from Nominatim"
      }`,
    );
  }

  const match = (await response.json()) as NominatimResult;

  if (!match?.display_name) {
    throw new HttpError(400, `Could not reverse geocode (${lat}, ${lon}).`);
  }

  return {
    address: match.display_name,
    displayName: match.display_name,
    coordinate: { lat, lon },
  };
}

async function getLegRoute(start: Coordinate, end: Coordinate): Promise<{
  distanceMeters: number;
  durationSeconds: number;
  geometry: Coordinate[];
}> {
  const key = getOrsKey();

  const response = await fetch("https://api.openrouteservice.org/v2/directions/driving-car/geojson", {
    method: "POST",
    headers: {
      Authorization: key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      coordinates: [
        [start.lon, start.lat],
        [end.lon, end.lat],
      ],
    }),
    cache: "no-store",
  });

  const data = (await response.json()) as OrsDirectionsGeoJsonResponse;

  if (!response.ok) {
    console.error(
      `[getLegRoute] ORS directions failed — status ${response.status}:`,
      JSON.stringify(data),
    );
    throw new HttpError(
      502,
      data.error?.message
        ? `Routing failed (status ${response.status}): ${data.error.message}`
        : `Routing failed (status ${response.status}): ${JSON.stringify(data).slice(0, 300)}`,
    );
  }

  const feature = data.features?.[0];
  const distanceMeters = feature?.properties?.summary?.distance;
  const durationSeconds = feature?.properties?.summary?.duration;
  const geometryCoordinates = feature?.geometry?.coordinates;
  const geometry =
    geometryCoordinates && geometryCoordinates.length > 1
      ? geometryCoordinates.map((coordinate) => ({
          lon: coordinate[0],
          lat: coordinate[1],
        }))
      : [start, end];

  if (typeof distanceMeters !== "number" || typeof durationSeconds !== "number") {
    throw new HttpError(502, "Routing response was incomplete for one leg.");
  }

  return {
    distanceMeters,
    durationSeconds,
    geometry,
  };
}

export async function buildTripPlan(stops: string[]): Promise<TripPlan> {
  if (!Array.isArray(stops) || stops.length < 2) {
    throw new HttpError(400, "Provide at least an origin and a destination.");
  }

  const normalizedStops = stops.map((stop) => (typeof stop === "string" ? stop.trim() : ""));

  if (normalizedStops.some((stop) => !stop)) {
    throw new HttpError(400, "All waypoint addresses must be filled in.");
  }

  // Nominatim's usage policy asks for at most ~1 request/second, so stops are
  // geocoded one at a time with a short pause between them rather than all
  // at once.
  const geocodedStops: GeocodedStop[] = [];
  for (let index = 0; index < normalizedStops.length; index += 1) {
    geocodedStops.push(await geocodeAddress(normalizedStops[index]));
    if (index < normalizedStops.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1100));
    }
  }

  const legPromises = geocodedStops.slice(0, -1).map(async (fromStop, index) => {
    const toStop = geocodedStops[index + 1];
    const legRoute = await getLegRoute(fromStop.coordinate, toStop.coordinate);

    return {
      from: fromStop.displayName,
      to: toStop.displayName,
      distanceMeters: legRoute.distanceMeters,
      durationSeconds: legRoute.durationSeconds,
      geometry: legRoute.geometry,
    } satisfies TripLeg;
  });

  const legs = await Promise.all(legPromises);

  const totals = legs.reduce(
    (accumulator, leg) => {
      accumulator.distanceMeters += leg.distanceMeters;
      accumulator.durationSeconds += leg.durationSeconds;
      return accumulator;
    },
    { distanceMeters: 0, durationSeconds: 0 },
  );
  const routeGeometry = legs.flatMap((leg, index) =>
    index === 0 ? leg.geometry : leg.geometry.slice(1),
  );

  return {
    stops: geocodedStops,
    legs,
    totals,
    routeGeometry,
  };
}

export function safeErrorMessage(error: unknown, fallbackMessage: string): string {
  return toHttpError(error, fallbackMessage).message;
}

export function safeErrorStatus(error: unknown): number {
  return toHttpError(error, "Unexpected server error.").status;
}