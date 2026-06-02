/// <reference lib="deno.ns" />

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  enforceRateLimit,
  ensureBrowserOriginAllowed,
  handleOptions,
  internalError,
  jsonResponse,
} from "../_shared/security.ts";

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

    const rateLimited = enforceRateLimit(req, "city-autocomplete-post", 90, 60_000);
    if (rateLimited) return rateLimited;

    const body = (await req.json().catch(() => ({}))) as {
      input?: string;
      language?: string;
      regionCode?: string;
    };

    const input = typeof body.input === "string" ? body.input.trim() : "";
    const languageCode = canonicalLanguageCode(body.language);
    const regionCode = canonicalRegionCode(body.regionCode);

    if (!input || input.length < 2) {
      return jsonResponse(req, { suggestions: [] });
    }

    const key = requireSecret("GOOGLE_PLACES_API_KEY");
    const url = "https://places.googleapis.com/v1/places:autocomplete";
    const fieldMask = [
      "suggestions.placePrediction.placeId",
      "suggestions.placePrediction.text.text",
      "suggestions.placePrediction.structuredFormat.mainText.text",
      "suggestions.placePrediction.structuredFormat.secondaryText.text",
      "suggestions.placePrediction.types",
    ].join(",");

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": fieldMask,
      },
      body: JSON.stringify({
        input,
        languageCode,
        regionCode,
        includedPrimaryTypes: ["(cities)"],
        includeQueryPredictions: false,
      }),
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

    const json = JSON.parse(text) as PlacesV1AutocompleteResponse;
    const suggestions = (json.suggestions ?? [])
      .map((s) => s.placePrediction)
      .filter((p): p is NonNullable<typeof p> => Boolean(p?.placeId))
      .slice(0, 10)
      .map((p) => ({
        placeId: p.placeId as string,
        description: buildDescription(p),
      }))
      .filter((x) => x.description.length > 0);

    return jsonResponse(req, { suggestions });
  } catch (e) {
    return internalError(req, "city-autocomplete", e);
  }
});

