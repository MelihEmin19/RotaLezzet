import type { ItineraryNlpHighlight } from "./itinerary";

export type PlaceKind = "restaurant" | "attraction";

// Attraction için alt-kategori — UI'da farklı ikon göstermek için (müze/AVM/park).
export type PlaceSubtype = "nature" | "history" | "shopping";

export type Place = {
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

