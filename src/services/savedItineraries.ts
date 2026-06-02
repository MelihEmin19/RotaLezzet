import type { SavedItinerary } from "../types/auth";
import type { ItineraryItem, ItineraryRequest } from "../types/itinerary";
import { makeEditKey } from "./userEdits";
import { getSupabaseClient } from "./supabase";

type SavedItineraryRow = {
  id: string;
  request_key: string;
  title: string | null;
  city_id: string;
  city_name: string;
  language: string;
  region_code: string;
  days: string;
  tempo: string;
  diet: string | null;
  interests: string[] | null;
  itinerary_request: unknown;
  itinerary_items: unknown;
  created_at: string;
  updated_at: string;
};

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return "[]";
  }
}

function mapSavedItinerary(row: SavedItineraryRow): SavedItinerary {
  return {
    id: row.id,
    requestKey: row.request_key,
    title: row.title,
    cityId: row.city_id,
    cityName: row.city_name,
    language: row.language,
    regionCode: row.region_code,
    days: row.days,
    tempo: row.tempo,
    diet: row.diet,
    interests: Array.isArray(row.interests) ? row.interests : [],
    itineraryRequestJson: safeStringify(row.itinerary_request),
    itineraryItemsJson: safeStringify(row.itinerary_items),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getRequiredUserId() {
  const supabase = getSupabaseClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error) throw error;
  if (!user) return null;
  return user.id;
}

export async function listMySavedItineraries(limit = 10): Promise<SavedItinerary[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("saved_itineraries")
    .select(
      "id,request_key,title,city_id,city_name,language,region_code,days,tempo,diet,interests,itinerary_request,itinerary_items,created_at,updated_at",
    )
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []).map((row) => mapSavedItinerary(row as SavedItineraryRow));
}

export async function upsertSavedItinerary(
  request: ItineraryRequest,
  items: ItineraryItem[],
): Promise<SavedItinerary | null> {
  const supabase = getSupabaseClient();
  const userId = await getRequiredUserId();
  if (!userId) return null;

  const { data, error } = await supabase
    .from("saved_itineraries")
    .upsert(
      {
        user_id: userId,
        request_key: makeEditKey(request),
        title: `${request.cityName} · ${request.days}`,
        city_id: request.cityId,
        city_name: request.cityName,
        language: request.language,
        region_code: request.regionCode,
        days: request.days,
        tempo: request.tempo,
        diet: request.diet ?? null,
        interests: request.interests,
        itinerary_request: request,
        itinerary_items: items,
      },
      { onConflict: "user_id,request_key" },
    )
    .select(
      "id,request_key,title,city_id,city_name,language,region_code,days,tempo,diet,interests,itinerary_request,itinerary_items,created_at,updated_at",
    )
    .single();

  if (error) throw error;
  return mapSavedItinerary(data as SavedItineraryRow);
}

export async function deleteSavedItinerary(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("saved_itineraries").delete().eq("id", id);
  if (error) throw error;
}
