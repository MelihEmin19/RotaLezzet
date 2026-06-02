/// <reference lib="deno.ns" />

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

import {
  enforceRateLimit,
  ensureBrowserOriginAllowed,
  handleOptions,
  internalError,
  jsonResponse,
} from "../_shared/security.ts";

type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: "user" | "admin";
  is_premium: boolean;
  created_at: string;
};

type SearchEventRow = {
  id: string;
  event_type: string;
  city_name: string | null;
  created_at: string;
};

function requireSecret(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Eksik secret: ${name}`);
  return value;
}

function getAdminClient() {
  return createClient(requireSecret("SUPABASE_URL"), requireSecret("SUPABASE_SERVICE_ROLE_KEY"));
}

async function requireAdmin(req: Request) {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { response: jsonResponse(req, { error: "Unauthorized" }, 401) };

  const supabase = getAdminClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user) {
    return { response: jsonResponse(req, { error: "Unauthorized" }, 401) };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || profile?.role !== "admin") {
    return { response: jsonResponse(req, { error: "Forbidden" }, 403) };
  }

  return { response: null, supabase };
}

function buildTopCities(rows: Array<{ city_name: string | null }>) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const cityName = row.city_name?.trim();
    if (!cityName) continue;
    counts.set(cityName, (counts.get(cityName) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([cityName, count]) => ({ cityName, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

async function getExactCount(
  supabase: ReturnType<typeof getAdminClient>,
  table: string,
  filter?: { column: string; value: string | boolean },
) {
  let query = supabase.from(table).select("*", { count: "exact", head: true });
  if (filter) query = query.eq(filter.column, filter.value);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions(req);

  try {
    const blocked = ensureBrowserOriginAllowed(req);
    if (blocked) return blocked;

    if (req.method !== "POST") {
      return jsonResponse(req, { error: "Method not allowed" }, 405);
    }

    const rateLimited = enforceRateLimit(req, "admin-dashboard-post", 30, 60_000);
    if (rateLimited) return rateLimited;

    const auth = await requireAdmin(req);
    if (auth.response) return auth.response;

    const body = (await req.json().catch(() => ({}))) as {
      action?: "dashboard" | "setPremium";
      userId?: string;
      isPremium?: boolean;
    };

    if (body.action === "setPremium") {
      if (!body.userId || typeof body.isPremium !== "boolean") {
        return jsonResponse(req, { error: "Eksik parametreler" }, 400);
      }

      const { error } = await auth.supabase
        .from("profiles")
        .update({
          is_premium: body.isPremium,
          premium_expires_at: body.isPremium ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() : null,
        })
        .eq("id", body.userId);

      if (error) throw error;
      return jsonResponse(req, { ok: true });
    }

    const [users, premiumUsers, searchEvents, savedItineraries, recentUsersRes, recentSearchesRes, selectedCitiesRes, searchedCitiesRes] =
      await Promise.all([
        getExactCount(auth.supabase, "profiles"),
        getExactCount(auth.supabase, "profiles", { column: "is_premium", value: true }),
        getExactCount(auth.supabase, "search_events"),
        getExactCount(auth.supabase, "saved_itineraries"),
        auth.supabase
          .from("profiles")
          .select("id,email,full_name,role,is_premium,created_at")
          .order("created_at", { ascending: false })
          .limit(20),
        auth.supabase
          .from("search_events")
          .select("id,event_type,city_name,created_at")
          .order("created_at", { ascending: false })
          .limit(20),
        auth.supabase
          .from("search_events")
          .select("city_name")
          .eq("event_type", "city_selected")
          .limit(500),
        auth.supabase
          .from("search_events")
          .select("city_name")
          .eq("event_type", "itinerary_generated")
          .limit(500),
      ]);

    if (recentUsersRes.error) throw recentUsersRes.error;
    if (recentSearchesRes.error) throw recentSearchesRes.error;
    if (selectedCitiesRes.error) throw selectedCitiesRes.error;
    if (searchedCitiesRes.error) throw searchedCitiesRes.error;

    return jsonResponse(req, {
      summary: {
        users,
        premiumUsers,
        searchEvents,
        savedItineraries,
      },
      topSelectedCities: buildTopCities((selectedCitiesRes.data ?? []) as Array<{ city_name: string | null }>),
      topSearchedCities: buildTopCities((searchedCitiesRes.data ?? []) as Array<{ city_name: string | null }>),
      recentUsers: (recentUsersRes.data ?? []).map((row) => ({
        id: (row as ProfileRow).id,
        email: (row as ProfileRow).email,
        fullName: (row as ProfileRow).full_name,
        role: (row as ProfileRow).role,
        isPremium: (row as ProfileRow).is_premium,
        createdAt: (row as ProfileRow).created_at,
      })),
      recentSearches: (recentSearchesRes.data ?? []).map((row) => ({
        id: (row as SearchEventRow).id,
        eventType: (row as SearchEventRow).event_type,
        cityName: (row as SearchEventRow).city_name,
        createdAt: (row as SearchEventRow).created_at,
      })),
    });
  } catch (error) {
    return internalError(req, "admin-dashboard", error);
  }
});
