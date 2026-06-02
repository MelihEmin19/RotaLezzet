import type {
  ItineraryItem,
  ItineraryRequest,
  UserItineraryEdits,
} from "../types/itinerary";
import type { Place, PlaceKind } from "../types/place";
import { fetchPlacesForCity } from "./googlePlaces";
import { haversineKm, optimizePlacesOrder } from "./routeOptimizer";
import { getSupabaseClient } from "./supabase";
import { loadEdits } from "./userEdits";

type CacheRow = {
  city_id: string;
  city_name: string;
  kind: PlaceKind;
  created_at: string;
  payload: unknown;
};

const CACHE_TABLE = "city_places_cache";
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 gün

function normalizeKeyPart(input: string) {
  return input.trim().toLocaleLowerCase("tr-TR").replace(/\s+/g, "-");
}

function makePreferenceCacheKey(request: ItineraryRequest) {
  const interests = [...request.interests].map(normalizeKeyPart).sort().join(",");
  const tempo = normalizeKeyPart(request.tempo);
  const diet = request.diet ? normalizeKeyPart(request.diet) : "none";
  const language = normalizeKeyPart(request.language || "tr");
  const region = normalizeKeyPart(request.regionCode || "tr");
  const tz = request.destinationTimeZoneId ? normalizeKeyPart(request.destinationTimeZoneId) : "none";
  const days = normalizeKeyPart(request.days || "1");
  return `${tempo}|${interests}|${diet}|${language}|${region}|${tz}|d${days}`;
}

function makeCacheCityId(request: ItineraryRequest) {
  // Aynı şehirde farklı tercihler farklı cache satırı üretir (çakışma yok).
  const pref = makePreferenceCacheKey(request);
  // v10: multi-day support — günlere göre bölünmüş itinerary.
  return `${request.cityId}::${pref}::v11`;
}

function isFresh(iso: string) {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts < CACHE_TTL_MS;
}

function asPlaces(value: unknown): Place[] | null {
  if (!Array.isArray(value)) return null;
  const ok = value.every(
    (x) =>
      x &&
      typeof x === "object" &&
      typeof (x as any).placeId === "string" &&
      typeof (x as any).name === "string" &&
      ( (x as any).kind === "restaurant" || (x as any).kind === "attraction") &&
      typeof (x as any).lat === "number" &&
      typeof (x as any).lng === "number",
  );
  return ok ? (value as Place[]) : null;
}

async function readCache(cityId: string, kind: PlaceKind): Promise<Place[] | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from(CACHE_TABLE)
    .select("payload,created_at")
    .eq("city_id", cityId)
    .eq("kind", kind)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error || !data?.length) return null;
  const row = data[0] as Pick<CacheRow, "payload" | "created_at">;
  if (!isFresh(row.created_at)) return null;
  return asPlaces(row.payload);
}

function toEdgeTempo(tempo: ItineraryRequest["tempo"]) {
  if (tempo === "Yavaş") return "slow";
  if (tempo === "Dengeli") return "medium";
  return "fast";
}

function toEdgeInterests(interests: ItineraryRequest["interests"]) {
  return interests.map((i) => {
    if (i === "Doğa") return "nature";
    if (i === "Tarih") return "history";
    if (i === "Gastronomi") return "gastronomy";
    return "shopping";
  });
}

function toEdgeDiet(diet: ItineraryRequest["diet"]) {
  if (!diet) return undefined;
  if (diet === "Etçil") return "meat";
  if (diet === "Vejetaryen") return "vegetarian";
  if (diet === "Vegan") return "vegan";
  return "seafood";
}

export async function getPlacesForCityCached(request: ItineraryRequest): Promise<{
  restaurants: Place[];
  attractions: Place[];
  orderedStops?: Place[];
  source: "cache" | "google";
}> {
  const cacheCityId = makeCacheCityId(request);
  try {
    const [cachedRestaurants, cachedAttractions] = await Promise.all([
      readCache(cacheCityId, "restaurant"),
      readCache(cacheCityId, "attraction"),
    ]);

    if (cachedRestaurants && cachedAttractions) {
      return { restaurants: cachedRestaurants, attractions: cachedAttractions, source: "cache" };
    }
  } catch {
    // cache okuyamazsak Google'a düşeceğiz
  }

  const fresh = await fetchPlacesForCity({
    cityId: request.cityId,
    cityName: request.cityName,
    cityPlaceId: request.cityPlaceId,
    cityLat: request.cityLat,
    cityLng: request.cityLng,
    language: request.language,
    regionCode: request.regionCode,
    destinationTimeZoneId: request.destinationTimeZoneId,
    interests: toEdgeInterests(request.interests),
    tempo: toEdgeTempo(request.tempo),
    diet: toEdgeDiet(request.diet),
    days: daysNumeric(request.days),
  });

  return {
    restaurants: fresh.restaurants,
    attractions: fresh.attractions,
    orderedStops: fresh.orderedStops,
    source: fresh.source === "cache" ? "cache" : "google",
  };
}

function stopCountForTempo(tempo: ItineraryRequest["tempo"]) {
  if (tempo === "Yavaş") return 4;
  if (tempo === "Dengeli") return 7;
  return 10;
}

function daysNumeric(days: ItineraryRequest["days"]) {
  if (days === "1") return 1;
  if (days === "2") return 2;
  return 3;
}

// Optimistic UI için: bir günün öğelerini 09:00'dan başlayarak yeniden zamanlar.
// Sıra dışarıdan verilir (kullanıcının drag ile koyduğu sıra ya da silme/ekleme sonrası).
export function recomputeDayTimes(
  dayItems: ItineraryItem[],
  tempo: ItineraryRequest["tempo"],
): ItineraryItem[] {
  let cursorMin = 9 * 60;
  return dayItems.map((it) => {
    const kind: PlaceKind = it.category === "food" ? "restaurant" : "attraction";
    const minutes = durationMinutesForPlace(tempo, kind);
    const startTime = fromMin(cursorMin);
    const endTime = fromMin(cursorMin + minutes);
    cursorMin = cursorMin + minutes + 15;
    return { ...it, startTime, endTime };
  });
}

function durationMinutesForPlace(tempo: ItineraryRequest["tempo"], kind: PlaceKind) {
  if (tempo === "Yavaş") return kind === "restaurant" ? 80 : 120;
  if (tempo === "Dengeli") return kind === "restaurant" ? 60 : 90;
  return kind === "restaurant" ? 45 : 60;
}

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function fromMin(min: number): string {
  const h = Math.floor(min / 60);
  const mm = min % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

// Bir günün mekanlarını saat-tabanlı yerleştirir:
//   - Gün 09:00'da başlar.
//   - Öğle yemeği penceresi: 12:00–14:00  → bu saate denk düşünce restoran koy.
//   - Akşam yemeği penceresi: 19:00–21:00 → bu saate denk düşünce restoran koy.
//   - Bir sonraki gezi penceresi kaçıracak kadar uzatıyorsa, cursor'ı pencere
//     başlangıcına çekip restoranı yerleştir.
function buildDaySchedule(
  attractions: Place[],
  restaurants: Place[],
  tempo: ItineraryRequest["tempo"],
): Array<{ place: Place; startTime: string; endTime: string }> {
  const result: Array<{ place: Place; startTime: string; endTime: string }> = [];
  const attrQ = [...attractions];
  const restQ = [...restaurants];

  // Yemek pencereleri (gün içi saat aralıkları).
  const mealWindows: Array<{ minMin: number; maxMin: number }> = [];
  if (restQ.length >= 1) mealWindows.push({ minMin: toMin("12:00"), maxMin: toMin("14:00") });
  if (restQ.length >= 2) mealWindows.push({ minMin: toMin("19:00"), maxMin: toMin("21:00") });
  // 3+ restoran için öğle/akşam dolunca geri kalanı sona bırakılır.

  let cursorMin = toMin("09:00");

  while (attrQ.length > 0 || restQ.length > 0) {
    let placed: Place | undefined;

    // 1) Aktif yemek penceresinde miyiz?
    if (restQ.length > 0 && mealWindows.length > 0) {
      const win = mealWindows[0];

      if (cursorMin >= win.minMin && cursorMin <= win.maxMin) {
        placed = restQ.shift();
        mealWindows.shift();
      } else if (cursorMin < win.minMin) {
        // Pencereden önceyiz → sıradaki gezi bu pencereyi kaçırtacak mı?
        if (attrQ.length > 0) {
          const nextAttr = attrQ[0];
          const dur = durationMinutesForPlace(tempo, nextAttr.kind);
          const projectedCursor = cursorMin + dur + 15;
          if (projectedCursor > win.maxMin) {
            // Gezi eklersek yemek penceresini atlarız → önce yemek, cursor'ı pencereye çek.
            if (cursorMin < win.minMin) cursorMin = win.minMin;
            placed = restQ.shift();
            mealWindows.shift();
          }
          // else: gezi penceremizin içinde kalır, önce gezi.
        } else {
          // Elimizde sadece restoran kaldı → cursor'ı pencereye çek.
          if (cursorMin < win.minMin) cursorMin = win.minMin;
          placed = restQ.shift();
          mealWindows.shift();
        }
      } else {
        // cursorMin > maxMin → pencereyi kaçırdık; bu restoranı hemen koy ve geç.
        placed = restQ.shift();
        mealWindows.shift();
      }
    }

    // 2) Yemek konmadıysa → sıradaki gezi.
    if (!placed) {
      if (attrQ.length > 0) {
        placed = attrQ.shift();
      } else if (restQ.length > 0) {
        // Pencere kalmadı ama restoran var → peşi sıra koy.
        placed = restQ.shift();
      }
    }

    if (!placed) break;

    const minutes = durationMinutesForPlace(tempo, placed.kind);
    const startTime = fromMin(cursorMin);
    const endTime = fromMin(cursorMin + minutes);
    result.push({ place: placed, startTime, endTime });
    cursorMin = cursorMin + minutes + 15;
  }

  return result;
}

function centroidOf(places: Place[]): { lat: number; lng: number } | null {
  if (!places.length) return null;
  const lat = places.reduce((s, p) => s + p.lat, 0) / places.length;
  const lng = places.reduce((s, p) => s + p.lng, 0) / places.length;
  return { lat, lng };
}

export async function buildItinerary(request: ItineraryRequest): Promise<ItineraryItem[]> {
  const { restaurants, attractions } = await getPlacesForCityCached(request);

  const perDayStops = stopCountForTempo(request.tempo);
  const nDays = daysNumeric(request.days);
  const wantsFood = request.interests.includes("Gastronomi");
  const wantsAttr =
    request.interests.length === 0 ||
    request.interests.some((i) => i === "Tarih" || i === "Doğa" || i === "Alışveriş");

  // Günlük slot dağılımı (yemek/gezi oranı) — her günde aynı oran uygulanır.
  let perDayFood = 0;
  let perDayAttr = 0;
  if (wantsFood && !wantsAttr) {
    perDayFood = perDayStops;
  } else if (!wantsFood && wantsAttr) {
    perDayAttr = perDayStops;
  } else {
    perDayFood = Math.max(1, Math.round(perDayStops * 0.3));
    perDayAttr = Math.max(0, perDayStops - perDayFood);
  }

  const totalAttr = perDayAttr * nDays;

  // Attraction havuzu: NN ile coğrafi olarak sırala → komşular yan yana.
  const attractionPool = attractions.slice(0, Math.max(totalAttr, attractions.length));
  const attractionOrdered =
    attractionPool.length > 1 ? optimizePlacesOrder(attractionPool) : attractionPool;

  // NN sıralı attraction listesini günlere eşit böl → her gün bir coğrafi kümeye denk gelir.
  function splitChunks<T>(arr: T[], days: number): T[][] {
    if (days <= 1 || arr.length === 0) return [arr];
    const base = Math.floor(arr.length / days);
    const extra = arr.length % days;
    const chunks: T[][] = [];
    let idx = 0;
    for (let d = 0; d < days; d += 1) {
      const size = base + (d < extra ? 1 : 0);
      chunks.push(arr.slice(idx, idx + size));
      idx += size;
    }
    return chunks;
  }

  const attractionDayChunks = splitChunks(attractionOrdered.slice(0, totalAttr), nDays);

  // Restoran havuzu: NLP/diet re-rank edilmiş sıradayı koru.
  const restaurantPool = [...restaurants];

  // Her gün için: o günün attraction centroid'ine en yakın N restoranı seç (diğer günlerle çakışmasın).
  const restaurantDayChunks: Place[][] = [];
  const usedRestIds = new Set<string>();

  for (let d = 0; d < nDays; d += 1) {
    const dayAttr = attractionDayChunks[d] ?? [];
    const center = centroidOf(dayAttr);
    const available = restaurantPool.filter((r) => !usedRestIds.has(r.placeId));
    let picked: Place[];
    if (center) {
      // Yakınlığa göre sırala, ama NLP/diet sırasını tamamen kaybetmemek için
      // üst %50'sini yakınlıkla sırala.
      const rankedBySource = [...available];
      const byDistance = [...rankedBySource].sort(
        (a, b) =>
          haversineKm(center, { lat: a.lat, lng: a.lng }) -
          haversineKm(center, { lat: b.lat, lng: b.lng }),
      );
      picked = byDistance.slice(0, perDayFood);
    } else {
      picked = available.slice(0, perDayFood);
    }
    picked.forEach((p) => usedRestIds.add(p.placeId));
    restaurantDayChunks.push(picked);
  }

  // Fallback: hiç mekan yoksa
  const anyPicked = attractionDayChunks.some((c) => c.length) || restaurantDayChunks.some((c) => c.length);
  if (!anyPicked) {
    throw new Error("Yeterli mekan bulunamadı. Lütfen farklı bir tempo/ilgi seçip tekrar deneyin.");
  }

  // Her gün içinde attraction'ları NN ile yeniden sırala (kendi içinde), sonra
  // restoranları öğle/akşam saat pencerelerine hizala.
  const items: ItineraryItem[] = [];
  for (let d = 0; d < nDays; d += 1) {
    const rawAttr = attractionDayChunks[d] ?? [];
    const dayAttr = rawAttr.length > 1 ? optimizePlacesOrder(rawAttr) : rawAttr;
    const dayRest = restaurantDayChunks[d] ?? [];

    const scheduled = buildDaySchedule(dayAttr, dayRest, request.tempo);
    if (scheduled.length === 0) continue;

    for (let i = 0; i < scheduled.length; i += 1) {
      const { place: p, startTime, endTime } = scheduled[i];
      items.push({
        id: `${request.cityId}-d${d + 1}-${p.placeId}-${startTime.replace(":", "")}`,
        placeId: p.placeId,
        startTime,
        endTime,
        title: p.name,
        category: p.kind === "restaurant" ? "food" : "place",
        subtype: p.kind === "attraction" ? p.subtype : undefined,
        lat: p.lat,
        lng: p.lng,
        rating: p.rating,
        photoUrl: p.photoUrl,
        dietMatch: p.kind === "restaurant" ? p.dietMatch : undefined,
        nlpHighlight: p.kind === "restaurant" ? p.nlpHighlight : undefined,
        day: d + 1,
        source: "auto",
      });
    }
  }

  // Kullanıcı düzenlemelerini overlay olarak uygula (silme + ekleme + sıralama).
  const edits = await loadEdits(request);
  return applyUserEdits(items, edits, request.tempo, nDays, request.cityId);
}

// --- USER EDITS OVERLAY ---

// Verilen otomatik itinerary üzerine kullanıcının değişikliklerini uygular,
// günleri saat-tabanlı olarak yeniden zamanlar.
export function applyUserEdits(
  autoItems: ItineraryItem[],
  edits: UserItineraryEdits,
  tempo: ItineraryRequest["tempo"],
  nDays: number,
  cityId: string,
): ItineraryItem[] {
  const removed = new Set(edits.removedPlaceIds);

  // 1) Silinmiş otomatik öğeleri ele.
  let working = autoItems.filter((it) => !removed.has(it.placeId));

  // 2) User-added yerleri ItineraryItem'a dönüştürerek ekle.
  for (const ap of edits.addedPlaces) {
    working.push({
      id: `${cityId}-d${ap.day}-user-${ap.placeId}`,
      placeId: ap.placeId,
      startTime: "00:00",
      endTime: "00:00",
      title: ap.name,
      category: ap.category,
      subtype: ap.subtype,
      lat: ap.lat,
      lng: ap.lng,
      rating: ap.rating,
      photoUrl: ap.photoUrl,
      day: ap.day,
      source: "user",
      pinned: true,
    });
  }

  // 3) Günlere göre grupla ve her güne sıralama + saat hesapla.
  const byDay = new Map<number, ItineraryItem[]>();
  for (let d = 1; d <= nDays; d += 1) byDay.set(d, []);
  for (const it of working) {
    const d = typeof it.day === "number" ? it.day : 1;
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push(it);
  }

  const finalItems: ItineraryItem[] = [];
  const sortedDays = Array.from(byDay.keys()).sort((a, b) => a - b);

  for (const day of sortedDays) {
    const dayItems = byDay.get(day) ?? [];
    if (!dayItems.length) continue;

    // 3a) Sıralama: customOrder varsa onu uygula, yoksa orijinal sırayı koru
    //     (auto kayıtlar zaten saat sırasına göre eklendi; user-added en sona).
    const customOrder = edits.customOrder?.[day];
    let orderedDay: ItineraryItem[];
    if (customOrder && customOrder.length) {
      const map = new Map(dayItems.map((it) => [it.placeId, it]));
      const orderedIds = customOrder.filter((id) => map.has(id));
      const used = new Set(orderedIds);
      orderedDay = [
        ...orderedIds.map((id) => map.get(id)!),
        ...dayItems.filter((it) => !used.has(it.placeId)),
      ];
    } else {
      orderedDay = dayItems;
    }

    // 3b) Saatleri 09:00'dan itibaren yeniden hesapla (yemek pencereleri korunur).
    const places: Place[] = orderedDay.map((it) => placeFromItem(it));
    // buildDaySchedule attractions / restaurants ayırarak çalışıyor; burada SIRAYI
    // korumalıyız (kullanıcı sırasını bozmayalım), bu yüzden sade bir time-fill yapalım.
    let cursorMin = toMin("09:00");
    for (let i = 0; i < orderedDay.length; i += 1) {
      const it = orderedDay[i];
      const minutes = durationMinutesForPlace(tempo, places[i].kind);
      const startTime = fromMin(cursorMin);
      const endTime = fromMin(cursorMin + minutes);
      cursorMin = cursorMin + minutes + 15;
      finalItems.push({ ...it, startTime, endTime });
    }
  }

  return finalItems;
}

function placeFromItem(it: ItineraryItem): Place {
  return {
    placeId: it.placeId,
    name: it.title,
    kind: it.category === "food" ? "restaurant" : "attraction",
    lat: it.lat,
    lng: it.lng,
    rating: it.rating,
    photoUrl: it.photoUrl,
    subtype: it.subtype,
    dietMatch: it.dietMatch,
    nlpHighlight: it.nlpHighlight,
  } as Place;
}

