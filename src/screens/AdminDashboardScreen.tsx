import { Alert, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { useAuth } from "../hooks/useAuth";
import { fetchAdminDashboard, updateUserPremiumStatus } from "../services/admin";

export function AdminDashboardScreen() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  const dashboardQuery = useQuery({
    queryKey: ["admin-dashboard"] as const,
    queryFn: fetchAdminDashboard,
    enabled: profile?.role === "admin",
  });

  const togglePremiumMutation = useMutation({
    mutationFn: updateUserPremiumStatus,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] });
    },
  });

  if (profile?.role !== "admin") {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-white px-8">
        <Text className="text-center text-base text-zinc-500">{t("admin.forbidden")}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 24, paddingBottom: 40 }}>
        <Text className="text-3xl text-zinc-900" style={{ fontWeight: "900" }}>
          {t("admin.title")}
        </Text>
        <Text className="mt-2 text-base leading-6 text-zinc-500">
          {Platform.OS === "web" ? t("admin.webSubtitle") : t("admin.mobileSubtitle")}
        </Text>

        {dashboardQuery.isLoading ? (
          <Text className="mt-8 text-zinc-500">{t("admin.loading")}</Text>
        ) : dashboardQuery.isError ? (
          <Text className="mt-8 text-zinc-500">
            {dashboardQuery.error instanceof Error ? dashboardQuery.error.message : t("common.unknownError")}
          </Text>
        ) : dashboardQuery.data ? (
          <>
            <View className="mt-8 flex-row flex-wrap">
              {[
                { label: t("admin.users"), value: dashboardQuery.data.summary.users },
                { label: t("admin.premiumUsers"), value: dashboardQuery.data.summary.premiumUsers },
                { label: t("admin.searchEvents"), value: dashboardQuery.data.summary.searchEvents },
                { label: t("admin.savedRoutes"), value: dashboardQuery.data.summary.savedItineraries },
              ].map((item) => (
                <View key={item.label} className="mb-3 w-1/2 pr-2">
                  <View className="rounded-3xl border border-zinc-200 bg-zinc-50 px-4 py-4">
                    <Text className="text-2xl text-zinc-900" style={{ fontWeight: "900" }}>
                      {item.value}
                    </Text>
                    <Text className="mt-1 text-sm text-zinc-500" style={{ fontWeight: "700" }}>
                      {item.label}
                    </Text>
                  </View>
                </View>
              ))}
            </View>

            <View className="mt-6 rounded-3xl border border-zinc-200 bg-white px-5 py-5">
              <Text className="text-lg text-zinc-900" style={{ fontWeight: "900" }}>
                {t("admin.topSelectedCities")}
              </Text>
              {dashboardQuery.data.topSelectedCities.map((city) => (
                <View key={`selected-${city.cityName}`} className="mt-4 flex-row items-center justify-between">
                  <Text className="text-base text-zinc-900" style={{ fontWeight: "700" }}>
                    {city.cityName}
                  </Text>
                  <Text className="text-sm text-zinc-500" style={{ fontWeight: "800" }}>
                    {city.count}
                  </Text>
                </View>
              ))}
            </View>

            <View className="mt-6 rounded-3xl border border-zinc-200 bg-white px-5 py-5">
              <Text className="text-lg text-zinc-900" style={{ fontWeight: "900" }}>
                {t("admin.topSearchedCities")}
              </Text>
              {dashboardQuery.data.topSearchedCities.map((city) => (
                <View key={`searched-${city.cityName}`} className="mt-4 flex-row items-center justify-between">
                  <Text className="text-base text-zinc-900" style={{ fontWeight: "700" }}>
                    {city.cityName}
                  </Text>
                  <Text className="text-sm text-zinc-500" style={{ fontWeight: "800" }}>
                    {city.count}
                  </Text>
                </View>
              ))}
            </View>

            <View className="mt-6 rounded-3xl border border-zinc-200 bg-white px-5 py-5">
              <Text className="text-lg text-zinc-900" style={{ fontWeight: "900" }}>
                {t("admin.recentUsers")}
              </Text>
              {dashboardQuery.data.recentUsers.map((user) => (
                <View key={user.id} className="mt-4 rounded-2xl bg-zinc-50 px-4 py-4">
                  <View className="flex-row items-center justify-between">
                    <View className="flex-1 pr-3">
                      <Text className="text-base text-zinc-900" style={{ fontWeight: "800" }}>
                        {user.fullName || user.email || user.id}
                      </Text>
                      <Text className="mt-1 text-sm text-zinc-500">{user.email ?? "-"}</Text>
                    </View>
                    <Pressable
                      onPress={async () => {
                        try {
                          await togglePremiumMutation.mutateAsync({
                            userId: user.id,
                            isPremium: !user.isPremium,
                          });
                        } catch (error) {
                          Alert.alert(
                            t("admin.updateFailedTitle"),
                            error instanceof Error ? error.message : t("common.unknownError"),
                          );
                        }
                      }}
                      className={[
                        "rounded-full px-3 py-2",
                        user.isPremium ? "bg-zinc-900" : "bg-orange-50",
                      ].join(" ")}
                    >
                      <Text
                        className={user.isPremium ? "text-white" : "text-orange-700"}
                        style={{ fontWeight: "800", fontSize: 12 }}
                      >
                        {user.isPremium ? t("admin.premium") : t("admin.makePremium")}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>

            <View className="mt-6 rounded-3xl border border-zinc-200 bg-white px-5 py-5">
              <Text className="text-lg text-zinc-900" style={{ fontWeight: "900" }}>
                {t("admin.recentSearches")}
              </Text>
              {dashboardQuery.data.recentSearches.map((event) => (
                <View key={event.id} className="mt-4 flex-row items-center justify-between">
                  <View className="flex-1 pr-3">
                    <Text className="text-base text-zinc-900" style={{ fontWeight: "700" }}>
                      {event.cityName || "-"}
                    </Text>
                    <Text className="mt-1 text-sm text-zinc-500">{event.eventType}</Text>
                  </View>
                  <Text className="text-xs text-zinc-400" style={{ fontWeight: "700" }}>
                    {new Date(event.createdAt).toLocaleDateString(i18n.language)}
                  </Text>
                </View>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
