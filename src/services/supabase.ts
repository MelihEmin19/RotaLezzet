import "react-native-url-polyfill/auto";

import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;
const STORAGE_KEY_PREFIX = "rotalezzet.supabase.";

const authStorage = {
  async getItem(key: string): Promise<string | null> {
    const scopedKey = STORAGE_KEY_PREFIX + key;
    if (Platform.OS === "web") {
      return globalThis.localStorage?.getItem(scopedKey) ?? null;
    }
    return AsyncStorage.getItem(scopedKey);
  },
  async setItem(key: string, value: string): Promise<void> {
    const scopedKey = STORAGE_KEY_PREFIX + key;
    if (Platform.OS === "web") {
      globalThis.localStorage?.setItem(scopedKey, value);
      return;
    }
    await AsyncStorage.setItem(scopedKey, value);
  },
  async removeItem(key: string): Promise<void> {
    const scopedKey = STORAGE_KEY_PREFIX + key;
    if (Platform.OS === "web") {
      globalThis.localStorage?.removeItem(scopedKey);
      return;
    }
    await AsyncStorage.removeItem(scopedKey);
  },
};

function normalizeSupabaseUrl(url: string) {
  const trimmed = url.trim().replace(/\/+$/g, "");
  // Supabase URL mutlaka https olmalı
  if (!/^https:\/\//i.test(trimmed)) return trimmed;
  return trimmed;
}

function getExpoExtra() {
  const expoConfigExtra = Constants.expoConfig?.extra;
  const manifestExtra = (Constants as unknown as { manifest?: { extra?: Record<string, unknown> } }).manifest?.extra;
  const manifest2Extra = (Constants as unknown as { manifest2?: { extra?: Record<string, unknown> } }).manifest2?.extra;
  return (expoConfigExtra ?? manifest2Extra ?? manifestExtra ?? {}) as Record<string, unknown>;
}

function getSupabaseProjectConfig() {
  const extra = getExpoExtra();
  const supabaseUrl =
    process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ??
    (typeof extra.supabaseUrl === "string" ? extra.supabaseUrl.trim() : undefined);
  const supabaseAnonKey =
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ??
    (typeof extra.supabaseAnonKey === "string" ? extra.supabaseAnonKey.trim() : undefined);

  return { supabaseUrl, supabaseAnonKey };
}

function buildMissingEnvError(hasUrl: boolean, hasAnonKey: boolean, urlPreview: string | null) {
  const missing = [
    !hasUrl ? "EXPO_PUBLIC_SUPABASE_URL" : null,
    !hasAnonKey ? "EXPO_PUBLIC_SUPABASE_ANON_KEY" : null,
  ].filter((x): x is string => x !== null);

  const parts = [
    "Supabase yapılandırması eksik.",
    `Eksik: ${missing.join(", ")}`,
    "Kontrol:",
    "- `.env` proje kökünde olmalı (package.json ile aynı klasör).",
    "- Değişiklikten sonra Expo dev server'ı tamamen kapatıp `npx expo start --clear` ile yeniden aç.",
    "- Expo Go uygulamasını tamamen kapat/aç (cache).",
    "- `EXPO_NO_DOTENV=1` gibi bir env set etmediğinden emin ol.",
    urlPreview ? `URL önizleme: ${urlPreview}` : null,
  ].filter((x): x is string => Boolean(x));

  return new Error(parts.join("\n"));
}

export function tryGetSupabaseClient(): SupabaseClient | null {
  if (client) return client;

  const { supabaseUrl, supabaseAnonKey } = getSupabaseProjectConfig();

  const hasUrl = Boolean(supabaseUrl);
  const hasAnonKey = Boolean(supabaseAnonKey);
  const urlPreview = supabaseUrl ? `${supabaseUrl.slice(0, 24)}…` : null;

  if (!hasUrl || !hasAnonKey) {
    // Anahtarları loglama; sadece var/yok diagnostik.
    console.log("[Supabase env check]", { hasUrl, hasAnonKey, urlPreview });
    return null;
  }

  let normalizedUrl = supabaseUrl!;
  try {
    normalizedUrl = normalizeSupabaseUrl(supabaseUrl!);
    // URL doğrulaması
    new URL(normalizedUrl);
  } catch {
    console.log("[Supabase url invalid]", { urlPreview });
    return null;
  }

  client = createClient(normalizedUrl, supabaseAnonKey!, {
    auth: {
      storage: authStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });

  return client;
}

export function getSupabaseClient(): SupabaseClient {
  const c = tryGetSupabaseClient();
  if (c) return c;

  const { supabaseUrl, supabaseAnonKey } = getSupabaseProjectConfig();

  throw buildMissingEnvError(
    Boolean(supabaseUrl),
    Boolean(supabaseAnonKey),
    supabaseUrl ? `${supabaseUrl.slice(0, 24)}…` : null,
  );
}

export async function getCurrentSession(): Promise<Session | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export function getSupabaseProjectUrl(): string {
  const { supabaseUrl } = getSupabaseProjectConfig();
  if (!supabaseUrl) throw buildMissingEnvError(false, true, null);
  return normalizeSupabaseUrl(supabaseUrl);
}

export function getSupabasePublishableKey(): string {
  const { supabaseAnonKey } = getSupabaseProjectConfig();
  if (!supabaseAnonKey) throw buildMissingEnvError(true, false, null);
  return supabaseAnonKey;
}

