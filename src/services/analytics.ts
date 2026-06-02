import type { ItineraryRequest } from "../types/itinerary";
import { getCurrentSession, getSupabaseClient } from "./supabase";

type SearchEventType = "city_selected" | "itinerary_generated" | "itinerary_saved";

export async function trackSearchEvent(params: {
  eventType: SearchEventType;
  cityId?: string;
  cityName?: string;
  language?: string;
  regionCode?: string;
  days?: ItineraryRequest["days"];
  tempo?: ItineraryRequest["tempo"];
  diet?: ItineraryRequest["diet"];
  interests?: string[];
  metadata?: Record<string, string | number | boolean | null>;
}): Promise<void> {
  const supabase = getSupabaseClient();
  const session = await getCurrentSession().catch(() => null);

  const { error } = await supabase.from("search_events").insert({
    user_id: session?.user.id ?? null,
    event_type: params.eventType,
    city_id: params.cityId ?? null,
    city_name: params.cityName ?? null,
    language: params.language ?? null,
    region_code: params.regionCode ?? null,
    days: params.days ?? null,
    tempo: params.tempo ?? null,
    diet: params.diet ?? null,
    interests: params.interests ?? [],
    metadata: params.metadata ?? {},
  });

  if (error) {
    console.log("[search-event]", error.message);
  }
}
