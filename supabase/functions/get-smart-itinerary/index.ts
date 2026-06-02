/// <reference lib="deno.ns" />

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  buildSignedPhotoUrl,
  enforceRateLimit,
  ensureBrowserOriginAllowed,
  getCorsHeaders,
  handleOptions,
  internalError,
  jsonResponse,
  sanitizePhotoWidth,
  verifySignedPhotoRequest,
} from "../_shared/security.ts";

type PlaceKind = "restaurant" | "attraction";

type ItineraryNlpHighlight = {
  dishName: string;
  positivePercent: number;
  sampleReview?: string;
  sampleReviews?: string[];
  // i18n marker: frontend bu anahtara göre "Öne Çıkan Lezzet" / "Featured Flavor" basar.
  dishNameKey?: "fallback";
  // Çeviri meta
  sampleReviewOriginal?: string;
  sampleReviewLanguage?: string;
};

type PlaceSubtype = "nature" | "history" | "shopping";

type Place = {
  placeId: string;
  name: string;
  kind: PlaceKind;
  subtype?: PlaceSubtype;
  address?: string;
  rating?: number;
  userRatingsTotal?: number;
  photoUrl?: string;
  lat: number;
  lng: number;
  dietMatch?: boolean;
  nlpHighlight?: ItineraryNlpHighlight;
};

type CacheRow = {
  city_id: string;
  city_name: string;
  kind: PlaceKind;
  created_at: string;
  payload: unknown;
};

const CACHE_TABLE = "city_places_cache";
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 gün

let adminClient: SupabaseClient | null = null;

// Google Places API (New) v1
type PlacesV1SearchTextResponse = {
  places?: PlacesV1Place[];
};

type PlacesV1Place = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  rating?: number;
  userRatingCount?: number;
  types?: string[];
  photos?: Array<{ name?: string }>;
};

type PlacesV1DetailsResponse = {
  reviews?: Array<{ text?: { text?: string }; rating?: number }>;
};

function scoreCandidate(rating?: number, total?: number) {
  const r = typeof rating === "number" ? rating : 0;
  const t = typeof total === "number" ? total : 0;
  return r * Math.log10(Math.max(1, t));
}

function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371e3;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const x = s1 * s1 + Math.cos(lat1) * Math.cos(lat2) * s2 * s2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function orderNearestNeighbor<T extends { lat: number; lng: number }>(items: T[]) {
  if (items.length <= 2) return items;
  const remaining = [...items];
  const route: T[] = [];

  // Seed: ilk eleman (çakışmayı azaltmak için deterministik)
  route.push(remaining.shift()!);

  while (remaining.length) {
    const last = route[route.length - 1];
    let bestIdx = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < remaining.length; i += 1) {
      const d = haversineMeters(last, remaining[i]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    route.push(remaining.splice(bestIdx, 1)[0]);
  }

  return route;
}

function requireSecret(key: string) {
  const v = Deno.env.get(key);
  if (!v || !v.trim()) throw new Error(`Eksik secret: ${key}`);
  return v.trim();
}

function getAdminClient() {
  if (adminClient) return adminClient;
  adminClient = createClient(requireSecret("SUPABASE_URL"), requireSecret("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return adminClient;
}

function normalizeKeyPart(input: string) {
  return input.trim().toLocaleLowerCase("tr-TR").replace(/\s+/g, "-");
}

function makePreferenceCacheKey(params: {
  interests: string[];
  tempo: "slow" | "medium" | "fast";
  diet: "meat" | "vegetarian" | "vegan" | "seafood" | null;
  language: string;
  regionCode?: string;
  destinationTimeZoneId?: string;
  days: number;
}) {
  const interests = [...params.interests].map(normalizeKeyPart).sort().join(",");
  const tempo = normalizeKeyPart(params.tempo);
  const diet = params.diet ? normalizeKeyPart(params.diet) : "none";
  const language = normalizeKeyPart(params.language || "tr");
  const region = normalizeKeyPart(params.regionCode || "tr");
  const tz = params.destinationTimeZoneId ? normalizeKeyPart(params.destinationTimeZoneId) : "none";
  const days = normalizeKeyPart(String(params.days || 1));
  return `${tempo}|${interests}|${diet}|${language}|${region}|${tz}|d${days}`;
}

function makeCacheCityId(
  cityId: string,
  params: Parameters<typeof makePreferenceCacheKey>[0],
) {
  const pref = makePreferenceCacheKey(params);
  return `${cityId}::${pref}::v11`;
}

function isFresh(iso: string) {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts < CACHE_TTL_MS;
}

function asPlaces(value: unknown): Place[] | null {
  if (!Array.isArray(value)) return null;

  const ok = value.every((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const item = entry as Record<string, unknown>;
    return (
      typeof item.placeId === "string" &&
      typeof item.name === "string" &&
      (item.kind === "restaurant" || item.kind === "attraction") &&
      typeof item.lat === "number" &&
      typeof item.lng === "number"
    );
  });

  return ok ? (value as Place[]) : null;
}

async function readCache(cityId: string, kind: PlaceKind): Promise<Place[] | null> {
  const supabase = getAdminClient();
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

async function writeCache(cityId: string, cityName: string, kind: PlaceKind, places: Place[]) {
  const supabase = getAdminClient();
  const row: CacheRow = {
    city_id: cityId,
    city_name: cityName,
    kind,
    payload: places,
    created_at: new Date().toISOString(),
  };

  const { error } = await supabase.from(CACHE_TABLE).upsert(row, { onConflict: "city_id,kind" });
  if (error) {
    throw new Error(`Cache write hatası: ${error.message}`);
  }
}

async function proxyPlacePhotoV1(photoName: string, maxwidth: string, req: Request) {
  const key = requireSecret("GOOGLE_PLACES_API_KEY");
  const safeWidth = sanitizePhotoWidth(maxwidth, "800");
  const url = new URL(`https://places.googleapis.com/v1/${photoName}/media`);
  url.searchParams.set("maxWidthPx", safeWidth);

  const res = await fetch(url.toString(), {
    redirect: "follow",
    headers: {
      "X-Goog-Api-Key": key,
    },
  });
  const contentType = res.headers.get("content-type") ?? "image/jpeg";

  return new Response(res.body, {
    status: res.status,
    headers: {
      ...getCorsHeaders(req),
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=300",
    },
  });
}

function canonicalLanguageCode(input: unknown) {
  if (typeof input !== "string") return "tr";
  const v = input.trim();
  if (!v) return "tr";
  const base = v.split("-")[0]?.trim().toLocaleLowerCase("en-US");
  return base && /^[a-z]{2,3}$/i.test(base) ? base : "tr";
}

function canonicalRegionCode(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const v = input.trim().toLocaleUpperCase("en-US");
  if (!v) return undefined;
  return /^[A-Z]{2}$/.test(v) ? v : undefined;
}

async function placesSearchTextV1(
  textQuery: string,
  languageCode = "tr",
  regionCode?: string,
  bias?: { lat: number; lng: number; radiusMeters?: number },
): Promise<PlacesV1Place[]> {
  const key = requireSecret("GOOGLE_PLACES_API_KEY");
  const url = "https://places.googleapis.com/v1/places:searchText";

  const fieldMask = [
    "places.id",
    "places.displayName",
    "places.formattedAddress",
    "places.location",
    "places.rating",
    "places.userRatingCount",
    "places.types",
    "places.photos",
  ].join(",");

  const body: Record<string, unknown> = { textQuery, languageCode, regionCode };
  if (bias && typeof bias.lat === "number" && typeof bias.lng === "number") {
    // locationBias: Google'a "sonuçları bu daireye yakın olanlardan öner" ipucu verir.
    // radius en fazla 50 km (Places API sınırı).
    const radius = Math.min(Math.max(bias.radiusMeters ?? 50000, 1000), 50000);
    body.locationBias = {
      circle: {
        center: { latitude: bias.lat, longitude: bias.lng },
        radius,
      },
    };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": fieldMask,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      const j = JSON.parse(text);
      msg = (j?.error?.message as string) ?? text;
    } catch {
      // ignore
    }
    throw new Error(`Google Places hatası: ${msg}`);
  }

  const json = JSON.parse(text) as PlacesV1SearchTextResponse;
  return json.places ?? [];
}

function canonicalTempo(input: string) {
  const t = normalizeTr(input);
  if (t === "slow" || t === "yavaş") return "slow" as const;
  if (t === "medium" || t === "dengeli" || t === "balanced") return "medium" as const;
  if (t === "fast" || t === "yoğun" || t === "hızlı") return "fast" as const;
  return "fast" as const;
}

function canonicalDiet(input: unknown): "meat" | "vegetarian" | "vegan" | "seafood" | null {
  if (typeof input !== "string") return null;
  const d = normalizeTr(input);
  if (d === "meat" || d.includes("etçil") || d.includes("etcil")) return "meat";
  if (d === "vegetarian" || d.includes("vejetaryen")) return "vegetarian";
  if (d === "vegan") return "vegan";
  if (d === "seafood" || d.includes("deniz")) return "seafood";
  return null;
}

function canonicalInterests(list: unknown): Array<"nature" | "history" | "gastronomy" | "shopping"> {
  const arr = Array.isArray(list) ? list : [];
  const set = new Set<"nature" | "history" | "gastronomy" | "shopping">();

  for (const raw of arr) {
    if (typeof raw !== "string") continue;
    const v = normalizeTr(raw);
    if (v === "nature" || v === "doğa" || v === "doğa") set.add("nature");
    else if (v === "history" || v === "tarih") set.add("history");
    else if (v === "gastronomy" || v === "gastronomi") set.add("gastronomy");
    else if (v === "shopping" || v === "alışveriş" || v === "alisveris") set.add("shopping");
  }

  return Array.from(set);
}

function stopCountForTempo(tempo: "slow" | "medium" | "fast") {
  if (tempo === "slow") return 4;
  if (tempo === "medium") return 7;
  return 10;
}

const natureTypes = new Set([
  "park",
  "natural_feature",
  "campground",
  "national_park",
  "tourist_attraction",
]);
const historyTypes = new Set([
  "museum",
  "church",
  "mosque",
  "place_of_worship",
  "hindu_temple",
  "synagogue",
  "historical_landmark",
  "tourist_attraction",
  "art_gallery",
]);
const shoppingTypes = new Set([
  "shopping_mall",
  "market",
  "store",
  "clothing_store",
  "department_store",
  "supermarket",
  "jewelry_store",
  "shoe_store",
  "book_store",
  "electronics_store",
  "home_goods_store",
]);

function nameLooksLikeShopping(name: string) {
  const n = normalizeTr(name);
  const kws = [
    "mall",
    "bazaar",
    "market",
    "çarşı",
    "carsi",
    "avm",
    "shopping",
    "plaza",
    "outlet",
    "pasaj",
    "galeria",
    "galerie",
    "center",
    "centre",
    "souk",
    "passage",
  ];
  return kws.some((k) => n.includes(k));
}

function matchesInterestTypes(
  types: string[] | undefined,
  name: string | undefined,
  interests: Array<"nature" | "history" | "shopping">,
  sourceInterest?: "nature" | "history" | "shopping",
) {
  if (!interests.length) return true;
  // Sorgu zaten bir interest'ten geldiyse (örn. shopping query) otomatik kabul.
  if (sourceInterest && interests.includes(sourceInterest)) return true;

  const t = (types ?? []).map((x) => x.toLocaleLowerCase("en-US"));
  const set = new Set(t);

  for (const i of interests) {
    if (i === "nature" && Array.from(natureTypes).some((x) => set.has(x))) return true;
    if (i === "history" && Array.from(historyTypes).some((x) => set.has(x))) return true;
    if (i === "shopping") {
      if (Array.from(shoppingTypes).some((x) => set.has(x))) return true;
      if (name && nameLooksLikeShopping(name)) return true;
    }
  }
  return false;
}

function mergeUniqueByPlaceId(lists: Array<Array<PlacesV1Place>>) {
  const map = new Map<string, PlacesV1Place>();
  for (const list of lists) {
    for (const item of list) {
      const id = item.id;
      if (!id) continue;
      if (!map.has(id)) map.set(id, item);
    }
  }
  return Array.from(map.values());
}

type TaggedPlace = PlacesV1Place & { __sourceInterest?: "nature" | "history" | "shopping" };

function mergeTaggedByPlaceId(
  lists: Array<{ list: PlacesV1Place[]; sourceInterest?: "nature" | "history" | "shopping" }>,
) {
  const map = new Map<string, TaggedPlace>();
  for (const { list, sourceInterest } of lists) {
    for (const item of list) {
      const id = item.id;
      if (!id) continue;
      if (!map.has(id)) {
        map.set(id, { ...item, __sourceInterest: sourceInterest });
      }
    }
  }
  return Array.from(map.values());
}

function dietBoostScore(name: string, diet?: string) {
  if (!diet) return 0;
  const d = normalizeTr(diet);
  const n = normalizeTr(name);
  const meatHeavy = ["kebap", "kebapçı", "ocakbaşı", "doner", "döner", "steak", "kasap", "et", "burger", "tavuk"];
  const vegHeavy = ["vegan", "vejetaryen", "vegetarian", "salad", "salata", "falafel", "meze", "sebze", "zeytinyağ"];
  const seaHeavy = ["balık", "balik", "seafood", "fish", "midye", "karides", "kalamar"];

  const hasMeat = meatHeavy.some((k) => n.includes(k));
  const hasVeg = vegHeavy.some((k) => n.includes(k));
  const hasSea = seaHeavy.some((k) => n.includes(k));

  if (d === "vegan") {
    if (hasVeg) return 0.7;
    if (hasMeat) return -0.5;
    return 0;
  }
  if (d === "vegetarian") {
    if (hasVeg) return 0.5;
    if (hasMeat) return -0.35;
    return 0;
  }
  if (d === "seafood") {
    if (hasSea) return 0.6;
    if (hasMeat) return -0.1;
    return 0;
  }
  // meat
  if (hasMeat) return 0.5;
  if (hasVeg) return -0.1;
  return 0;
}

function dietMatchFromText(text: string, diet: "meat" | "vegetarian" | "vegan" | "seafood") {
  const t = normalizeTr(text);
  if (diet === "vegan") return /\b(vegan)\b/iu.test(t) || /\b(vejetaryen|vegetarian)\b/iu.test(t);
  if (diet === "vegetarian") return /\b(vejetaryen|vegetarian)\b/iu.test(t) || /\b(salata|salad|falafel|sebze)\b/iu.test(t);
  if (diet === "seafood") return /\b(balık|balik|seafood|fish|midye|karides|kalamar)\b/iu.test(t);
  return /\b(kebap|ocakbaşı|döner|doner|steak|et)\b/iu.test(t);
}

function isMeatHeavyName(name: string) {
  const n = normalizeTr(name);
  const meatSignals = [
    "kebap",
    "kebapçı",
    "kebapci",
    "ocakbaşı",
    "ocakbasi",
    "doner",
    "döner",
    "steak",
    "steakhouse",
    "grill",
    "grillhouse",
    "kasap",
    "burger",
    "butcher",
    "barbecue",
    "bbq",
    "churrasco",
    "asador",
  ];
  return meatSignals.some((k) => n.includes(k));
}

function isVegFriendlyName(name: string) {
  const n = normalizeTr(name);
  const vegSignals = ["vegan", "vejetaryen", "vegetarian", "salad", "salata", "falafel", "plant", "veggie"];
  return vegSignals.some((k) => n.includes(k));
}

// Google Translation v2 (REST) — ücretli ama cost kontrolü için sadece 4-5 kısa yorumu çeviriyoruz.
type TranslateV2Response = {
  data?: {
    translations?: Array<{ translatedText?: string; detectedSourceLanguage?: string }>;
  };
};

async function translateText(
  text: string,
  target: string,
  source?: string,
): Promise<{ translated: string; detectedSource?: string } | null> {
  if (!text || !target) return null;
  const key = requireSecret("GOOGLE_PLACES_API_KEY");
  try {
    const url = `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        q: text,
        target,
        ...(source ? { source } : {}),
        format: "text",
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as TranslateV2Response;
    const t = json.data?.translations?.[0];
    if (!t?.translatedText) return null;
    return { translated: t.translatedText, detectedSource: t.detectedSourceLanguage };
  } catch {
    return null;
  }
}

// "Latin + Türkçe" karakter oranına bakıp metin Türkçe gibi görünüyor mu diye hızlı bir kontrol.
function looksLikeTurkish(text: string) {
  const t = text.toLocaleLowerCase("tr-TR");
  const trTokens = [
    " ve ",
    " bir ",
    " çok ",
    " güzel ",
    " lezzet",
    " harika ",
    " mükemmel",
    " tavsiye",
    " şahane",
    " bayıldım",
    " muhteşem",
    " kebap",
    " pide",
    " döner",
    "ç",
    "ş",
    "ğ",
    "ı",
  ];
  return trTokens.some((k) => t.includes(k));
}


async function placesDetailsV1(placeId: string, languageCode = "tr"): Promise<PlacesV1DetailsResponse> {
  const key = requireSecret("GOOGLE_PLACES_API_KEY");
  const url = `https://places.googleapis.com/v1/places/${placeId}`;
  const fieldMask = ["reviews.text", "reviews.rating"].join(",");

  const res = await fetch(url, {
    headers: {
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": fieldMask,
      "X-Goog-LanguageCode": languageCode,
    },
  });

  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      const j = JSON.parse(text);
      msg = (j?.error?.message as string) ?? text;
    } catch {
      // ignore
    }
    throw new Error(`Google Places hatası: ${msg}`);
  }

  return JSON.parse(text) as PlacesV1DetailsResponse;
}

// Diyet-spesifik yemek sözlükleri — NLP analizinde yorum içinde bunlardan biri
// pozitif bağlamda geçiyorsa restoran "diyet yorum-uyumu" olarak işaretlenir
// ve puanlamada öne çıkarılır.
const dietDishKeywords: Record<"meat" | "vegetarian" | "vegan" | "seafood", readonly string[]> = {
  meat: [
    "steak",
    "ribeye",
    "sirloin",
    "filet mignon",
    "t-bone",
    "wagyu",
    "brisket",
    "short ribs",
    "prime rib",
    "lamb chop",
    "lamb shank",
    "bbq",
    "barbecue",
    "grill",
    "burger",
    "kebap",
    "kebab",
    "adana kebap",
    "urfa kebap",
    "şiş",
    "şiş kebap",
    "tavuk şiş",
    "köfte",
    "döner",
    "doner",
    "iskender",
    "tandır",
    "ali nazik",
    "beyran",
    "kuzu tandır",
    "pirzola",
    "çöp şiş",
    "kokoreç",
    "kasap",
    "churrasco",
    "asado",
    "carnitas",
    "barbacoa",
  ],
  seafood: [
    "fish",
    "balık",
    "balik",
    "salmon",
    "somon",
    "tuna",
    "ton balığı",
    "shrimp",
    "karides",
    "prawn",
    "oyster",
    "istiridye",
    "mussels",
    "midye",
    "midye dolma",
    "calamari",
    "kalamar",
    "octopus",
    "ahtapot",
    "lobster",
    "ıstakoz",
    "crab",
    "yengeç",
    "sushi",
    "sashimi",
    "nigiri",
    "maki",
    "ceviche",
    "poke",
    "paella",
    "bouillabaisse",
    "levrek",
    "çipura",
    "hamsi",
    "ızgara balık",
    "seafood",
  ],
  vegetarian: [
    "salad",
    "salata",
    "caesar salad",
    "caprese",
    "bruschetta",
    "falafel",
    "hummus",
    "baba ghanoush",
    "tabbouleh",
    "dolma",
    "sarma",
    "mercimek çorbası",
    "menemen",
    "gözleme",
    "mantı",
    "pasta",
    "pesto",
    "margherita",
    "risotto",
    "ratatouille",
    "ravioli",
    "gnocchi",
    "lasagna",
    "pizza margherita",
    "veggie",
    "sebze",
    "zeytinyağlı",
    "meze",
    "halloumi",
    "paneer",
  ],
  vegan: [
    "vegan",
    "plant based",
    "plant-based",
    "tofu",
    "tempeh",
    "seitan",
    "quinoa",
    "buddha bowl",
    "smoothie bowl",
    "falafel",
    "hummus",
    "baba ghanoush",
    "tabbouleh",
    "chickpea",
    "lentil",
    "mercimek",
    "edamame",
    "açai",
    "vegetable curry",
    "dal",
    "sebze",
    "zeytinyağlı",
  ],
} as const;

const dishKeywords = [
  // Klasikler
  "künefe",
  "tepsi kebabı",
  "kağıt kebabı",
  "baklava",
  "lahmacun",
  "kebap",
  "adana kebap",
  "urfa kebap",
  "şiş",
  "şiş kebap",
  "tavuk şiş",
  "köfte",
  "burger",
  "steak",
  "döner",
  "tantuni",
  "kokoreç",
  "midye",
  "midye dolma",
  "balık",
  "ızgara balık",
  "karides",
  "kalamar",
  "iskender",
  "pide",
  "kıymalı pide",
  "kuşbaşılı pide",
  "çiğer",
  "ciğer",
  "ciğer şiş",
  "mantı",
  "çiğ köfte",
  "cig kofte",
  "katmer",
  "tandır",
  "ali nazik",
  "beyran",
  "kuzu tandır",
] as const;

const positiveWords = [
  "mükemmel",
  "efsane",
  "harika",
  "çok iyi",
  "lezzetli",
  "tavsiye",
  "bayıldım",
  "muhteşem",
  "şahane",
] as const;

const negativeWords = [
  "kötü",
  "berbat",
  "hayal kırıklığı",
  "soğuk",
  "tatsız",
  "rezalet",
  "vasat",
  "bayat",
] as const;

const contrastRe = /\b(ama|fakat|ancak|yalnız|yine de|ne var ki)\b/giu;
const negationRe = /\b(değil|hiç|asla|yok|olmadı)\b/giu;
const ironyRe = /["'“”‘’](harika|mükemmel|efsane|muhteşem|şahane)["'“”‘’]/giu;

function normalizeTr(s: string) {
  return s
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replace(/\s+/g, " ");
}

function pickMostImportantClause(text: string) {
  const lower = normalizeTr(text);
  const parts = lower.split(contrastRe).map((p) => p.trim()).filter(Boolean);
  // Kontrast varsa genelde son kısım “gerçek” yargıyı taşır.
  return parts.length ? parts[parts.length - 1] : lower;
}

function countHits(haystack: string, needles: readonly string[]) {
  let c = 0;
  for (const n of needles) {
    if (haystack.includes(n)) c += 1;
  }
  return c;
}

function sentimentScore(text: string, rating?: number) {
  const clause = pickMostImportantClause(text);
  const base = normalizeTr(clause);

  // Basit ironi: olumlu kelime tırnak içindeyse negatif baskın.
  const irony = ironyRe.test(base);

  let pos = countHits(base, positiveWords);
  let neg = countHits(base, negativeWords);

  // Negasyon varsa pozitif/negatif etkisini kır.
  const hasNegation = negationRe.test(base);
  if (hasNegation && pos > 0 && neg === 0) {
    // "hiç güzel değil" tarzı
    neg += 1;
    pos = Math.max(0, pos - 1);
  }

  if (irony && pos > 0) {
    neg += pos;
    pos = 0;
  }

  const wordScore = pos === 0 && neg === 0 ? 0 : (pos - neg) / (pos + neg);
  const ratingScore =
    typeof rating === "number" ? Math.max(-1, Math.min(1, (rating - 3) / 2)) : 0;

  const score = wordScore * 0.65 + ratingScore * 0.35;
  if (score > 0.15) return 1;
  if (score < -0.15) return -1;
  return 0;
}

function titleCaseTr(s: string) {
  if (!s) return s;
  return s.charAt(0).toLocaleUpperCase("tr-TR") + s.slice(1);
}

function cleanQuote(input: string) {
  return input
    .replace(/\s+/g, " ")
    .replace(/\u0000/g, "")
    .trim();
}

function truncate(input: string, maxLen: number) {
  if (input.length <= maxLen) return input;
  return `${input.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
}

function analyzeRestaurantLezzet(
  reviews: Array<{ text?: string; rating?: number }>,
  diet?: "meat" | "vegetarian" | "vegan" | "seafood" | null,
): (ItineraryNlpHighlight & { dietReviewScore?: number; dietFamousDish?: boolean }) | undefined {
  const window = reviews.slice(0, 8);
  const stats = new Map<
    string,
    { pos: number; neg: number; mentions: number; bestQuoteScore: number; bestQuote?: string }
  >();

  // Diyete özgü yemek sözlüğünü genel listeye birleştir → diyet seçiliyse bu
  // yemekler de "dish" olarak değerlendirilir.
  const dietDishes = diet ? dietDishKeywords[diet] : [];
  const allDishKeywords = diet ? [...new Set([...dishKeywords, ...dietDishes])] : dishKeywords;

  const positiveQuotes: Array<{ score: number; quote: string }> = [];
  let dietReviewScore = 0; // Yoruma dayalı diyet skoru (pozitif mention sayısı).

  for (const r of window) {
    const text = (r.text ?? "").trim();
    if (!text) continue;
    const lower = normalizeTr(text);
    const s = sentimentScore(lower, r.rating);
    if (s === 0) continue;

    const quote = truncate(cleanQuote(text), 220);
    const quoteScore = (typeof r.rating === "number" ? r.rating : 0) + (s > 0 ? 0.75 : -0.75);
    if (s > 0 && quote.length >= 18) {
      positiveQuotes.push({ score: quoteScore, quote });
    }

    // Diyet ile eşleşen yemekten pozitif bahsediliyorsa diyet skoru yükselsin.
    if (diet && s > 0) {
      for (const dish of dietDishes) {
        if (lower.includes(dish)) {
          dietReviewScore += 1;
          break; // her yorum en fazla 1 puan
        }
      }
    }

    // "porsiyon az ama lezzet harika" gibi cümlelerde yemeği olumlu bağlamdan yakalamak için
    // en önemli clause’a bakıyoruz, ama dish mention full text'ten.
    for (const dish of allDishKeywords) {
      if (!lower.includes(dish)) continue;
      const prev = stats.get(dish) ?? { pos: 0, neg: 0, mentions: 0, bestQuoteScore: -9999 };
      const next = {
        pos: prev.pos + (s > 0 ? 1 : 0),
        neg: prev.neg + (s < 0 ? 1 : 0),
        mentions: prev.mentions + 1,
        bestQuoteScore: prev.bestQuoteScore,
        bestQuote: prev.bestQuote,
      };
      if (s > 0 && quoteScore > next.bestQuoteScore && quote.length >= 18) {
        next.bestQuoteScore = quoteScore;
        next.bestQuote = quote;
      }
      stats.set(dish, {
        pos: next.pos,
        neg: next.neg,
        mentions: next.mentions,
        bestQuoteScore: next.bestQuoteScore,
        bestQuote: next.bestQuote,
      });
    }
  }

  positiveQuotes.sort((a, b) => b.score - a.score);
  const sampleReviews = positiveQuotes.slice(0, 2).map((x) => x.quote);

  let best:
    | { dish: string; pos: number; neg: number; mentions: number; bestQuote?: string }
    | null = null;
  for (const [dish, st] of stats.entries()) {
    if (st.mentions < 1) continue;
    if (!best) best = { dish, ...st };
    else {
      const total = st.pos + st.neg;
      const bestTotal = best.pos + best.neg;
      const score = (st.pos - st.neg) + st.mentions * 0.75 + total * 0.25;
      const bestScore = (best.pos - best.neg) + best.mentions * 0.75 + bestTotal * 0.25;
      if (score > bestScore) best = { dish, ...st };
    }
  }

  // Fallback: yemek yakalayamadıysak bile en iyi gerçek yorumu gösterelim.
  if (!best) {
    if (!sampleReviews.length) return undefined;
    const positivePercent = 80;
    return {
      dishName: "",
      dishNameKey: "fallback",
      positivePercent,
      sampleReview: sampleReviews[0],
      sampleReviews,
      dietReviewScore,
      dietFamousDish: false,
    };
  }

  const total = best.pos + best.neg;
  const positivePercent = total > 0 ? Math.round((best.pos / total) * 100) : 80;
  const dietFamousDish = diet
    ? dietDishKeywords[diet].some((d) => best!.dish.includes(d))
    : false;

  return {
    dishName: titleCaseTr(best.dish),
    positivePercent,
    sampleReview: best.bestQuote ?? sampleReviews[0],
    sampleReviews,
    dietReviewScore,
    dietFamousDish,
  };
}

function inferSubtype(
  types: string[] | undefined,
  name: string | undefined,
  sourceInterest: PlaceSubtype | undefined,
): PlaceSubtype | undefined {
  if (sourceInterest) return sourceInterest;
  const t = (types ?? []).map((x) => x.toLocaleLowerCase("en-US"));
  const set = new Set(t);
  if (Array.from(shoppingTypes).some((x) => set.has(x))) return "shopping";
  if (Array.from(historyTypes).some((x) => set.has(x))) return "history";
  if (Array.from(natureTypes).some((x) => set.has(x))) return "nature";
  if (name && nameLooksLikeShopping(name)) return "shopping";
  return undefined;
}

async function mapResultToPlace(
  r: PlacesV1Place,
  kind: PlaceKind,
  selfBaseUrl: string,
  sourceInterest?: PlaceSubtype,
): Promise<Place | null> {
  const id = r.id;
  const name = r.displayName?.text;
  const lat = r.location?.latitude;
  const lng = r.location?.longitude;
  if (!id || !name || typeof lat !== "number" || typeof lng !== "number") return null;
  const photoName = r.photos?.[0]?.name;
  const subtype = kind === "attraction" ? inferSubtype(r.types, name, sourceInterest) : undefined;
  return {
    placeId: id,
    name,
    kind,
    subtype,
    address: r.formattedAddress,
    rating: r.rating,
    userRatingsTotal: r.userRatingCount,
    photoUrl: photoName ? await buildSignedPhotoUrl(selfBaseUrl, photoName, "800") : undefined,
    lat,
    lng,
  };
}

function normalizePhotoProxyUrl(photoUrl: string | undefined) {
  if (!photoUrl) return undefined;
  return photoUrl
    .replace("/functions/v1/get-smart-itinerary", "/functions/v1/photo-proxy")
    .replace("/functions/v1/place-autocomplete", "/functions/v1/photo-proxy");
}

function normalizePlacePhotoUrls(places: Place[]) {
  return places.map((place) => ({
    ...place,
    photoUrl: normalizePhotoProxyUrl(place.photoUrl),
  }));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<R>,
) {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const idx = nextIndex;
      nextIndex += 1;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx], idx);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

async function enrichRestaurantsWithNlp(
  restaurants: Place[],
  opts: { language?: string; diet?: "meat" | "vegetarian" | "vegan" | "seafood" | null } = {},
) {
  const language = opts.language ?? "tr";
  const diet = opts.diet ?? null;
  const head = restaurants.slice(0, 10);
  const tail = restaurants.slice(10);

  const enriched = await mapWithConcurrency(head, 3, async (p) => {
    try {
      const details = await placesDetailsV1(p.placeId, language);
      const reviews = (details.reviews ?? []).map((r) => ({ text: r.text?.text, rating: r.rating }));
      const highlight = reviews.length ? analyzeRestaurantLezzet(reviews, diet ?? null) : undefined;
      // dietMatch refinement (reviews text)
      const reviewsText = (details.reviews ?? [])
        .map((r) => r.text?.text)
        .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
        .slice(0, 5)
        .join(" ");

      const dietMatch = diet ? dietMatchFromText(`${p.name} ${reviewsText}`, diet) : p.dietMatch;

      let merged: Place = { ...p, dietMatch };

      if (highlight) {
        // Yorum çeviri: heuristic yerine HER ZAMAN Translate API'ye sor.
        // API, detectedSourceLanguage === target ise metni (çoğunlukla) aynen döndürür.
        // Sadece detected !== target ise "translated" flag ile UI rozeti gösteriyoruz.
        let finalHighlight = highlight;
        try {
          const sample = highlight.sampleReview ?? "";
          if (sample && language) {
            const res = await translateText(sample, language);
            if (res?.translated) {
              const detected = (res.detectedSource ?? "").toLocaleLowerCase("en-US");
              const targetLower = language.toLocaleLowerCase("en-US");
              const isDifferent = detected && detected.split("-")[0] !== targetLower;

              finalHighlight = {
                ...highlight,
                sampleReview: res.translated,
                // sampleReviewOriginal sadece dil gerçekten farklıysa set edilsin
                // → UI bu varlığa göre "Çevrildi" rozeti gösteriyor.
                sampleReviewOriginal: isDifferent ? sample : undefined,
                sampleReviewLanguage: isDifferent ? res.detectedSource : undefined,
              };
            }
          }
        } catch {
          // ignore translation errors
        }
        merged = { ...merged, nlpHighlight: finalHighlight };
      }

      return merged;
    } catch {
      return p;
    }
  });

  // Yoruma dayalı diyet re-rank: diyet seçiliyse, yorumlarda diyete uygun
  // yemekten pozitif bahsedilen restoranlar öne çıkar. Aynı zamanda meşhur
  // yemeği de diyete uyuyorsa ekstra boost verilir.
  if (diet) {
    const scoreOf = (pl: Place) => {
      const h = pl.nlpHighlight as (ItineraryNlpHighlight & { dietReviewScore?: number; dietFamousDish?: boolean }) | undefined;
      const reviewScore = h?.dietReviewScore ?? 0;
      const famousBoost = h?.dietFamousDish ? 3 : 0;
      const nameBoost = pl.dietMatch ? 1 : 0;
      return reviewScore * 2 + famousBoost + nameBoost;
    };
    enriched.sort((a, b) => scoreOf(b) - scoreOf(a));
  }

  return [...enriched, ...tail];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return handleOptions(req);
  }

  try {
    const blockedOrigin = ensureBrowserOriginAllowed(req);
    if (blockedOrigin) return blockedOrigin;

    const url = new URL(req.url);

    if (req.method === "GET") {
      const rateLimited = enforceRateLimit(req, "get-smart-itinerary-photo", 120, 60_000);
      if (rateLimited) return rateLimited;

      if (url.searchParams.get("photo_name")) {
        const verified = await verifySignedPhotoRequest(url);
        if (!verified.ok) {
          return jsonResponse(req, { error: verified.error }, verified.status);
        }

        return await proxyPlacePhotoV1(String(verified.photoName), verified.maxwidth, req);
      }
    }

    if (req.method !== "POST") {
      return jsonResponse(req, { error: "Method not allowed" }, 405);
    }

    const rateLimited = enforceRateLimit(req, "get-smart-itinerary-post", 20, 60_000);
    if (rateLimited) return rateLimited;

    const body = (await req.json().catch(() => ({}))) as {
      cityId?: string;
      cityName?: string;
      cityPlaceId?: string;
      cityLat?: number;
      cityLng?: number;
      language?: string;
      regionCode?: string;
      destinationTimeZoneId?: string;
      interests?: unknown;
      tempo?: string;
      diet?: string;
      days?: number;
    };
    const cityName = typeof body.cityName === "string" ? body.cityName.trim() : "";
    const cityId =
      typeof body.cityId === "string" && body.cityId.trim()
        ? body.cityId.trim()
        : typeof body.cityPlaceId === "string" && body.cityPlaceId.trim()
          ? body.cityPlaceId.trim()
          : cityName;
    const language = canonicalLanguageCode(body.language);
    const regionCode = canonicalRegionCode(body.regionCode);
    const tempo = canonicalTempo(body.tempo ?? "fast");
    const interests = canonicalInterests(body.interests);
    const diet = canonicalDiet(body.diet);
    const cityLat = typeof body.cityLat === "number" && Number.isFinite(body.cityLat) ? body.cityLat : undefined;
    const cityLng = typeof body.cityLng === "number" && Number.isFinite(body.cityLng) ? body.cityLng : undefined;
    const cityBias =
      typeof cityLat === "number" && typeof cityLng === "number"
        ? { lat: cityLat, lng: cityLng, radiusMeters: 50000 }
        : undefined;

    if (!cityName) {
      return jsonResponse(req, { error: "cityName zorunlu" }, 400);
    }

    const selfBaseUrl = `https://${new URL(req.url).host}/functions/v1/photo-proxy`;
    const perDay = stopCountForTempo(tempo);
    const daysRaw = typeof body.days === "number" && Number.isFinite(body.days) ? Math.floor(body.days) : 1;
    const days = Math.min(3, Math.max(1, daysRaw));
    const stopCount = perDay * days;

    // Slot dağılımı, seçilen ilgi alanlarına göre belirlenir:
    //   - Hiç interest seçilmezse: default dengeli plan (hem yemek hem gezi).
    //   - Sadece "gastronomy" seçildiyse: tüm durak yemek, attraction aranmaz.
    //   - Gastronomy YOK, diğerleri var: yemek aranmaz, tüm durak gezi.
    //   - İkisi de varsa: ~%30 yemek, geri kalanı gezi.
    const wantsFood = interests.length === 0 || interests.includes("gastronomy");
    const wantsAttractions =
      interests.length === 0 ||
      interests.includes("nature") ||
      interests.includes("history") ||
      interests.includes("shopping");

    let foodCount = 0;
    let placeCount = 0;
    if (wantsFood && !wantsAttractions) {
      foodCount = stopCount;
      placeCount = 0;
    } else if (!wantsFood && wantsAttractions) {
      foodCount = 0;
      placeCount = stopCount;
    } else if (wantsFood && wantsAttractions) {
      foodCount = Math.max(1, Math.round(stopCount * 0.3));
      placeCount = Math.max(0, stopCount - foodCount);
    } else {
      // fallback — interests parse error gibi aşırı uç durum
      foodCount = Math.max(1, Math.round(stopCount * 0.3));
      placeCount = Math.max(0, stopCount - foodCount);
    }

    const cacheCityId = makeCacheCityId(cityId, {
      interests,
      tempo,
      diet,
      language,
      regionCode,
      destinationTimeZoneId: body.destinationTimeZoneId,
      days,
    });

    try {
      const [cachedRestaurants, cachedAttractions] = await Promise.all([
        readCache(cacheCityId, "restaurant"),
        readCache(cacheCityId, "attraction"),
      ]);

      if (cachedRestaurants && cachedAttractions) {
        const normalizedRestaurants = normalizePlacePhotoUrls(cachedRestaurants);
        const normalizedAttractions = normalizePlacePhotoUrls(cachedAttractions);
        const routeRestaurants = normalizedRestaurants.slice(0, foodCount);
        const routeAttractions = normalizedAttractions.slice(0, placeCount);
        const combinedRoute = [...routeAttractions, ...routeRestaurants];
        const orderedStops = orderNearestNeighbor(combinedRoute).slice(0, stopCount);

        return jsonResponse(req, {
          restaurants: normalizedRestaurants,
          attractions: normalizedAttractions,
          orderedStops,
          source: "cache",
        });
      }
    } catch {
      // Cache katmanı sorunluysa Google akışına düş.
    }

    // Interests’e göre attraction aramaları çeşitlensin — her sorgunun hangi
    // interest'ten geldiğini etiketliyoruz ki filter aşamasında hard-elenmesinler.
    const attractionQueryGroups: Array<{
      q: string;
      sourceInterest?: "nature" | "history" | "shopping";
    }> = [];
    if (interests.includes("nature")) {
      attractionQueryGroups.push(
        { q: `parks in ${cityName}`, sourceInterest: "nature" },
        { q: `natural attractions in ${cityName}`, sourceInterest: "nature" },
      );
    }
    if (interests.includes("history")) {
      attractionQueryGroups.push(
        { q: `museums in ${cityName}`, sourceInterest: "history" },
        { q: `historic sites in ${cityName}`, sourceInterest: "history" },
        { q: `church mosque in ${cityName}`, sourceInterest: "history" },
      );
    }
    if (interests.includes("shopping")) {
      attractionQueryGroups.push(
        { q: `best shopping mall in ${cityName}`, sourceInterest: "shopping" },
        { q: `big shopping center in ${cityName}`, sourceInterest: "shopping" },
        { q: `famous bazaar market in ${cityName}`, sourceInterest: "shopping" },
        { q: `popular shopping district in ${cityName}`, sourceInterest: "shopping" },
      );
    }
    // Fallback sorgu SADECE hiç interest seçilmediği zaman eklenir.
    // Aksi halde örn. "sadece Gastronomy" seçimi varsa attraction hiç aranmaz.
    if (attractionQueryGroups.length === 0 && wantsAttractions) {
      attractionQueryGroups.push({ q: `top tourist attractions in ${cityName}` });
    }

    // Diet’e göre restoran sorgusunu özelleştir — özellikle vegan/vegetarian için
    // sadece puana göre listelemek yetmiyor, doğrudan diete uygun mekanları arıyoruz.
    // Eğer kullanıcı gastronomy seçmediyse restoran araması bile yapmıyoruz.
    const restaurantQueries: string[] = [];
    if (!wantsFood) {
      // skip
    } else if (diet === "vegan") {
      restaurantQueries.push(
        `best vegan restaurants in ${cityName}`,
        `plant based restaurants in ${cityName}`,
        `vegetarian restaurants in ${cityName}`,
      );
    } else if (diet === "vegetarian") {
      restaurantQueries.push(
        `best vegetarian restaurants in ${cityName}`,
        `vegan vegetarian restaurants in ${cityName}`,
        `healthy salad restaurants in ${cityName}`,
      );
    } else if (diet === "seafood") {
      restaurantQueries.push(
        `best seafood restaurants in ${cityName}`,
        `fresh fish restaurant in ${cityName}`,
      );
    } else if (diet === "meat") {
      restaurantQueries.push(
        `best steakhouse in ${cityName}`,
        `famous kebab grill restaurants in ${cityName}`,
      );
    } else {
      restaurantQueries.push(`best restaurants in ${cityName}`);
    }

    const restaurantLists = await Promise.all(
      restaurantQueries.map((q) => placesSearchTextV1(q, language || "tr", regionCode, cityBias)),
    );
    const restaurantPlaces = mergeUniqueByPlaceId(restaurantLists);

    const attractionPlaceLists = await Promise.all(
      attractionQueryGroups.map(async (g) => ({
        list: await placesSearchTextV1(g.q, language || "tr", regionCode, cityBias),
        sourceInterest: g.sourceInterest,
      })),
    );

    // GEOGRAPHIC HARD FILTER: Google bazen şehir dışı popüler yerleri döndürüyor
    // (örn. "Paris shopping mall" sorgusuna Londra'dan sonuç). Şehir merkezinden
    // 80 km'den uzak sonuçları ele.
    const MAX_DISTANCE_METERS = 80_000;
    function isWithinCity(pv: PlacesV1Place): boolean {
      if (!cityBias) return true;
      const la = pv.location?.latitude;
      const lo = pv.location?.longitude;
      if (typeof la !== "number" || typeof lo !== "number") return false;
      const d = haversineMeters({ lat: cityBias.lat, lng: cityBias.lng }, { lat: la, lng: lo });
      return d <= MAX_DISTANCE_METERS;
    }

    const mergedAttractions = mergeTaggedByPlaceId(attractionPlaceLists);

    const interestFilters = interests.filter((x) => x !== "gastronomy") as Array<"nature" | "history" | "shopping">;
    const filteredAttractions = mergedAttractions
      .filter((r) => isWithinCity(r))
      .filter((r) =>
        matchesInterestTypes(
          r.types,
          r.displayName?.text,
          interestFilters,
          r.__sourceInterest,
        ),
      )
      .sort((a, b) => scoreCandidate(b.rating, b.userRatingCount) - scoreCandidate(a.rating, a.userRatingCount));

    // Slot'ları seçilen ilgi alanlarına dengeli dağıt — aksi halde yüksek puanlı
    // kategori (örn. Paris'te müze) tüm slotları kapıp "alışveriş" görünmüyor.
    function distributeAttractions(
      sorted: TaggedPlace[],
      groups: Array<"nature" | "history" | "shopping">,
      totalSlots: number,
    ): TaggedPlace[] {
      if (!groups.length || totalSlots <= 0) return sorted.slice(0, totalSlots);

      const untagged = sorted.filter((x) => !x.__sourceInterest);
      const byGroup: Record<string, TaggedPlace[]> = {};
      for (const g of groups) byGroup[g] = [];
      for (const item of sorted) {
        if (item.__sourceInterest && byGroup[item.__sourceInterest]) {
          byGroup[item.__sourceInterest].push(item);
        }
      }

      const chosen: TaggedPlace[] = [];
      const seen = new Set<string>();
      let remaining = totalSlots;

      // Round-robin: her turda her gruptan 1 tane al.
      let progressed = true;
      while (remaining > 0 && progressed) {
        progressed = false;
        for (const g of groups) {
          if (remaining <= 0) break;
          const bucket = byGroup[g];
          while (bucket.length) {
            const next = bucket.shift()!;
            if (next.id && !seen.has(next.id)) {
              seen.add(next.id);
              chosen.push(next);
              remaining -= 1;
              progressed = true;
              break;
            }
          }
        }
      }

      // Kalan slotları untagged / puan sırasıyla doldur.
      if (remaining > 0) {
        for (const item of untagged) {
          if (remaining <= 0) break;
          if (item.id && !seen.has(item.id)) {
            seen.add(item.id);
            chosen.push(item);
            remaining -= 1;
          }
        }
      }
      if (remaining > 0) {
        for (const item of sorted) {
          if (remaining <= 0) break;
          if (item.id && !seen.has(item.id)) {
            seen.add(item.id);
            chosen.push(item);
            remaining -= 1;
          }
        }
      }

      return chosen;
    }

    const distributedAttractions = distributeAttractions(
      filteredAttractions as TaggedPlace[],
      interestFilters,
      Math.max(10, placeCount),
    );

    // Diet’e göre hard-exclude: vegan/vegetarian kullanıcıya et ağırlıklı isim
    // taşıyan restoranları göstermeyelim (isim açıkça veg ipucu taşıyorsa geç).
    const restaurantPlacesFiltered = restaurantPlaces
      .filter((r) => isWithinCity(r))
      .filter((r) => {
        const nm = r.displayName?.text ?? "";
        if (!diet) return true;
        if (diet === "vegan" || diet === "vegetarian") {
          if (isMeatHeavyName(nm) && !isVegFriendlyName(nm)) return false;
        }
        return true;
      });

    const restaurantsSorted = restaurantPlacesFiltered
      .slice()
      .sort((a, b) => {
        const bn = b.displayName?.text ?? "";
        const an = a.displayName?.text ?? "";
        const s1 = scoreCandidate(b.rating, b.userRatingCount) + (diet ? dietBoostScore(bn, diet) : 0);
        const s2 = scoreCandidate(a.rating, a.userRatingCount) + (diet ? dietBoostScore(an, diet) : 0);
        return s1 - s2;
      });

    const restaurants = (await Promise.all(
      restaurantsSorted.map(async (r) => {
        const p = await mapResultToPlace(r, "restaurant", selfBaseUrl);
        if (!p) return null;
        return diet ? { ...p, dietMatch: dietMatchFromText(p.name, diet) } : p;
      }),
    ))
      .filter((x): x is Place => x !== null)
      .slice(0, Math.max(10, foodCount)); // NLP için biraz buffer

    const attractions = (await Promise.all(
      distributedAttractions.map((r) => mapResultToPlace(r, "attraction", selfBaseUrl, r.__sourceInterest)),
    ))
      .filter((x): x is Place => x !== null);

    const data = {
      restaurants: normalizePlacePhotoUrls(
        await enrichRestaurantsWithNlp(restaurants, { language: language || "tr", diet }),
      ),
      attractions: normalizePlacePhotoUrls(attractions),
    };

    try {
      await Promise.all([
        writeCache(cacheCityId, cityName, "restaurant", data.restaurants),
        writeCache(cacheCityId, cityName, "attraction", data.attractions),
      ]);
    } catch {
      // Cache yazımı başarısız olsa da asıl itinerary yanıtını bozma.
    }

    // Bonus: Edge tarafında da (selected) durakları Nearest Neighbor ile sırala.
    const routeRestaurants = (data.restaurants ?? []).slice(0, foodCount);
    const routeAttractions = (data.attractions ?? []).slice(0, placeCount);
    const combinedRoute = [...routeAttractions, ...routeRestaurants];
    const orderedStops = orderNearestNeighbor(combinedRoute).slice(0, stopCount);

    return jsonResponse(req, { ...data, orderedStops, source: "google" });
  } catch (e) {
    return internalError(req, "get-smart-itinerary", e);
  }
});

