import AsyncStorage from "@react-native-async-storage/async-storage";

import type {
  ItineraryRequest,
  UserAddedPlace,
  UserItineraryEdits,
} from "../types/itinerary";

const STORAGE_PREFIX = "@rotalezzet/userEdits/v1/";

function normalize(input: string) {
  return (input || "").trim().toLowerCase().replace(/\s+/g, "-");
}

// Aynı şehir+tercih kombinasyonu için tek bir edit kaydı.
export function makeEditKey(request: ItineraryRequest): string {
  const interests = [...request.interests].map(normalize).sort().join(",");
  const tempo = normalize(request.tempo);
  const diet = request.diet ? normalize(request.diet) : "none";
  const lang = normalize(request.language || "tr");
  const days = normalize(request.days || "1");
  return `${normalize(request.cityId)}|${days}|${tempo}|${interests}|${diet}|${lang}`;
}

const EMPTY: UserItineraryEdits = {
  addedPlaces: [],
  removedPlaceIds: [],
  customOrder: {},
};

export async function loadEdits(request: ItineraryRequest): Promise<UserItineraryEdits> {
  const key = STORAGE_PREFIX + makeEditKey(request);
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<UserItineraryEdits>;
    return {
      addedPlaces: Array.isArray(parsed.addedPlaces) ? parsed.addedPlaces : [],
      removedPlaceIds: Array.isArray(parsed.removedPlaceIds) ? parsed.removedPlaceIds : [],
      customOrder: typeof parsed.customOrder === "object" && parsed.customOrder
        ? (parsed.customOrder as Record<number, string[]>)
        : {},
    };
  } catch {
    return { ...EMPTY };
  }
}

export async function saveEdits(
  request: ItineraryRequest,
  edits: UserItineraryEdits,
): Promise<void> {
  const key = STORAGE_PREFIX + makeEditKey(request);
  try {
    await AsyncStorage.setItem(key, JSON.stringify(edits));
  } catch {
    // sessizce yut; UI tarafında gerekirse hata göstermeyi sonra ekleriz.
  }
}

export async function clearEdits(request: ItineraryRequest): Promise<void> {
  const key = STORAGE_PREFIX + makeEditKey(request);
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    // ignore
  }
}

// --- CRUD helper'ları ---

export async function addPlace(
  request: ItineraryRequest,
  place: UserAddedPlace,
): Promise<UserItineraryEdits> {
  const current = await loadEdits(request);
  // Aynı placeId aynı güne tekrar eklenmesin.
  const dup = current.addedPlaces.find(
    (p) => p.placeId === place.placeId && p.day === place.day,
  );
  if (dup) return current;
  // Eğer bu placeId daha önce silindiyse silme listesinden çıkar.
  const removed = current.removedPlaceIds.filter((id) => id !== place.placeId);
  const next: UserItineraryEdits = {
    ...current,
    addedPlaces: [...current.addedPlaces, place],
    removedPlaceIds: removed,
  };
  await saveEdits(request, next);
  return next;
}

export async function removePlace(
  request: ItineraryRequest,
  placeId: string,
  source: "auto" | "user" = "auto",
): Promise<UserItineraryEdits> {
  const current = await loadEdits(request);
  let addedPlaces = current.addedPlaces;
  let removedPlaceIds = current.removedPlaceIds;

  if (source === "user") {
    // User-added → addedPlaces listesinden çıkar.
    addedPlaces = current.addedPlaces.filter((p) => p.placeId !== placeId);
  } else {
    // Auto → removedPlaceIds'a yaz, bir sonraki sefer gelmesin.
    if (!removedPlaceIds.includes(placeId)) {
      removedPlaceIds = [...removedPlaceIds, placeId];
    }
  }

  // customOrder içinden de temizle.
  const customOrder: Record<number, string[]> = {};
  for (const [d, arr] of Object.entries(current.customOrder ?? {})) {
    customOrder[Number(d)] = arr.filter((id) => id !== placeId);
  }

  const next: UserItineraryEdits = { addedPlaces, removedPlaceIds, customOrder };
  await saveEdits(request, next);
  return next;
}

export async function setDayOrder(
  request: ItineraryRequest,
  day: number,
  orderedPlaceIds: string[],
): Promise<UserItineraryEdits> {
  const current = await loadEdits(request);
  const next: UserItineraryEdits = {
    ...current,
    customOrder: { ...(current.customOrder ?? {}), [day]: orderedPlaceIds },
  };
  await saveEdits(request, next);
  return next;
}
