import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { Ionicons } from "@expo/vector-icons";

import { PrimaryButton } from "../components/PrimaryButton";
import { useAuth } from "../hooks/useAuth";
import type { RootStackParamList } from "../navigation/types";
import { signOutCurrentUser } from "../services/auth";
import { listMyFavorites } from "../services/favorites";
import { updateMyProfile } from "../services/profile";
import { deleteSavedItinerary, listMySavedItineraries } from "../services/savedItineraries";
import type { ItineraryItem, ItineraryRequest } from "../types/itinerary";
import type { DietOption, InterestOption, PaceOption, TripDaysOption } from "../types/preferences";
import type { SavedItinerary } from "../types/auth";

type Props = NativeStackScreenProps<RootStackParamList, "Profile">;

function formatDate(value: string, locale: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(locale);
}

function safeParseJson<T>(value: string, fallback: T): T {
  try {
    const parsed = JSON.parse(value);
    return parsed as T;
  } catch {
    return fallback;
  }
}

function openSavedItinerary(
  item: SavedItinerary,
  navigation: Props["navigation"],
) {
  const items = safeParseJson<ItineraryItem[]>(item.itineraryItemsJson, []);
  const request = safeParseJson<Partial<ItineraryRequest>>(item.itineraryRequestJson, {});
  navigation.navigate("ItineraryResult", {
    cityId: item.cityId,
    cityName: item.cityName,
    language: item.language,
    regionCode: item.regionCode,
    cityPlaceId: request.cityPlaceId,
    cityLat: request.cityLat,
    cityLng: request.cityLng,
    destinationTimeZoneId: request.destinationTimeZoneId,
    days: item.days as TripDaysOption,
    interests: (item.interests as InterestOption[]) ?? [],
    tempo: item.tempo as PaceOption,
    diet: (item.diet as DietOption | null) ?? undefined,
    preloadedItems: items,
    savedItineraryTitle: item.title ?? undefined,
  });
}

export function ProfileScreen({ navigation }: Props) {
  const { t, i18n } = useTranslation();
  const { isLoading, user, profile, refreshProfile } = useAuth();
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState(profile?.fullName ?? "");

  useEffect(() => {
    setFullName(profile?.fullName ?? "");
  }, [profile?.fullName]);

  const [isSaving, setSaving] = useState(false);

  const favoritesQuery = useQuery({
    queryKey: ["profile-favorites", user?.id] as const,
    queryFn: () => listMyFavorites(5),
    enabled: Boolean(user),
  });

  const itinerariesQuery = useQuery({
    queryKey: ["profile-saved-itineraries", user?.id] as const,
    queryFn: () => listMySavedItineraries(5),
    enabled: Boolean(user),
  });

  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-white">
        <Text className="text-zinc-500">{t("profile.loading")}</Text>
      </SafeAreaView>
    );
  }

  if (!user || !profile) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <View className="flex-1 px-6 pt-10">
          <View className="h-14 w-14 items-center justify-center rounded-2xl bg-zinc-900">
            <Text className="text-white" style={{ fontWeight: "800" }}>RL</Text>
          </View>

          <Text className="mt-6 text-3xl text-zinc-900" style={{ fontWeight: "900" }}>
            {t("profile.guestTitle")}
          </Text>
          <Text className="mt-2 text-base leading-6 text-zinc-500">
            {t("profile.guestSubtitle")}
          </Text>

          <View className="mt-10">
            <PrimaryButton
              label={t("auth.signUp")}
              onPress={() => navigation.navigate("SignUp", { redirectTo: "Profile" })}
            />
            <Pressable
              onPress={() => navigation.navigate("SignIn", { redirectTo: "Profile" })}
              className="mt-4 rounded-2xl border border-zinc-200 px-5 py-4"
            >
              <Text className="text-center text-zinc-900" style={{ fontWeight: "800" }}>
                {t("auth.signIn")}
              </Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 24, paddingBottom: 40 }}>
        <Text className="text-3xl text-zinc-900" style={{ fontWeight: "900" }}>
          {t("profile.title")}
        </Text>
        <Text className="mt-2 text-base leading-6 text-zinc-500">
          {t("profile.subtitle")}
        </Text>

        <View className="mt-8 rounded-3xl border border-zinc-200 bg-zinc-50 px-5 py-5">
          <Text className="text-sm text-zinc-500" style={{ fontWeight: "700" }}>
            {t("profile.fullName")}
          </Text>
          <TextInput
            value={fullName}
            onChangeText={setFullName}
            placeholder={t("auth.fullNamePlaceholder")}
            placeholderTextColor="#a1a1aa"
            className="mt-2 rounded-2xl border border-zinc-200 bg-white px-4 py-4 text-base text-zinc-900"
          />

          <Text className="mt-5 text-sm text-zinc-500" style={{ fontWeight: "700" }}>
            {t("profile.email")}
          </Text>
          <Text className="mt-2 text-base text-zinc-900" style={{ fontWeight: "700" }}>
            {profile.email ?? "-"}
          </Text>

          <View className="mt-5 flex-row flex-wrap">
            <View className="mr-2 rounded-full bg-zinc-900 px-3 py-1.5">
              <Text className="text-xs text-white" style={{ fontWeight: "800" }}>
                {profile.isPremium ? t("profile.premium") : t("profile.freePlan")}
              </Text>
            </View>
            <View className="rounded-full bg-orange-50 px-3 py-1.5">
              <Text className="text-xs text-orange-700" style={{ fontWeight: "800" }}>
                {profile.role === "admin" ? t("profile.adminRole") : t("profile.userRole")}
              </Text>
            </View>
          </View>

          <View className="mt-5">
            <PrimaryButton
              label={t("profile.save")}
              loading={isSaving}
              onPress={async () => {
                try {
                  setSaving(true);
                  await updateMyProfile({ fullName });
                  await refreshProfile();
                  Alert.alert(t("profile.savedTitle"), t("profile.savedBody"));
                } catch (error) {
                  Alert.alert(t("profile.saveFailedTitle"), error instanceof Error ? error.message : t("common.unknownError"));
                } finally {
                  setSaving(false);
                }
              }}
            />
          </View>
        </View>

        <Pressable
          onPress={() => navigation.navigate("CustomItineraryBuilder")}
          className="mt-6 flex-row items-center justify-between rounded-3xl bg-zinc-900 px-5 py-5"
        >
          <View className="flex-1 pr-3">
            <Text className="text-base text-white" style={{ fontWeight: "900" }}>
              {t("custom.title")}
            </Text>
            <Text className="mt-1 text-xs text-white/70" style={{ fontWeight: "600" }}>
              {t("custom.subtitle")}
            </Text>
          </View>
          <View className="h-10 w-10 items-center justify-center rounded-full bg-orange-500">
            <Text className="text-lg text-white" style={{ fontWeight: "900" }}>+</Text>
          </View>
        </Pressable>

        <View className="mt-8 rounded-3xl border border-zinc-200 bg-white px-5 py-5">
          <View className="flex-row items-center justify-between">
            <Text className="text-lg text-zinc-900" style={{ fontWeight: "900" }}>
              {t("profile.savedRoutes")}
            </Text>
            <Text className="text-sm text-zinc-500" style={{ fontWeight: "700" }}>
              {itinerariesQuery.data?.length ?? 0}
            </Text>
          </View>
          {(itinerariesQuery.data ?? []).length === 0 ? (
            <Text className="mt-3 text-sm text-zinc-500">{t("profile.emptySavedRoutes")}</Text>
          ) : (
            (itinerariesQuery.data ?? []).map((item) => {
              const isCustom = item.requestKey.startsWith("custom:");
              const itemCount = safeParseJson<ItineraryItem[]>(item.itineraryItemsJson, []).length;
              return (
                <Pressable
                  key={item.id}
                  onPress={() => openSavedItinerary(item, navigation)}
                  className="mt-4 flex-row items-center rounded-2xl bg-zinc-50 px-4 py-4"
                >
                  <View className="flex-1 pr-3">
                    <View className="flex-row items-center">
                      <Text className="text-base text-zinc-900" style={{ fontWeight: "800" }}>
                        {item.title ?? item.cityName}
                      </Text>
                      {isCustom ? (
                        <View className="ml-2 rounded-full bg-orange-100 px-2 py-0.5">
                          <Text className="text-[10px] text-orange-700" style={{ fontWeight: "800" }}>
                            {t("profile.customBadge")}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    <Text className="mt-1 text-sm text-zinc-500">
                      {itemCount} {t("custom.items")} · {formatDate(item.updatedAt, i18n.language)}
                    </Text>
                  </View>
                  <Pressable
                    onPress={(e) => {
                      e.stopPropagation();
                      Alert.alert(
                        t("profile.deleteRouteTitle"),
                        t("profile.deleteRouteBody"),
                        [
                          { text: t("itinerary.edit.removeNo"), style: "cancel" },
                          {
                            text: t("itinerary.edit.removeYes"),
                            style: "destructive",
                            onPress: async () => {
                              try {
                                await deleteSavedItinerary(item.id);
                                await queryClient.invalidateQueries({
                                  queryKey: ["profile-saved-itineraries", user.id],
                                });
                              } catch (err) {
                                Alert.alert(
                                  t("profile.deleteRouteFailed"),
                                  err instanceof Error ? err.message : t("common.unknownError"),
                                );
                              }
                            },
                          },
                        ],
                      );
                    }}
                    hitSlop={8}
                    className="p-2"
                  >
                    <Ionicons name="trash-outline" size={18} color="#dc2626" />
                  </Pressable>
                  <Ionicons name="chevron-forward" size={18} color="#71717a" />
                </Pressable>
              );
            })
          )}
        </View>

        <View className="mt-8 rounded-3xl border border-zinc-200 bg-white px-5 py-5">
          <View className="flex-row items-center justify-between">
            <Text className="text-lg text-zinc-900" style={{ fontWeight: "900" }}>
              {t("profile.favoritePlaces")}
            </Text>
            <Text className="text-sm text-zinc-500" style={{ fontWeight: "700" }}>
              {favoritesQuery.data?.length ?? 0}
            </Text>
          </View>
          {(favoritesQuery.data ?? []).length === 0 ? (
            <Text className="mt-3 text-sm text-zinc-500">{t("profile.emptyFavorites")}</Text>
          ) : (
            (favoritesQuery.data ?? []).map((item) => (
              <View key={item.id} className="mt-4 rounded-2xl bg-zinc-50 px-4 py-4">
                <Text className="text-base text-zinc-900" style={{ fontWeight: "800" }}>
                  {item.title}
                </Text>
                <Text className="mt-1 text-sm text-zinc-500">
                  {item.cityName ?? "-"}
                </Text>
              </View>
            ))
          )}
        </View>

        {profile.role === "admin" ? (
          <Pressable
            onPress={() => navigation.navigate("AdminDashboard")}
            className="mt-8 rounded-2xl border border-orange-200 bg-orange-50 px-5 py-4"
          >
            <Text className="text-center text-orange-700" style={{ fontWeight: "800" }}>
              {t("profile.openAdmin")}
            </Text>
          </Pressable>
        ) : null}

        <Pressable
          onPress={async () => {
            try {
              await signOutCurrentUser();
              navigation.reset({ index: 0, routes: [{ name: "Welcome" }] });
            } catch (error) {
              Alert.alert(t("profile.signOutFailedTitle"), error instanceof Error ? error.message : t("common.unknownError"));
            }
          }}
          className="mt-4 rounded-2xl border border-zinc-200 px-5 py-4"
        >
          <Text className="text-center text-zinc-900" style={{ fontWeight: "800" }}>
            {t("profile.signOut")}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
