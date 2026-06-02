import type { FavoritePlace } from "../types/auth";
import type { ItineraryItem } from "../types/itinerary";
import { getSupabaseClient } from "./supabase";

type FavoriteRow = {
  id: string;
  place_id: string;
  title: string;
  category: "food" | "place";
  subtype: "nature" | "history" | "shopping" | null;
  city_id: string | null;
  city_name: string | null;
  lat: number;
  lng: number;
  rating: number | null;
  photo_url: string | null;
  created_at: string;
};

function mapFavorite(row: FavoriteRow): FavoritePlace {
  return {
    id: row.id,
    placeId: row.place_id,
    title: row.title,
    category: row.category,
    subtype: row.subtype ?? undefined,
    cityId: row.city_id,
    cityName: row.city_name,
    lat: row.lat,
    lng: row.lng,
    rating: typeof row.rating === "number" ? row.rating : undefined,
    photoUrl: row.photo_url ?? undefined,
    createdAt: row.created_at,
  };
}

async function getRequiredUserId() {
  const supabase = getSupabaseClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error) throw error;
  if (!user) throw new Error("Favori işlemi için giriş yapmalısın.");
  return user.id;
}

export async function listMyFavorites(limit = 10): Promise<FavoritePlace[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("favorites")
    .select("id,place_id,title,category,subtype,city_id,city_name,lat,lng,rating,photo_url,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []).map((row) => mapFavorite(row as FavoriteRow));
}

export async function isPlaceFavorited(placeId: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  const userId = await getRequiredUserId();
  const { data, error } = await supabase
    .from("favorites")
    .select("id")
    .eq("user_id", userId)
    .eq("place_id", placeId)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

export async function toggleFavoritePlace(params: {
  item: ItineraryItem;
  cityId: string;
  cityName: string;
}): Promise<boolean> {
  const supabase = getSupabaseClient();
  const userId = await getRequiredUserId();
  const { data: existing, error: existingError } = await supabase
    .from("favorites")
    .select("id")
    .eq("user_id", userId)
    .eq("place_id", params.item.placeId)
    .maybeSingle();

  if (existingError) throw existingError;

  if (existing?.id) {
    const { error } = await supabase.from("favorites").delete().eq("id", existing.id);
    if (error) throw error;
    return false;
  }

  const { error } = await supabase.from("favorites").insert({
    user_id: userId,
    place_id: params.item.placeId,
    title: params.item.title,
    category: params.item.category,
    subtype: params.item.subtype ?? null,
    city_id: params.cityId,
    city_name: params.cityName,
    lat: params.item.lat,
    lng: params.item.lng,
    rating: params.item.rating ?? null,
    photo_url: params.item.photoUrl ?? null,
  });

  if (error) throw error;
  return true;
}
