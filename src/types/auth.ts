export type AppRole = "user" | "admin";

export type UserProfile = {
  id: string;
  email: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  role: AppRole;
  isPremium: boolean;
  premiumExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FavoritePlace = {
  id: string;
  placeId: string;
  title: string;
  category: "food" | "place";
  subtype?: "nature" | "history" | "shopping";
  cityId: string | null;
  cityName: string | null;
  lat: number;
  lng: number;
  rating?: number;
  photoUrl?: string;
  createdAt: string;
};

export type SavedItinerary = {
  id: string;
  requestKey: string;
  title: string | null;
  cityId: string;
  cityName: string;
  language: string;
  regionCode: string;
  days: string;
  tempo: string;
  diet: string | null;
  interests: string[];
  itineraryRequestJson: string;
  itineraryItemsJson: string;
  createdAt: string;
  updatedAt: string;
};
