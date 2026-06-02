import type { DietOption, InterestOption, PaceOption, TripDaysOption } from "./preferences";

export type ItineraryRequest = {
  cityId: string;
  cityName: string;
  // Faz 0 (global-ready)
  language: string; // e.g. "tr", "en", "de", "ja"
  regionCode: string; // e.g. "TR", "DE", "JP"
  cityPlaceId?: string; // Phase 2: global city search
  cityLat?: number;
  cityLng?: number;
  destinationTimeZoneId?: string; // e.g. "Europe/Istanbul"
  days: TripDaysOption;
  interests: InterestOption[];
  tempo: PaceOption;
  diet?: DietOption;
};

export type ItineraryItemCategory = "food" | "place";

export type ItineraryItemSubtype = "nature" | "history" | "shopping";

export type ItineraryNlpHighlight = {
  dishName: string;
  positivePercent: number;
  sampleReview?: string;
  sampleReviews?: string[];
  // Edge Function spesifik yemek bulamadığında "fallback" marker döner;
  // UI bu anahtarı i18n’den çözer (örn. "Öne Çıkan Lezzet" / "Featured Flavor").
  dishNameKey?: "fallback";
  // Orijinal yorum dili farklıysa UI'da "orijinali göster" butonu için kullanılabilir.
  sampleReviewOriginal?: string;
  sampleReviewLanguage?: string;
};

export type ItineraryItem = {
  id: string;
  placeId: string;
  startTime: string;
  endTime: string;
  title: string;
  category: ItineraryItemCategory;
  subtype?: ItineraryItemSubtype;
  lat: number;
  lng: number;
  rating?: number;
  photoUrl?: string;
  // Google Places price_level (0-4) - Faz C1 butce tahmini icin
  priceLevel?: number;
  dietMatch?: boolean;
  nlpHighlight?: ItineraryNlpHighlight;
  day?: number; // 1, 2, 3... çok günlük plan için.
  // Kullanıcı düzenleme katmanı:
  // - "auto" : algoritma tarafından eklendi (silindiğinde geri gelmesin)
  // - "user" : kullanıcı elle ekledi (yeniden hesaplamada korunsun)
  source?: "auto" | "user";
  pinned?: boolean;
};

// Kullanıcının elle eklediği yer; itinerary overlay aşamasında time slot'a oturtulur.
export type UserAddedPlace = {
  placeId: string;
  name: string;
  lat: number;
  lng: number;
  category: ItineraryItemCategory;
  subtype?: ItineraryItemSubtype;
  rating?: number;
  photoUrl?: string;
  day: number;          // hangi güne eklendi
  preferredHour?: number; // 0-23 arası, opsiyonel: yoksa otomatik slot
  addedAt: string;      // ISO timestamp
};

export type UserItineraryEdits = {
  // editKey -> { addedPlaces, removedPlaceIds, customOrder }
  // editKey: cityId+days+interests+tempo+diet+language birleşimi
  addedPlaces: UserAddedPlace[];
  removedPlaceIds: string[];
  // dayIndex (1-based) -> sıralı placeId listesi (varsa override eder)
  customOrder?: Record<number, string[]>;
};

