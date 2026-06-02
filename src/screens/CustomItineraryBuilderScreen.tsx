import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";

import { PrimaryButton } from "../components/PrimaryButton";
import { useAuth } from "../hooks/useAuth";
import type { RootStackParamList } from "../navigation/types";
import { withTimeout } from "../services/async";
import {
  autocompleteCities,
  resolveCity,
  type CitySuggestion,
} from "../services/citySearch";
import {
  CITY_RADIUS_KM,
  isPlaceWithinCity,
  makeCustomItineraryItem,
  placeAddressMatchesCity,
  saveCustomItinerary,
  type CustomItineraryDraft,
} from "../services/customItinerary";
import { getDeviceRegionCode } from "../services/language";
import {
  autocompletePlaces,
  resolvePlace,
  type PlaceSuggestion,
} from "../services/placeSearch";
import { optimizeByNearestNeighbor } from "../services/routeOptimizer";
import type { ItineraryItem } from "../types/itinerary";

type Props = NativeStackScreenProps<RootStackParamList, "CustomItineraryBuilder">;

type SelectedCity = {
  cityId: string;
  cityName: string;
  cityPlaceId: string;
  cityLat: number;
  cityLng: number;
  destinationTimeZoneId: string | null;
};

const SUBTYPE_LABEL_KEYS: Record<string, string> = {
  food: "preferences.interest.gastronomy.title",
  nature: "preferences.interest.nature.title",
  history: "preferences.interest.history.title",
  shopping: "preferences.interest.shopping.title",
};

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export function CustomItineraryBuilderScreen({ navigation }: Props) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const language = (i18n.language || "tr").split("-")[0];
  const regionCode = getDeviceRegionCode(language as "tr" | "en");

  const [selectedCity, setSelectedCity] = useState<SelectedCity | null>(null);
  const [cityQuery, setCityQuery] = useState("");
  const [citySuggestions, setCitySuggestions] = useState<CitySuggestion[]>([]);
  const [cityLoading, setCityLoading] = useState(false);
  const debouncedCity = useDebounced(cityQuery, 300);

  const [placeQuery, setPlaceQuery] = useState("");
  const [placeSuggestions, setPlaceSuggestions] = useState<PlaceSuggestion[]>([]);
  const [placeLoading, setPlaceLoading] = useState(false);
  const debouncedPlace = useDebounced(placeQuery, 300);
  const placeRequestId = useRef(0);

  const [items, setItems] = useState<ItineraryItem[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  const [isSaving, setSaving] = useState(false);

  useEffect(() => {
    if (selectedCity) return;
    if (debouncedCity.trim().length < 2) {
      setCitySuggestions([]);
      return;
    }
    let cancelled = false;
    setCityLoading(true);
    withTimeout(
      autocompleteCities({ input: debouncedCity.trim(), language, regionCode }),
      10_000,
      t("common.unknownError"),
    )
      .then((list) => {
        if (!cancelled) setCitySuggestions(list);
      })
      .catch(() => {
        if (!cancelled) setCitySuggestions([]);
      })
      .finally(() => {
        if (!cancelled) setCityLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedCity, language, regionCode, selectedCity, t]);

  useEffect(() => {
    if (!selectedCity) return;
    if (debouncedPlace.trim().length < 2) {
      setPlaceSuggestions([]);
      return;
    }
    const reqId = ++placeRequestId.current;
    setPlaceLoading(true);
    withTimeout(
      autocompletePlaces({
        input: debouncedPlace.trim(),
        language,
        regionCode,
        cityLat: selectedCity.cityLat,
        cityLng: selectedCity.cityLng,
      }),
      10_000,
      t("common.unknownError"),
    )
      .then((list) => {
        if (reqId === placeRequestId.current) setPlaceSuggestions(list);
      })
      .catch(() => {
        if (reqId === placeRequestId.current) setPlaceSuggestions([]);
      })
      .finally(() => {
        if (reqId === placeRequestId.current) setPlaceLoading(false);
      });
  }, [debouncedPlace, language, regionCode, selectedCity, t]);

  const pickCity = async (sug: CitySuggestion) => {
    try {
      setCityLoading(true);
      const resolved = await withTimeout(
        resolveCity({ placeId: sug.placeId, description: sug.description, language, regionCode }),
        10_000,
        t("common.unknownError"),
      );
      setSelectedCity({
        cityId: resolved.placeId,
        cityName: resolved.description,
        cityPlaceId: resolved.placeId,
        cityLat: resolved.lat,
        cityLng: resolved.lng,
        destinationTimeZoneId: resolved.destinationTimeZoneId,
      });
      setCityQuery("");
      setCitySuggestions([]);
    } catch (err) {
      Alert.alert(t("common.unknownError"), err instanceof Error ? err.message : String(err));
    } finally {
      setCityLoading(false);
    }
  };

  const addPlace = async (sug: PlaceSuggestion) => {
    if (!selectedCity) return;
    if (items.some((it) => it.placeId === sug.placeId)) {
      Alert.alert(t("custom.alreadyAddedTitle"), t("custom.alreadyAddedBody"));
      return;
    }
    try {
      setAdding(sug.placeId);
      const resolved = await withTimeout(
        resolvePlace({ placeId: sug.placeId, language, regionCode }),
        10_000,
        t("common.unknownError"),
      );
      const addressMatches = placeAddressMatchesCity(
        resolved.formattedAddress,
        selectedCity.cityName,
      );
      const withinRadius = isPlaceWithinCity(
        { lat: resolved.lat, lng: resolved.lng },
        { lat: selectedCity.cityLat, lng: selectedCity.cityLng },
      );
      // Sıkı kural: adres icerigi sehir adini iceriyor olmali.
      // Adres yoksa yedek olarak radius kontrolu yap.
      const accepted = resolved.formattedAddress
        ? addressMatches
        : withinRadius;
      if (!accepted) {
        Alert.alert(
          t("custom.outsideCityTitle"),
          t("custom.outsideCityBody", { city: selectedCity.cityName, km: CITY_RADIUS_KM }),
        );
        return;
      }
      const newItem = makeCustomItineraryItem({
        placeId: resolved.placeId,
        title: resolved.name || sug.description,
        category: resolved.category,
        subtype: resolved.subtype,
        lat: resolved.lat,
        lng: resolved.lng,
        rating: resolved.rating,
        photoUrl: resolved.photoUrl,
        priceLevel: resolved.priceLevel,
        orderIndex: items.length,
      });
      setItems((prev) => [...prev, newItem]);
      setPlaceQuery("");
      setPlaceSuggestions([]);
    } catch (err) {
      Alert.alert(t("common.unknownError"), err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(null);
    }
  };

  const removeItem = (placeId: string) => {
    setItems((prev) => prev.filter((it) => it.placeId !== placeId));
  };

  const moveItem = (index: number, direction: -1 | 1) => {
    setItems((prev) => {
      const next = prev.slice();
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const promptOptimize = () => {
    if (items.length < 3) return doSave(items);
    Alert.alert(
      t("custom.optimizeTitle"),
      t("custom.optimizeBody"),
      [
        { text: t("custom.optimizeNo"), style: "cancel", onPress: () => doSave(items) },
        {
          text: t("custom.optimizeYes"),
          style: "default",
          onPress: () => {
            const reordered = optimizeByNearestNeighbor(items).map((it, idx) => ({
              ...it,
              id: `${it.placeId}-${idx}`,
            }));
            setItems(reordered);
            doSave(reordered);
          },
        },
      ],
    );
  };

  const doSave = async (finalItems: ItineraryItem[]) => {
    if (!selectedCity) return;
    if (!user) {
      Alert.alert(t("welcome.guestRestrictedTitle"), t("welcome.guestRestrictedBody"));
      return;
    }
    if (finalItems.length === 0) {
      Alert.alert(t("custom.emptyTitle"), t("custom.emptyBody"));
      return;
    }
    try {
      setSaving(true);
      const draft: CustomItineraryDraft = {
        cityId: selectedCity.cityId,
        cityName: selectedCity.cityName,
        language,
        regionCode,
        cityPlaceId: selectedCity.cityPlaceId,
        cityLat: selectedCity.cityLat,
        cityLng: selectedCity.cityLng,
        destinationTimeZoneId: selectedCity.destinationTimeZoneId ?? undefined,
        items: finalItems,
      };
      await withTimeout(saveCustomItinerary(draft), 15_000, t("common.unknownError"));
      Alert.alert(t("custom.savedTitle"), t("custom.savedBody"));
      navigation.goBack();
    } catch (err) {
      Alert.alert(t("custom.saveFailedTitle"), err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const categoryLabel = (item: ItineraryItem) => {
    const key = item.category === "food" ? "food" : item.subtype ?? "place";
    const labelKey = SUBTYPE_LABEL_KEYS[key];
    return labelKey ? t(labelKey) : item.category;
  };

  const grouped = useMemo(() => {
    const groups: Record<string, ItineraryItem[]> = {};
    items.forEach((it) => {
      const key = it.category === "food" ? "food" : it.subtype ?? "place";
      if (!groups[key]) groups[key] = [];
      groups[key].push(it);
    });
    return groups;
  }, [items]);

  return (
    <SafeAreaView className="flex-1 bg-white" edges={["bottom"]}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 160 }}
        >
          <Text className="text-3xl text-zinc-900" style={{ fontWeight: "900" }}>
            {t("custom.title")}
          </Text>
          <Text className="mt-2 text-base leading-6 text-zinc-500">
            {t("custom.subtitle")}
          </Text>

          {!selectedCity ? (
            <View className="mt-8">
              <Text className="text-sm text-zinc-500" style={{ fontWeight: "700" }}>
                {t("custom.cityLabel")}
              </Text>
              <TextInput
                value={cityQuery}
                onChangeText={setCityQuery}
                placeholder={t("citySelect.searchPlaceholder")}
                placeholderTextColor="#a1a1aa"
                className="mt-2 rounded-2xl border border-zinc-200 px-4 py-4 text-base text-zinc-900"
              />
              {cityLoading ? (
                <View className="mt-3 flex-row items-center">
                  <ActivityIndicator size="small" color="#18181b" />
                  <Text className="ml-2 text-sm text-zinc-500">{t("citySelect.hint")}</Text>
                </View>
              ) : null}
              {citySuggestions.map((s) => (
                <Pressable
                  key={s.placeId}
                  onPress={() => pickCity(s)}
                  className="mt-3 rounded-2xl border border-zinc-200 px-4 py-3"
                >
                  <Text className="text-base text-zinc-900" style={{ fontWeight: "700" }}>
                    {s.description}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <>
              <View className="mt-8 flex-row items-center justify-between rounded-3xl bg-zinc-900 px-5 py-4">
                <View className="flex-1">
                  <Text className="text-xs text-orange-300" style={{ fontWeight: "800" }}>
                    {t("custom.cityChip")}
                  </Text>
                  <Text className="mt-1 text-base text-white" style={{ fontWeight: "900" }}>
                    {selectedCity.cityName}
                  </Text>
                </View>
                <Pressable
                  onPress={() => {
                    Alert.alert(
                      t("custom.changeCityTitle"),
                      t("custom.changeCityBody"),
                      [
                        { text: t("preferences.editLater"), style: "cancel" },
                        {
                          text: t("custom.changeCityYes"),
                          style: "destructive",
                          onPress: () => {
                            setSelectedCity(null);
                            setItems([]);
                          },
                        },
                      ],
                    );
                  }}
                  className="rounded-2xl bg-white/10 px-3 py-2"
                >
                  <Text className="text-xs text-white" style={{ fontWeight: "800" }}>
                    {t("custom.change")}
                  </Text>
                </Pressable>
              </View>

              <View className="mt-6">
                <Text className="text-sm text-zinc-500" style={{ fontWeight: "700" }}>
                  {t("custom.searchPlaceLabel")}
                </Text>
                <TextInput
                  value={placeQuery}
                  onChangeText={setPlaceQuery}
                  placeholder={t("itinerary.edit.addPlaceSearchHint")}
                  placeholderTextColor="#a1a1aa"
                  className="mt-2 rounded-2xl border border-zinc-200 px-4 py-4 text-base text-zinc-900"
                />
                {placeLoading ? (
                  <ActivityIndicator size="small" color="#18181b" className="mt-3" />
                ) : null}
                {placeSuggestions.map((s) => {
                  const isAdding = adding === s.placeId;
                  return (
                    <Pressable
                      key={s.placeId}
                      onPress={() => addPlace(s)}
                      disabled={isAdding}
                      className="mt-3 flex-row items-center justify-between rounded-2xl border border-zinc-200 px-4 py-3"
                    >
                      <View className="flex-1 pr-3">
                        <Text className="text-base text-zinc-900" style={{ fontWeight: "700" }}>
                          {s.description}
                        </Text>
                        <Text className="mt-1 text-xs text-zinc-500" style={{ fontWeight: "600" }}>
                          {s.category === "food"
                            ? t("preferences.interest.gastronomy.title")
                            : t(`preferences.interest.${s.subtype ?? "history"}.title`)}
                        </Text>
                      </View>
                      {isAdding ? (
                        <ActivityIndicator size="small" color="#18181b" />
                      ) : (
                        <Ionicons name="add-circle" size={24} color="#ea580c" />
                      )}
                    </Pressable>
                  );
                })}
              </View>

              <View className="mt-8">
                <View className="flex-row items-center justify-between">
                  <Text className="text-lg text-zinc-900" style={{ fontWeight: "900" }}>
                    {t("custom.routeTitle")}
                  </Text>
                  <Text className="text-sm text-zinc-500" style={{ fontWeight: "700" }}>
                    {items.length} {t("custom.items")}
                  </Text>
                </View>

                {items.length === 0 ? (
                  <View className="mt-4 rounded-3xl border border-dashed border-zinc-200 px-5 py-8">
                    <Text className="text-center text-sm text-zinc-500">
                      {t("custom.emptyHint")}
                    </Text>
                  </View>
                ) : (
                  items.map((it, idx) => (
                    <View
                      key={it.id}
                      className="mt-3 flex-row items-center rounded-2xl border border-zinc-200 px-4 py-3"
                    >
                      <View className="mr-3 h-8 w-8 items-center justify-center rounded-full bg-zinc-900">
                        <Text className="text-xs text-white" style={{ fontWeight: "900" }}>
                          {idx + 1}
                        </Text>
                      </View>
                      <View className="flex-1">
                        <Text className="text-base text-zinc-900" style={{ fontWeight: "800" }}>
                          {it.title}
                        </Text>
                        <Text className="mt-0.5 text-xs text-zinc-500" style={{ fontWeight: "600" }}>
                          {categoryLabel(it)}
                          {typeof it.priceLevel === "number" ? ` · ${"$".repeat(Math.max(1, it.priceLevel))}` : ""}
                        </Text>
                      </View>
                      <Pressable
                        onPress={() => moveItem(idx, -1)}
                        disabled={idx === 0}
                        className="mr-1 p-2"
                      >
                        <Ionicons
                          name="chevron-up"
                          size={18}
                          color={idx === 0 ? "#d4d4d8" : "#27272a"}
                        />
                      </Pressable>
                      <Pressable
                        onPress={() => moveItem(idx, 1)}
                        disabled={idx === items.length - 1}
                        className="mr-1 p-2"
                      >
                        <Ionicons
                          name="chevron-down"
                          size={18}
                          color={idx === items.length - 1 ? "#d4d4d8" : "#27272a"}
                        />
                      </Pressable>
                      <Pressable onPress={() => removeItem(it.placeId)} className="p-2">
                        <Ionicons name="trash-outline" size={18} color="#dc2626" />
                      </Pressable>
                    </View>
                  ))
                )}

                {Object.keys(grouped).length > 1 ? (
                  <View className="mt-5 flex-row flex-wrap">
                    {Object.entries(grouped).map(([k, list]) => (
                      <View key={k} className="mr-2 mt-2 rounded-full bg-zinc-100 px-3 py-1.5">
                        <Text className="text-xs text-zinc-700" style={{ fontWeight: "800" }}>
                          {SUBTYPE_LABEL_KEYS[k] ? t(SUBTYPE_LABEL_KEYS[k]) : k} · {list.length}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {selectedCity ? (
        <View
          style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: 16, backgroundColor: "white" }}
          className="border-t border-zinc-100"
        >
          <PrimaryButton
            label={t("custom.save")}
            loading={isSaving}
            disabled={items.length === 0 || isSaving}
            onPress={promptOptimize}
          />
        </View>
      ) : null}
    </SafeAreaView>
  );
}
