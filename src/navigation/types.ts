import type { ItineraryItem } from "../types/itinerary";
import type { DietOption, InterestOption, PaceOption, TripDaysOption } from "../types/preferences";

export type RootStackParamList = {
  LanguageSelect: { force?: boolean } | undefined;
  Welcome: undefined;
  CitySelect: undefined;
  SignIn: { redirectTo?: "CitySelect" | "Profile" | "AdminDashboard" } | undefined;
  SignUp: { redirectTo?: "CitySelect" | "Profile" | "AdminDashboard" } | undefined;
  VerifyOtp: {
    email: string;
    redirectTo?: "CitySelect" | "Profile" | "AdminDashboard";
  };
  ResetPassword: undefined;
  Profile: undefined;
  AdminDashboard: undefined;
  CustomItineraryBuilder: undefined;
  Preferences: {
    cityId: string;
    cityName: string;
    language: string;
    regionCode: string;
    cityPlaceId?: string;
    cityLat?: number;
    cityLng?: number;
    destinationTimeZoneId?: string;
  };
  ItineraryResult: {
    cityId: string;
    cityName: string;
    language: string;
    regionCode: string;
    cityPlaceId?: string;
    cityLat?: number;
    cityLng?: number;
    destinationTimeZoneId?: string;
    days: TripDaysOption;
    interests: InterestOption[];
    tempo: PaceOption;
    diet?: DietOption;
    // Kayitli/custom rotayi acmak icin onceden cozulmus items.
    preloadedItems?: ItineraryItem[];
    savedItineraryTitle?: string;
  };
};

