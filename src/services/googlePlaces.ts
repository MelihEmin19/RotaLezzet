import type { Place } from "../types/place";

import { i18n } from "../i18n";
import { invokePublicEdgeFunction } from "./edgeFetch";

export type SmartItineraryRequest = {
  cityId: string;
  cityName: string;
  cityPlaceId?: string;
  cityLat?: number;
  cityLng?: number;
  language?: string;
  regionCode?: string;
  destinationTimeZoneId?: string;
  interests: string[];
  tempo: string;
  diet?: string;
  days?: number; // 1, 2, 3 — toplam duraklar günlere göre çarpılır.
};

export async function fetchPlacesForCity(request: SmartItineraryRequest): Promise<{
  restaurants: Place[];
  attractions: Place[];
  orderedStops?: Place[];
  source?: "cache" | "google";
}> {
  let data: Record<string, unknown>;
  try {
    data = await invokePublicEdgeFunction<Record<string, unknown>>("get-smart-itinerary", request);
  } catch (error) {
    const details = error instanceof Error ? error.message : i18n.t("errors.unknown");
    const hint =
      details.includes("Failed to send a request") || details.includes("fetch")
        ? i18n.t("errors.networkHint")
        : "";
    throw new Error(i18n.t("errors.smartRouteFailed", { details, hint }));
  }

  const parsed = data as unknown;
  const restaurants = (parsed as any)?.restaurants;
  const attractions = (parsed as any)?.attractions;
  const orderedStops = (parsed as any)?.orderedStops;
  const source = (parsed as any)?.source;

  const rOk =
    Array.isArray(restaurants) &&
    restaurants.every(
      (x) =>
        x &&
        typeof x.placeId === "string" &&
        typeof x.name === "string" &&
        typeof x.lat === "number" &&
        typeof x.lng === "number",
    );
  const aOk =
    Array.isArray(attractions) &&
    attractions.every(
      (x) =>
        x &&
        typeof x.placeId === "string" &&
        typeof x.name === "string" &&
        typeof x.lat === "number" &&
        typeof x.lng === "number",
    );

  if (!rOk || !aOk) {
    throw new Error(i18n.t("errors.unexpectedSmartRouteData"));
  }

  const oOk =
    !orderedStops ||
    (Array.isArray(orderedStops) &&
      orderedStops.every(
        (x) =>
          x &&
          typeof x.placeId === "string" &&
          typeof x.name === "string" &&
          (x.kind === "restaurant" || x.kind === "attraction") &&
          typeof x.lat === "number" &&
          typeof x.lng === "number",
      ));

  return {
    restaurants: restaurants as Place[],
    attractions: attractions as Place[],
    orderedStops: oOk && Array.isArray(orderedStops) ? (orderedStops as Place[]) : undefined,
    source: source === "cache" || source === "google" ? source : undefined,
  };
}

