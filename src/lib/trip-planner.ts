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
  days: number;
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

export async function geocodeAddress(address: string): Promise<GeocodedStop> {
  const trimmed = address.trim();
  if (!trimmed) {
    throw new HttpError(400, "Address cannot be empty.");
  }

  const params = new URLSearchParams({
    format: "jsonv2",
    addressdetails: "0",
    limit: "1",
    q: trimmed,
  });

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
    console.error(
      `[geocodeAddress] Nominatim geocode failed for "${trimmed}" — status ${response.status}:`,
      bodyText,
    );
    throw new HttpError(
      502,
      `Geocoding failed for "${trimmed}" (status ${response.status}): ${
        bodyText.slice(0, 300) || "no response body from Nominatim"
      }`,
    );
  }

  const data = (await response.json()) as NominatimResult[];
  const match = data[0];
  const lat = match?.lat !== undefined ? Number(match.lat) : NaN;
  const lon = match?.lon !== undefined ? Number(match.lon) : NaN;

  if (!match || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new HttpError(400, `Could not geocode "${trimmed}". Try a more precise address.`);
  }

  return {
    address: trimmed,
    displayName: match.display_name ?? trimmed,
    coordinate: { lat, lon },
  };
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

export async function buildTripPlan(stops: string[], days: number): Promise<TripPlan> {
  if (!Array.isArray(stops) || stops.length < 2) {
    throw new HttpError(400, "Provide at least an origin and a destination.");
  }

  if (!Number.isInteger(days) || days < 1) {
    throw new HttpError(400, "Trip days must be an integer greater than 0.");
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
    days,
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