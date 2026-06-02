import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";

import { normalizeLanguage } from "../i18n";
import type { RootStackParamList } from "../navigation/types";
import { trackSearchEvent } from "../services/analytics";
import { autocompleteCities, resolveCity } from "../services/citySearch";
import { getDeviceRegionCode } from "../services/language";

type Props = NativeStackScreenProps<RootStackParamList, "CitySelect">;

export function CitySelectScreen({ navigation }: Props) {
  const { t, i18n } = useTranslation();
  const language = normalizeLanguage(i18n.language);
  const regionCode = useMemo(() => getDeviceRegionCode(language), [language]);

  const [input, setInput] = useState("");
  const [debounced, setDebounced] = useState("");
  const [isResolving, setResolving] = useState(false);

  useEffect(() => {
    const v = input.trim();
    const h = setTimeout(() => setDebounced(v), 250);
    return () => clearTimeout(h);
  }, [input]);

  const {
    data: suggestions,
    isFetching,
    isError,
    error,
  } = useQuery({
    queryKey: ["city-autocomplete", language, regionCode, debounced] as const,
    enabled: debounced.length >= 2,
    queryFn: () => autocompleteCities({ input: debounced, language, regionCode }),
    staleTime: 1000 * 20,
    retry: 1,
  });

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-1 px-6 pb-10">
        <View className="pt-8">
          <View className="flex-row items-center justify-between">
            <View className="h-14 w-14 items-center justify-center rounded-2xl bg-zinc-900">
              <Text className="text-white" style={{ fontWeight: "800" }}>
                RL
              </Text>
            </View>
            <View className="flex-row items-center">
              <Pressable
                onPress={() => navigation.navigate("Profile")}
                className="mr-2 h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100"
              >
                <Ionicons name="person-outline" size={20} color="#18181b" />
              </Pressable>
              <Pressable
                onPress={() => navigation.navigate("LanguageSelect", { force: true })}
                className="rounded-2xl bg-zinc-100 px-4 py-3"
              >
                <Text className="text-zinc-900" style={{ fontWeight: "800" }}>
                  {language.toUpperCase()}
                </Text>
              </Pressable>
            </View>
          </View>

          <Text className="mt-6 text-3xl text-zinc-900" style={{ fontWeight: "800" }}>
            {t("citySelect.title")}
          </Text>
          <Text className="mt-2 text-base leading-6 text-zinc-500">
            {t("citySelect.subtitle")}
          </Text>
        </View>

        <View className="mt-8">
          <Text className="text-sm text-zinc-500" style={{ fontWeight: "600" }}>
            {t("citySelect.label")}
          </Text>

          <View className="mt-2 flex-row items-center rounded-2xl border border-zinc-200 bg-white px-4 py-3">
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder={t("citySelect.searchPlaceholder")}
              placeholderTextColor="#a1a1aa"
              autoCorrect={false}
              autoCapitalize="none"
              className="flex-1 text-base text-zinc-900"
            />
            {isFetching ? <ActivityIndicator size="small" color="#18181b" /> : null}
          </View>
        </View>

        <View className="mt-6 flex-1">
          <FlatList
            data={suggestions ?? []}
            keyExtractor={(item) => item.placeId}
            keyboardShouldPersistTaps="handled"
            ItemSeparatorComponent={() => <View className="h-2" />}
            renderItem={({ item }) => (
              <Pressable
                disabled={isResolving}
                onPress={async () => {
                  try {
                    setResolving(true);
                    const resolved = await resolveCity({
                      placeId: item.placeId,
                      description: item.description,
                      language,
                      regionCode,
                    });
                    void trackSearchEvent({
                      eventType: "city_selected",
                      cityId: resolved.placeId,
                      cityName: resolved.description,
                      language,
                      regionCode,
                    });
                    navigation.navigate("Preferences", {
                      cityId: resolved.placeId,
                      cityName: resolved.description,
                      language,
                      regionCode,
                      cityPlaceId: resolved.placeId,
                      cityLat: resolved.lat,
                      cityLng: resolved.lng,
                      destinationTimeZoneId: resolved.destinationTimeZoneId ?? undefined,
                    });
                  } finally {
                    setResolving(false);
                  }
                }}
                className="rounded-2xl border border-zinc-200 bg-white px-4 py-4"
              >
                <Text className="text-base text-zinc-900" style={{ fontWeight: "700" }}>
                  {item.description}
                </Text>
              </Pressable>
            )}
            ListEmptyComponent={
              debounced.length >= 2 && !isFetching && isError ? (
                <View className="mt-10 items-center px-6">
                  <Text className="text-center text-zinc-500">
                    {error instanceof Error ? error.message : t("common.unknownError")}
                  </Text>
                </View>
              ) : debounced.length >= 2 && !isFetching ? (
                <View className="mt-10 items-center">
                  <Text className="text-zinc-500">{t("common.noResults")}</Text>
                </View>
              ) : (
                <View className="mt-10 items-center">
                  <Text className="text-zinc-400">{t("citySelect.hint")}</Text>
                </View>
              )
            }
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

