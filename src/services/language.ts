import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Localization from "expo-localization";

import { normalizeLanguage, type SupportedLanguage } from "../i18n";

const STORAGE_KEY = "app_language_v1";

export async function getStoredLanguage(): Promise<SupportedLanguage | null> {
  try {
    const v = await AsyncStorage.getItem(STORAGE_KEY);
    if (!v) return null;
    return normalizeLanguage(v);
  } catch {
    return null;
  }
}

export async function setStoredLanguage(lang: SupportedLanguage): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // ignore
  }
}

export function getDeviceLanguage(): SupportedLanguage {
  const tag = Localization.getLocales?.()?.[0]?.languageTag ?? "tr";
  return normalizeLanguage(tag);
}

export function getDeviceRegionCode(fallbackLanguage: SupportedLanguage): string {
  const locales = Localization.getLocales?.();
  const raw = (locales?.[0] as any)?.regionCode;
  if (typeof raw === "string" && /^[A-Z]{2}$/i.test(raw.trim())) {
    return raw.trim().toUpperCase();
  }
  return fallbackLanguage === "en" ? "US" : "TR";
}

