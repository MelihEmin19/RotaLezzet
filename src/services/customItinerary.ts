import type { ItineraryItem, ItineraryItemCategory, ItineraryItemSubtype, ItineraryRequest } from "../types/itinerary";
import type { SavedItinerary } from "../types/auth";
import { haversineKm } from "./routeOptimizer";
import { getSupabaseClient } from "./supabase";

export const CITY_RADIUS_KM = 30;

export type CustomItineraryDraft = {
  cityId: string;
  cityName: string;
  language: string;
  regionCode: string;
  cityPlaceId?: string;
  cityLat: number;
  cityLng: number;
  destinationTimeZoneId?: string;
  title?: string;
  items: ItineraryItem[];
};

export function isPlaceWithinCity(
  place: { lat: number; lng: number },
  city: { lat: number; lng: number },
  maxKm: number = CITY_RADIUS_KM,
): boolean {
  return haversineKm(place, city) <= maxKm;
}

// Sehir adi vs adres karsilastirmasi (turkce/global karakterleri normalize ederek).
export function normalizeForCompare(value: string): string {
  return value
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Sehrin "ana parcasini" cikar (ornegin "Manisa, Turkiye" -> "manisa").
export function getCitySearchToken(cityFullName: string): string {
  const head = cityFullName.split(/[,\u2022]/)[0] ?? cityFullName;
  return normalizeForCompare(head);
}

export function placeAddressMatchesCity(
  address: string | undefined,
  cityFullName: string,
): boolean {
  if (!address) return false;
  const token = getCitySearchToken(cityFullName);
  if (!token) return false;
  return normalizeForCompare(address).includes(token);
}

function defaultRequestForCustom(draft: CustomItineraryDraft): ItineraryRequest {
  return {
    cityId: draft.cityId,
    cityName: draft.cityName,
    language: draft.language,
    regionCode: draft.regionCode,
    cityPlaceId: draft.cityPlaceId,
    cityLat: draft.cityLat,
    cityLng: draft.cityLng,
    destinationTimeZoneId: draft.destinationTimeZoneId,
    days: "1",
    interests: ["Tarih"],
    tempo: "Dengeli",
  };
}

export function makeCustomRequestKey(cityId: string, createdAt = Date.now()): string {
  return `custom:${cityId}:${createdAt}`;
}

export function makeCustomItineraryItem(params: {
  placeId: string;
  title: string;
  category: ItineraryItemCategory;
  subtype?: ItineraryItemSubtype;
  lat: number;
  lng: number;
  rating?: number;
  photoUrl?: string;
  priceLevel?: number;
  orderIndex: number;
}): ItineraryItem {
  const start = `${String(9 + Math.min(params.orderIndex, 11)).padStart(2, "0")}:00`;
  const end = `${String(10 + Math.min(params.orderIndex, 11)).padStart(2, "0")}:30`;
  return {
    id: `${params.placeId}-${params.orderIndex}`,
    placeId: params.placeId,
    startTime: start,
    endTime: end,
    title: params.title,
    category: params.category,
    subtype: params.subtype,
    lat: params.lat,
    lng: params.lng,
    rating: params.rating,
    photoUrl: params.photoUrl,
    day: 1,
    source: "user",
  };
}

export async function saveCustomItinerary(draft: CustomItineraryDraft): Promise<SavedItinerary | null> {
  const supabase = getSupabaseClient();
  const { data: userResp, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw userErr;
  const userId = userResp.user?.id;
  if (!userId) return null;

  const request = defaultRequestForCustom(draft);
  const requestKey = makeCustomRequestKey(draft.cityId);
  const title = draft.title?.trim() || `${draft.cityName} · Özel Rota`;

  const { data, error } = await supabase
    .from("saved_itineraries")
    .upsert(
      {
        user_id: userId,
        request_key: requestKey,
        title,
        city_id: request.cityId,
        city_name: request.cityName,
        language: request.language,
        region_code: request.regionCode,
        days: request.days,
        tempo: request.tempo,
        diet: null,
        interests: request.interests,
        itinerary_request: { ...request, source: "custom" },
        itinerary_items: draft.items,
      },
      { onConflict: "user_id,request_key" },
    )
    .select(
      "id,request_key,title,city_id,city_name,language,region_code,days,tempo,diet,interests,itinerary_request,itinerary_items,created_at,updated_at",
    )
    .single();

  if (error) throw error;
  return {
    id: data.id as string,
    requestKey: data.request_key as string,
    title: (data.title as string) ?? null,
    cityId: data.city_id as string,
    cityName: data.city_name as string,
    language: data.language as string,
    regionCode: data.region_code as string,
    days: data.days as string,
    tempo: data.tempo as string,
    diet: (data.diet as string) ?? null,
    interests: Array.isArray(data.interests) ? (data.interests as string[]) : [],
    itineraryRequestJson: JSON.stringify(data.itinerary_request),
    itineraryItemsJson: JSON.stringify(data.itinerary_items),
    createdAt: data.created_at as string,
    updatedAt: data.updated_at as string,
  };
}
