export type AdminCityMetric = {
  cityName: string;
  count: number;
};

export type AdminUserSummary = {
  id: string;
  email: string | null;
  fullName: string | null;
  role: "user" | "admin";
  isPremium: boolean;
  createdAt: string;
};

export type AdminSearchEventSummary = {
  id: string;
  eventType: string;
  cityName: string | null;
  createdAt: string;
};

export type AdminDashboardData = {
  summary: {
    users: number;
    premiumUsers: number;
    searchEvents: number;
    savedItineraries: number;
  };
  topSearchedCities: AdminCityMetric[];
  topSelectedCities: AdminCityMetric[];
  recentUsers: AdminUserSummary[];
  recentSearches: AdminSearchEventSummary[];
};
