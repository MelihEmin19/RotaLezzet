import { invokePublicEdgeFunction } from "./edgeFetch";

export type PlaceSuggestion = {
  placeId: string;
  description: string;
  category: "food" | "place";
  subtype?: "nature" | "history" | "shopping";
  types: string[];
};

export type ResolvedPlace = {
  placeId: string;
  name: string;
  formattedAddress: string;
  lat: number;
  lng: number;
  rating?: number;
  category: "food" | "place";
  subtype?: "nature" | "history" | "shopping";
  photoUrl?: string;
  priceLevel?: number;
};

export async function autocompletePlaces(params: {
  input: string;
  language: string;
  regionCode: string;
  cityLat?: number;
  cityLng?: number;
}): Promise<PlaceSuggestion[]> {
  const data = await invokePublicEdgeFunction<{ suggestions?: unknown[] }>("place-autocomplete", {
    mode: "autocomplete",
    ...params,
  });
  const suggestions = (data as any)?.suggestions;
  if (!Array.isArray(suggestions)) return [];
  return suggestions
    .filter(
      (x) =>
        x &&
        typeof x.placeId === "string" &&
        typeof x.description === "string" &&
        (x.category === "food" || x.category === "place"),
    )
    .map((x) => ({
      placeId: x.placeId as string,
      description: x.description as string,
      category: x.category as "food" | "place",
      subtype: x.subtype,
      types: Array.isArray(x.types) ? x.types : [],
    }));
}

export async function resolvePlace(params: {
  placeId: string;
  language: string;
  regionCode: string;
}): Promise<ResolvedPlace> {
  const data = await invokePublicEdgeFunction<Record<string, unknown>>("place-autocomplete", {
    mode: "details",
    ...params,
  });
  const d = data as any;
  if (
    typeof d?.placeId !== "string" ||
    typeof d?.lat !== "number" ||
    typeof d?.lng !== "number" ||
    (d?.category !== "food" && d?.category !== "place")
  ) {
    throw new Error("Place details beklenmeyen veri döndürdü.");
  }
  return {
    placeId: d.placeId,
    name: typeof d.name === "string" ? d.name : "",
    formattedAddress: typeof d.formattedAddress === "string" ? d.formattedAddress : "",
    lat: d.lat,
    lng: d.lng,
    rating: typeof d.rating === "number" ? d.rating : undefined,
    category: d.category,
    subtype: d.subtype,
    photoUrl: typeof d.photoUrl === "string" ? d.photoUrl : undefined,
    priceLevel: typeof d.priceLevel === "number" ? d.priceLevel : undefined,
  };
}
