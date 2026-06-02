/// <reference lib="deno.ns" />

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  enforceRateLimit,
  ensureBrowserOriginAllowed,
  handleOptions,
  internalError,
  jsonResponse,
} from "../_shared/security.ts";

type PlacesV1PlaceDetails = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
};

type TimeZoneApiResponse = {
  status?: string;
  timeZoneId?: string;
  errorMessage?: string;
};

function requireSecret(key: string) {
  const v = Deno.env.get(key);
  if (!v || !v.trim()) throw new Error(`Eksik secret: ${key}`);
  return v.trim();
}

function canonicalLanguageCode(input: unknown) {
  if (typeof input !== "string") return "tr";
  const v = input.trim();
  if (!v) return "tr";
  const base = v.split("-")[0]?.trim().toLocaleLowerCase("en-US");
  return base && /^[a-z]{2,3}$/i.test(base) ? base : "tr";
}

function canonicalRegionCode(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const v = input.trim().toLocaleUpperCase("en-US");
  if (!v) return undefined;
  return /^[A-Z]{2}$/.test(v) ? v : undefined;
}

async function placesDetailsV1(placeId: string, languageCode: string): Promise<PlacesV1PlaceDetails> {
  const key = requireSecret("GOOGLE_PLACES_API_KEY");
  const url = `https://places.googleapis.com/v1/places/${placeId}`;
  const fieldMask = ["id", "displayName", "formattedAddress", "location"].join(",");

  const res = await fetch(url, {
    headers: {
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": fieldMask,
      "X-Goog-LanguageCode": languageCode,
    },
  });

  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      const j = JSON.parse(text);
      msg = (j?.error?.message as string) ?? text;
    } catch {
      // ignore
    }
    throw new Error(`Google Places hatası: ${msg}`);
  }

  return JSON.parse(text) as PlacesV1PlaceDetails;
}

async function resolveTimeZoneId(lat: number, lng: number, languageCode: string): Promise<string | null> {
  // Time Zone API (Google Maps Platform)
  const key = requireSecret("GOOGLE_PLACES_API_KEY");
  const ts = Math.floor(Date.now() / 1000);
  const url = new URL("https://maps.googleapis.com/maps/api/timezone/json");
  url.searchParams.set("location", `${lat},${lng}`);
  url.searchParams.set("timestamp", String(ts));
  url.searchParams.set("language", languageCode);
  url.searchParams.set("key", key);

  const res = await fetch(url.toString());
  const json = (await res.json().catch(() => null)) as TimeZoneApiResponse | null;
  if (!res.ok || !json) return null;
  if (json.status !== "OK" || !json.timeZoneId) return null;
  return json.timeZoneId;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return handleOptions(req);
  }

  try {
    const blockedOrigin = ensureBrowserOriginAllowed(req);
    if (blockedOrigin) return blockedOrigin;

    if (req.method !== "POST") {
      return jsonResponse(req, { error: "Method not allowed" }, 405);
    }

    const rateLimited = enforceRateLimit(req, "city-resolve-post", 45, 60_000);
    if (rateLimited) return rateLimited;

    const body = (await req.json().catch(() => ({}))) as {
      placeId?: string;
      description?: string;
      language?: string;
      regionCode?: string;
    };

    const placeId = typeof body.placeId === "string" ? body.placeId.trim() : "";
    const languageCode = canonicalLanguageCode(body.language);
    const regionCode = canonicalRegionCode(body.regionCode);

    if (!placeId) {
      return jsonResponse(req, { error: "placeId zorunlu" }, 400);
    }

    const details = await placesDetailsV1(placeId, languageCode);
    const lat = details.location?.latitude;
    const lng = details.location?.longitude;
    if (typeof lat !== "number" || typeof lng !== "number") {
      return jsonResponse(req, { error: "Şehir koordinatları alınamadı" }, 500);
    }

    const name = details.displayName?.text?.trim() ?? "";
    const formattedAddress = details.formattedAddress?.trim() ?? "";
    const fallbackDescription = formattedAddress ? `${name} (${formattedAddress})` : name;
    const description = (typeof body.description === "string" && body.description.trim()) ? body.description.trim() : fallbackDescription;

    const timeZoneId = await resolveTimeZoneId(lat, lng, languageCode);

    return jsonResponse(req, {
      placeId,
      description,
      regionCode,
      language: languageCode,
      lat,
      lng,
      destinationTimeZoneId: timeZoneId ?? null,
    });
  } catch (e) {
    return internalError(req, "city-resolve", e);
  }
});

