/// <reference lib="deno.ns" />

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  buildSignedPhotoUrl,
  enforceRateLimit,
  ensureBrowserOriginAllowed,
  getCorsHeaders,
  handleOptions,
  internalError,
  jsonResponse,
  sanitizePhotoWidth,
  verifySignedPhotoRequest,
} from "../_shared/security.ts";

// POI (restoran/müze/AVM/park) için autocomplete + opsiyonel place details.
// Kullanıcı gün planına yer eklerken kullanılır.

type PlacesV1AutocompleteResponse = {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string;
      text?: { text?: string };
      structuredFormat?: {
        mainText?: { text?: string };
        secondaryText?: { text?: string };
      };
      types?: string[];
    };
  }>;
};

type PlacesV1PlaceDetails = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  rating?: number;
  primaryType?: string;
  types?: string[];
  photos?: Array<{ name?: string }>;
  priceLevel?: string;
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

function buildDescription(p: NonNullable<PlacesV1AutocompleteResponse["suggestions"]>[number]["placePrediction"]) {
  const main = p?.structuredFormat?.mainText?.text?.trim();
  const secondary = p?.structuredFormat?.secondaryText?.text?.trim();
  if (main && secondary) return `${main}, ${secondary}`;
  return (p?.text?.text ?? main ?? secondary ?? "").trim();
}

function classifyCategory(types: readonly string[] | undefined): { category: "food" | "place"; subtype?: "nature" | "history" | "shopping" } {
  if (!types || !types.length) return { category: "place" };
  const set = new Set(types);
  // Yemek
  const foodTypes = [
    "restaurant", "cafe", "bakery", "bar", "meal_takeaway", "meal_delivery",
    "food",
  ];
  if (foodTypes.some((t) => set.has(t))) return { category: "food" };

  // Alışveriş
  const shoppingTypes = ["shopping_mall", "department_store", "supermarket", "store", "clothing_store", "shoe_store", "book_store", "jewelry_store"];
  if (shoppingTypes.some((t) => set.has(t))) return { category: "place", subtype: "shopping" };

  // Doğa
  const natureTypes = ["park", "natural_feature", "campground", "zoo", "aquarium", "beach"];
  if (natureTypes.some((t) => set.has(t))) return { category: "place", subtype: "nature" };

  // Tarih
  const historyTypes = ["museum", "tourist_attraction", "art_gallery", "church", "mosque", "hindu_temple", "synagogue", "place_of_worship", "historical_landmark", "monument"];
  if (historyTypes.some((t) => set.has(t))) return { category: "place", subtype: "history" };

  return { category: "place" };
}

async function placeAutocomplete(input: string, languageCode: string, regionCode: string | undefined, bias?: { lat: number; lng: number; radiusMeters?: number }) {
  const key = requireSecret("GOOGLE_PLACES_API_KEY");
  const url = "https://places.googleapis.com/v1/places:autocomplete";
  const fieldMask = [
    "suggestions.placePrediction.placeId",
    "suggestions.placePrediction.text.text",
    "suggestions.placePrediction.structuredFormat.mainText.text",
    "suggestions.placePrediction.structuredFormat.secondaryText.text",
    "suggestions.placePrediction.types",
  ].join(",");

  const body: Record<string, unknown> = {
    input,
    languageCode,
    regionCode,
    includeQueryPredictions: false,
  };

  // Şehir merkezine yakın sonuçlara öncelik (kullanıcı seçili şehirde gezecek).
  if (bias && typeof bias.lat === "number" && typeof bias.lng === "number") {
    body.locationBias = {
      circle: {
        center: { latitude: bias.lat, longitude: bias.lng },
        radius: Math.min(Math.max(bias.radiusMeters ?? 30000, 1000), 50000),
      },
    };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": fieldMask,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      const j = JSON.parse(text);
      msg = (j?.error?.message as string) ?? text;
    } catch { /* ignore */ }
    throw new Error(`Google Places hatası: ${msg}`);
  }

  const json = JSON.parse(text) as PlacesV1AutocompleteResponse;
  return (json.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => Boolean(p?.placeId))
    .slice(0, 8)
    .map((p) => {
      const cls = classifyCategory(p.types);
      return {
        placeId: p.placeId as string,
        description: buildDescription(p),
        types: p.types ?? [],
        category: cls.category,
        subtype: cls.subtype,
      };
    })
    .filter((x) => x.description.length > 0);
}

async function placeDetails(placeId: string, languageCode: string): Promise<PlacesV1PlaceDetails> {
  const key = requireSecret("GOOGLE_PLACES_API_KEY");
  const url = `https://places.googleapis.com/v1/places/${placeId}`;
  const fieldMask = [
    "id",
    "displayName",
    "formattedAddress",
    "location",
    "rating",
    "primaryType",
    "types",
    "photos.name",
    "priceLevel",
  ].join(",");

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
    } catch { /* ignore */ }
    throw new Error(`Google Places hatası: ${msg}`);
  }

  return JSON.parse(text) as PlacesV1PlaceDetails;
}

async function proxyPlacePhotoV1(photoName: string, maxwidth: string, req: Request) {
  const key = requireSecret("GOOGLE_PLACES_API_KEY");
  const safeWidth = sanitizePhotoWidth(maxwidth, "600");
  const url = new URL(`https://places.googleapis.com/v1/${photoName}/media`);
  url.searchParams.set("maxWidthPx", safeWidth);

  const res = await fetch(url.toString(), {
    redirect: "follow",
    headers: {
      "X-Goog-Api-Key": key,
    },
  });

  return new Response(res.body, {
    status: res.status,
    headers: {
      ...getCorsHeaders(req),
      "Cache-Control": "public, max-age=300",
      "Content-Type": res.headers.get("content-type") ?? "image/jpeg",
    },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return handleOptions(req);
  }

  try {
    const blockedOrigin = ensureBrowserOriginAllowed(req);
    if (blockedOrigin) return blockedOrigin;

    if (req.method === "GET") {
      const rateLimited = enforceRateLimit(req, "place-autocomplete-photo", 120, 60_000);
      if (rateLimited) return rateLimited;

      const verified = await verifySignedPhotoRequest(new URL(req.url));
      if (!verified.ok) {
        return jsonResponse(req, { error: verified.error }, verified.status);
      }

      return await proxyPlacePhotoV1(String(verified.photoName), verified.maxwidth, req);
    }

    if (req.method !== "POST") {
      return jsonResponse(req, { error: "Method not allowed" }, 405);
    }

    const rateLimited = enforceRateLimit(req, "place-autocomplete-post", 90, 60_000);
    if (rateLimited) return rateLimited;

    const body = (await req.json().catch(() => ({}))) as {
      mode?: "autocomplete" | "details";
      input?: string;
      placeId?: string;
      language?: string;
      regionCode?: string;
      cityLat?: number;
      cityLng?: number;
    };

    const mode = body.mode === "details" ? "details" : "autocomplete";
    const languageCode = canonicalLanguageCode(body.language);
    const regionCode = canonicalRegionCode(body.regionCode);

    if (mode === "autocomplete") {
      const input = typeof body.input === "string" ? body.input.trim() : "";
      if (!input || input.length < 2) {
        return jsonResponse(req, { suggestions: [] });
      }
      const bias = (typeof body.cityLat === "number" && typeof body.cityLng === "number")
        ? { lat: body.cityLat, lng: body.cityLng, radiusMeters: 30000 }
        : undefined;
      const suggestions = await placeAutocomplete(input, languageCode, regionCode, bias);
      return jsonResponse(req, { suggestions });
    }

    // mode === "details"
    const placeId = typeof body.placeId === "string" ? body.placeId.trim() : "";
    if (!placeId) {
      return jsonResponse(req, { error: "placeId zorunlu" }, 400);
    }

    const det = await placeDetails(placeId, languageCode);
    const lat = det.location?.latitude;
    const lng = det.location?.longitude;
    if (typeof lat !== "number" || typeof lng !== "number") {
      return jsonResponse(req, { error: "Yer koordinatları alınamadı" }, 500);
    }

    const allTypes = [det.primaryType, ...(det.types ?? [])].filter(Boolean) as string[];
    const cls = classifyCategory(allTypes);
    const photoName = det.photos?.[0]?.name;
    const photoBaseUrl = `https://${new URL(req.url).host}/functions/v1/photo-proxy`;
    const photoUrl = photoName ? await buildSignedPhotoUrl(photoBaseUrl, photoName, "600") : undefined;

    const priceLevelMap: Record<string, number> = {
      PRICE_LEVEL_FREE: 0,
      PRICE_LEVEL_INEXPENSIVE: 1,
      PRICE_LEVEL_MODERATE: 2,
      PRICE_LEVEL_EXPENSIVE: 3,
      PRICE_LEVEL_VERY_EXPENSIVE: 4,
    };
    const priceLevel =
      typeof det.priceLevel === "string" && det.priceLevel in priceLevelMap
        ? priceLevelMap[det.priceLevel]
        : undefined;

    return jsonResponse(req, {
      placeId,
      name: det.displayName?.text?.trim() ?? "",
      formattedAddress: det.formattedAddress ?? "",
      lat,
      lng,
      rating: typeof det.rating === "number" ? det.rating : undefined,
      category: cls.category,
      subtype: cls.subtype,
      photoUrl,
      priceLevel,
    });
  } catch (e) {
    return internalError(req, "place-autocomplete", e);
  }
});
