import type { User } from "@supabase/supabase-js";

import type { UserProfile } from "../types/auth";
import { getSupabaseClient } from "./supabase";

type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  role: "user" | "admin";
  is_premium: boolean;
  premium_expires_at: string | null;
  created_at: string;
  updated_at: string;
};

function mapProfile(row: ProfileRow): UserProfile {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    avatarUrl: row.avatar_url,
    role: row.role,
    isPremium: row.is_premium,
    premiumExpiresAt: row.premium_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function ensureMyProfile(user: User): Promise<UserProfile> {
  const supabase = getSupabaseClient();
  const payload = {
    id: user.id,
    email: user.email ?? null,
    full_name:
      typeof user.user_metadata.full_name === "string" && user.user_metadata.full_name.trim().length > 0
        ? user.user_metadata.full_name.trim()
        : null,
    avatar_url:
      typeof user.user_metadata.avatar_url === "string" && user.user_metadata.avatar_url.trim().length > 0
        ? user.user_metadata.avatar_url.trim()
        : null,
  };

  const { data, error } = await supabase
    .from("profiles")
    .upsert(payload)
    .select("id,email,full_name,avatar_url,role,is_premium,premium_expires_at,created_at,updated_at")
    .single();

  if (error) throw error;
  return mapProfile(data as ProfileRow);
}

export async function getMyProfile(userId: string): Promise<UserProfile | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id,email,full_name,avatar_url,role,is_premium,premium_expires_at,created_at,updated_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapProfile(data as ProfileRow) : null;
}

export async function updateMyProfile(updates: {
  fullName?: string;
  avatarUrl?: string | null;
}): Promise<UserProfile> {
  const supabase = getSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) throw userError;
  if (!user) throw new Error("Oturum bulunamadı.");

  const { data, error } = await supabase
    .from("profiles")
    .update({
      full_name: updates.fullName?.trim() || null,
      avatar_url: updates.avatarUrl ?? null,
    })
    .eq("id", user.id)
    .select("id,email,full_name,avatar_url,role,is_premium,premium_expires_at,created_at,updated_at")
    .single();

  if (error) throw error;
  return mapProfile(data as ProfileRow);
}
