import { invokePublicEdgeFunction } from "./edgeFetch";

export type CitySuggestion = {
  placeId: string;
  description: string;
};

export type ResolveCityResult = {
  placeId: string;
  description: string;
  lat: number;
  lng: number;
  destinationTimeZoneId: string | null;
};

type CitySuggestionPayload = {
  placeId?: unknown;
  description?: unknown;
};

export async function autocompleteCities(params: {
  input: string;
  language: string;
  regionCode: string;
}): Promise<CitySuggestion[]> {
  const data = await invokePublicEdgeFunction<{ suggestions?: unknown[] }>("city-autocomplete", params);
  const suggestions = data?.suggestions;
  if (!Array.isArray(suggestions)) return [];
  return suggestions
    .filter(
      (x): x is CitySuggestionPayload =>
        Boolean(x) &&
        typeof x === "object" &&
        typeof (x as CitySuggestionPayload).placeId === "string" &&
        typeof (x as CitySuggestionPayload).description === "string",
    )
    .map((x) => ({ placeId: x.placeId as string, description: x.description as string }));
}

export async function resolveCity(params: {
  placeId: string;
  description?: string;
  language: string;
  regionCode: string;
}): Promise<ResolveCityResult> {
  const data = await invokePublicEdgeFunction<Record<string, unknown>>("city-resolve", params);
  const placeId = (data as any)?.placeId;
  const description = (data as any)?.description;
  const lat = (data as any)?.lat;
  const lng = (data as any)?.lng;
  const destinationTimeZoneId = (data as any)?.destinationTimeZoneId ?? null;
  if (
    typeof placeId !== "string" ||
    typeof description !== "string" ||
    typeof lat !== "number" ||
    typeof lng !== "number"
  ) {
    throw new Error("City resolve beklenmeyen veri döndürdü.");
  }
  return { placeId, description, lat, lng, destinationTimeZoneId: typeof destinationTimeZoneId === "string" ? destinationTimeZoneId : null };
}

