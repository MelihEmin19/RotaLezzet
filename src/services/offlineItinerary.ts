import AsyncStorage from "@react-native-async-storage/async-storage";

import type { ItineraryItem, ItineraryRequest } from "../types/itinerary";
import { makeEditKey } from "./userEdits";

const STORAGE_PREFIX = "@rotalezzet/offline-itinerary/v1/";
const INDEX_KEY = "@rotalezzet/offline-itinerary-index/v1";

export type OfflineItineraryEntry = {
  key: string;
  cityId: string;
  cityName: string;
  request: ItineraryRequest;
  items: ItineraryItem[];
  cachedAt: string;
};

function storageKey(requestKey: string) {
  return `${STORAGE_PREFIX}${requestKey}`;
}

async function readIndex(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

async function writeIndex(keys: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(keys));
  } catch {
    // ignore
  }
}

export async function cacheOfflineItinerary(
  request: ItineraryRequest,
  items: ItineraryItem[],
): Promise<void> {
  const key = makeEditKey(request);
  const entry: OfflineItineraryEntry = {
    key,
    cityId: request.cityId,
    cityName: request.cityName,
    request,
    items,
    cachedAt: new Date().toISOString(),
  };
  try {
    await AsyncStorage.setItem(storageKey(key), JSON.stringify(entry));
    const idx = await readIndex();
    if (!idx.includes(key)) {
      idx.unshift(key);
      // Maksimum 20 offline rota tutalim.
      const trimmed = idx.slice(0, 20);
      await writeIndex(trimmed);
      const removed = idx.slice(20);
      await Promise.all(removed.map((k) => AsyncStorage.removeItem(storageKey(k))));
    } else {
      // Index'te basa cekelim
      const next = [key, ...idx.filter((k) => k !== key)];
      await writeIndex(next);
    }
  } catch {
    // ignore
  }
}

export async function getOfflineItinerary(
  request: ItineraryRequest,
): Promise<OfflineItineraryEntry | null> {
  const key = makeEditKey(request);
  try {
    const raw = await AsyncStorage.getItem(storageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OfflineItineraryEntry;
    if (!Array.isArray(parsed.items)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function listOfflineItineraries(): Promise<OfflineItineraryEntry[]> {
  const idx = await readIndex();
  const entries = await Promise.all(
    idx.map(async (key) => {
      try {
        const raw = await AsyncStorage.getItem(storageKey(key));
        if (!raw) return null;
        return JSON.parse(raw) as OfflineItineraryEntry;
      } catch {
        return null;
      }
    }),
  );
  return entries.filter((e): e is OfflineItineraryEntry => Boolean(e));
}

export async function removeOfflineItinerary(requestKey: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(storageKey(requestKey));
    const idx = await readIndex();
    await writeIndex(idx.filter((k) => k !== requestKey));
  } catch {
    // ignore
  }
}
