import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, FlatList, Image, Linking, Platform, Pressable, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import MapView, { Callout, Marker, Polyline, type Region } from "react-native-maps";
import BottomSheet, { BottomSheetBackdrop } from "@gorhom/bottom-sheet";
import { useTranslation } from "react-i18next";
import DraggableFlatList, {
  ScaleDecorator,
  type RenderItemParams,
} from "react-native-draggable-flatlist";

import { Skeleton } from "../components/Skeleton";
import { useAuth } from "../hooks/useAuth";
import { buildItinerary, recomputeDayTimes } from "../services/dataService";
import type { RootStackParamList } from "../navigation/types";
import type { ItineraryItem, ItineraryRequest } from "../types/itinerary";
import { clearEdits, makeEditKey, removePlace, setDayOrder } from "../services/userEdits";
import { AddPlaceModal } from "../components/AddPlaceModal";
import type { InterestOption, PaceOption } from "../types/preferences";
import { withTimeout } from "../services/async";
import { estimateItineraryBudget, formatBudgetRange } from "../services/budget";
import { isPlaceFavorited, toggleFavoritePlace } from "../services/favorites";
import {
  exportItineraryPdf,
  shareItineraryPdf,
  shareItineraryText,
} from "../services/itineraryShare";
import { requestForegroundUserLocation, type UserLocation } from "../services/location";
import {
  cacheOfflineItinerary,
  getOfflineItinerary,
} from "../services/offlineItinerary";
import { upsertSavedItinerary } from "../services/savedItineraries";
import { trackSearchEvent } from "../services/analytics";

type Props = NativeStackScreenProps<RootStackParamList, "ItineraryResult">;

function interestI18nKey(opt: InterestOption) {
  if (opt === "Tarih") return "preferences.interest.history.title";
  if (opt === "Doğa") return "preferences.interest.nature.title";
  if (opt === "Gastronomi") return "preferences.interest.gastronomy.title";
  return "preferences.interest.shopping.title";
}

function paceI18nKey(opt: PaceOption) {
  if (opt === "Yavaş") return "preferences.pace.slow";
  if (opt === "Dengeli") return "preferences.pace.balanced";
  return "preferences.pace.fast";
}

function getCategoryIconName(item: ItineraryItem): keyof typeof Ionicons.glyphMap {
  if (item.category === "food") return "restaurant-outline";
  if (item.subtype === "shopping") return "bag-handle-outline";
  if (item.subtype === "nature") return "leaf-outline";
  // history veya bilinmeyen → varsayılan (eski davranış)
  return "camera-outline";
}

function resolveDishName(
  h: NonNullable<ItineraryItem["nlpHighlight"]>,
  t: (k: string) => string,
) {
  if (h.dishNameKey === "fallback") return t("itinerary.fallbackDish");
  return h.dishName || t("itinerary.fallbackDish");
}

export function ItineraryResultScreen({ route, navigation }: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const params = route.params;
  const mapRef = useRef<MapView>(null);
  const listRef = useRef<FlatList<ItineraryItem> | null>(null);
  const sheetRef = useRef<BottomSheet>(null);
  const generatedEventRef = useRef<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeDay, setActiveDay] = useState<number>(1);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [tourActive, setTourActive] = useState(false);
  const [tourStopIndex, setTourStopIndex] = useState(0);
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();

  const itineraryRequest: ItineraryRequest = useMemo(
    () => ({
      cityId: params.cityId,
      cityName: params.cityName,
      language: params.language,
      regionCode: params.regionCode,
      cityPlaceId: params.cityPlaceId,
      cityLat: params.cityLat,
      cityLng: params.cityLng,
      destinationTimeZoneId: params.destinationTimeZoneId,
      days: params.days,
      interests: params.interests,
      tempo: params.tempo,
      diet: params.diet,
    }),
    [params],
  );

  const queryKey = useMemo(
    () =>
      [
        "itinerary",
        params.cityId,
        params.language,
        params.regionCode,
        params.destinationTimeZoneId ?? "none",
        params.days,
        params.tempo,
        params.diet ?? "none",
        ...params.interests,
      ] as const,
    [
      params.cityId,
      params.days,
      params.diet,
      params.destinationTimeZoneId,
      params.interests,
      params.language,
      params.regionCode,
      params.tempo,
    ],
  );

  const preloaded = params.preloadedItems;
  const { data, isPending, isError, error, refetch, isFetching } = useQuery({
    queryKey,
    queryFn: async () => {
      // Kayitli/custom rota: items'i dogrudan kullan, Google'a yeniden gitme.
      if (preloaded && preloaded.length) {
        cacheOfflineItinerary(itineraryRequest, preloaded).catch(() => undefined);
        return preloaded;
      }
      try {
        const result = await withTimeout(
          buildItinerary(itineraryRequest),
          25_000,
          "Rota olusturma istegi zaman asimina ugradi.",
        );
        cacheOfflineItinerary(itineraryRequest, result).catch(() => undefined);
        return result;
      } catch (err) {
        const cached = await getOfflineItinerary(itineraryRequest).catch(() => null);
        if (cached && Array.isArray(cached.items) && cached.items.length > 0) {
          return cached.items;
        }
        throw err;
      }
    },
    staleTime: 1000 * 60 * 10,
    retry: 1,
  });

  const invalidateItinerary = async () => {
    await queryClient.invalidateQueries({ queryKey });
  };

  // Belirli bir günün öğelerini optimistic olarak günceller (React Query cache'i değiştirir).
  // Saatler 09:00'dan itibaren yeniden hesaplanır.
  const updateDayOptimistic = (day: number, newDayItems: ItineraryItem[]) => {
    queryClient.setQueryData<ItineraryItem[]>(queryKey, (old) => {
      const others = (old ?? []).filter((it) => it.day !== day);
      const recomputed = recomputeDayTimes(newDayItems, params.tempo);
      return [...others, ...recomputed].sort((a, b) => (a.day ?? 0) - (b.day ?? 0));
    });
  };

  const allItems = data ?? [];
  const showSkeleton = isPending || (isFetching && !data);
  const daysTitle = params.days === "1" ? t("itinerary.days1") : params.days === "2" ? t("itinerary.days2") : t("itinerary.days3p");
  const paceText = t(paceI18nKey(params.tempo));
  const interestsText = params.interests.map((i) => t(interestI18nKey(i))).join(", ");

  const budget = useMemo(() => estimateItineraryBudget(allItems), [allItems]);
  const budgetTotalText = formatBudgetRange({ min: budget.totalMin, max: budget.totalMax });

  // Günlere grupla ve mevcut günleri bul.
  const availableDays = useMemo(() => {
    const set = new Set<number>();
    for (const it of allItems) if (typeof it.day === "number") set.add(it.day);
    return Array.from(set).sort((a, b) => a - b);
  }, [allItems]);

  // Aktif gün değişkeni mevcut günler içinden seçilmiş olsun.
  useEffect(() => {
    if (!availableDays.length) return;
    if (!availableDays.includes(activeDay)) setActiveDay(availableDays[0]);
  }, [availableDays, activeDay]);

  // Sadece aktif günün öğelerini göster.
  const items = useMemo(
    () => allItems.filter((i) => (typeof i.day === "number" ? i.day === activeDay : true)),
    [allItems, activeDay],
  );

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const indexById = useMemo(() => new Map(items.map((i, idx) => [i.id, idx])), [items]);

  const coordinates = useMemo(
    () =>
      items.map((i) => ({ latitude: i.lat, longitude: i.lng, id: i.id, title: i.title, category: i.category })),
    [items],
  );

  const initialRegion: Region | null = useMemo(() => {
    const first = coordinates[0];
    if (!first) return null;
    return {
      latitude: first.latitude,
      longitude: first.longitude,
      latitudeDelta: 0.06,
      longitudeDelta: 0.06,
    };
  }, [coordinates]);

  useEffect(() => {
    if (!initialRegion) return;
    mapRef.current?.animateToRegion(initialRegion, 350);
  }, [initialRegion]);

  useEffect(() => {
    if (coordinates.length < 2) return;
    const id = setTimeout(() => {
      mapRef.current?.fitToCoordinates(
        coordinates.map((c) => ({ latitude: c.latitude, longitude: c.longitude })),
        { edgePadding: { top: 50, right: 50, bottom: 50, left: 50 }, animated: true },
      );
    }, 400);
    return () => clearTimeout(id);
  }, [coordinates]);

  const focusItem = (item: ItineraryItem, opts?: { scroll?: boolean }) => {
    setSelectedId(item.id);
    mapRef.current?.animateToRegion(
      {
        latitude: item.lat,
        longitude: item.lng,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      },
      350,
    );

    if (opts?.scroll !== false) {
      const idx = indexById.get(item.id);
      if (typeof idx === "number") {
        listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.15 });
      }
    }
  };

  const openSheetFor = (item: ItineraryItem) => {
    focusItem(item);
    sheetRef.current?.snapToIndex(1);
  };

  const selectedItem = selectedId ? itemById.get(selectedId) ?? null : null;
  const snapPoints = useMemo(() => [120, 360], []);
  const nextTourItem = items[tourStopIndex] ?? null;

  const favoriteQuery = useQuery({
    queryKey: ["favorite-place", user?.id, selectedItem?.placeId] as const,
    queryFn: () => isPlaceFavorited(selectedItem!.placeId),
    enabled: Boolean(user && selectedItem?.placeId),
  });

  useEffect(() => {
    const requestKey = makeEditKey(itineraryRequest);
    if (!allItems.length || generatedEventRef.current === requestKey) return;
    generatedEventRef.current = requestKey;
    void trackSearchEvent({
      eventType: "itinerary_generated",
      cityId: itineraryRequest.cityId,
      cityName: itineraryRequest.cityName,
      language: itineraryRequest.language,
      regionCode: itineraryRequest.regionCode,
      days: itineraryRequest.days,
      tempo: itineraryRequest.tempo,
      diet: itineraryRequest.diet,
      interests: itineraryRequest.interests,
      metadata: { stops: allItems.length },
    });
  }, [allItems.length, itineraryRequest]);

  const handleSaveItinerary = async () => {
    if (!user) {
      Alert.alert(t("auth.signIn"), t("itinerary.signInForFavorite"), [
        { text: t("itinerary.edit.removeNo"), style: "cancel" },
        {
          text: t("auth.signIn"),
          onPress: () => navigation.navigate("SignIn", { redirectTo: "Profile" }),
        },
      ]);
      return;
    }
    if (!allItems.length) return;
    try {
      const saved = await upsertSavedItinerary(itineraryRequest, allItems);
      if (!saved) return;
      await trackSearchEvent({
        eventType: "itinerary_saved",
        cityId: itineraryRequest.cityId,
        cityName: itineraryRequest.cityName,
        language: itineraryRequest.language,
        regionCode: itineraryRequest.regionCode,
        days: itineraryRequest.days,
        tempo: itineraryRequest.tempo,
        diet: itineraryRequest.diet,
        interests: itineraryRequest.interests,
      });
      await queryClient.invalidateQueries({ queryKey: ["profile-saved-itineraries", user.id] });
      Alert.alert(t("itinerary.savedRouteSuccess"), "");
    } catch (saveError) {
      Alert.alert(
        t("itinerary.planFailedTitle"),
        saveError instanceof Error ? saveError.message : String(saveError),
      );
    }
  };

  const handleGetDirections = async () => {
    if (!selectedItem) return;
    const lat = selectedItem.lat;
    const lng = selectedItem.lng;
    const label = encodeURIComponent(selectedItem.title);

    const primary =
      Platform.OS === "ios"
        ? `maps://?daddr=${lat},${lng}`
        : `geo:${lat},${lng}?q=${lat},${lng}(${label})`;
    const fallback = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&destination_place_id=${encodeURIComponent(
      selectedItem.placeId,
    )}`;

    try {
      const can = await Linking.canOpenURL(primary);
      await Linking.openURL(can ? primary : fallback);
    } catch {
      await Linking.openURL(fallback);
    }
  };

  const handleSharePdf = async () => {
    try {
      if (!allItems.length) return;
      const uri = await exportItineraryPdf({
        cityName: params.cityName,
        items: allItems,
        request: itineraryRequest,
        i18n: {
          titleText: `${params.cityName} · ${daysTitle}`,
          subtitleText: t("itinerary.tempoLine", { tempo: paceText, interests: interestsText }),
          dayLabel: t("itinerary.dayLabel"),
          budgetLabel: t("itinerary.budgetLabel"),
          budgetEstimate: t("itinerary.budgetEstimate"),
          poweredBy: "RotaLezzet",
        },
      });
      await shareItineraryPdf(uri);
    } catch (err) {
      Alert.alert(t("itinerary.shareFailedTitle"), err instanceof Error ? err.message : String(err));
    }
  };

  const handleShareText = async () => {
    try {
      if (!allItems.length) return;
      await shareItineraryText({
        cityName: params.cityName,
        items: allItems,
        language: params.language,
      });
    } catch (err) {
      Alert.alert(t("itinerary.shareFailedTitle"), err instanceof Error ? err.message : String(err));
    }
  };

  const handleShare = () => {
    if (!allItems.length) return;
    Alert.alert(
      t("itinerary.share"),
      "",
      [
        { text: t("itinerary.exportPdf"), onPress: handleSharePdf },
        { text: "Text", onPress: handleShareText },
        { text: t("common.close"), style: "cancel" },
      ],
    );
  };

  const handleStartTour = async () => {
    try {
      const location = await requestForegroundUserLocation();
      if (!location) {
        Alert.alert(t("itinerary.locationPermissionTitle"), t("itinerary.locationPermissionBody"));
        return;
      }

      setUserLocation(location);
      setTourActive(true);
      setTourStopIndex(0);
      const firstItem = items[0];
      if (firstItem) {
        focusItem(firstItem, { scroll: true });
      }
    } catch {
      Alert.alert(t("itinerary.locationPermissionTitle"), t("itinerary.locationUnavailable"));
    }
  };

  const handleGoToNextStop = async () => {
    const item = nextTourItem ?? selectedItem;
    if (!item) return;
    setSelectedId(item.id);
    try {
      const lat = item.lat;
      const lng = item.lng;
      const label = encodeURIComponent(item.title);
      const primary =
        Platform.OS === "ios"
          ? `maps://?daddr=${lat},${lng}`
          : `geo:${lat},${lng}?q=${lat},${lng}(${label})`;
      const fallback = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&destination_place_id=${encodeURIComponent(
        item.placeId,
      )}`;

      const can = await Linking.canOpenURL(primary);
      await Linking.openURL(can ? primary : fallback);
      setTourActive(true);
      setTourStopIndex((prev) => (prev < items.length - 1 ? prev + 1 : prev));
    } catch {
      Alert.alert(t("itinerary.planFailedTitle"), t("itinerary.mapFailed"));
    }
  };

  const handleToggleFavorite = async () => {
    if (!selectedItem) return;
    if (!user) {
      Alert.alert(t("auth.signIn"), t("itinerary.signInForFavorite"), [
        { text: t("itinerary.edit.removeNo"), style: "cancel" },
        {
          text: t("auth.signIn"),
          onPress: () => navigation.navigate("SignIn", { redirectTo: "Profile" }),
        },
      ]);
      return;
    }

    const isFavorite = await toggleFavoritePlace({
      item: selectedItem,
      cityId: params.cityId,
      cityName: params.cityName,
    });

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["favorite-place", user.id, selectedItem.placeId] }),
      queryClient.invalidateQueries({ queryKey: ["profile-favorites", user.id] }),
    ]);

    Alert.alert(
      isFavorite ? t("itinerary.favoriteAdd") : t("itinerary.favoriteRemove"),
      isFavorite ? t("itinerary.favoriteSaved") : t("itinerary.favoriteRemoved"),
    );
  };

  const handleRemoveSelected = () => {
    if (!selectedItem) return;
    const item = selectedItem;
    Alert.alert(
      t("itinerary.edit.removeConfirmTitle"),
      t("itinerary.edit.removeConfirmBody", { title: item.title }),
      [
        { text: t("itinerary.edit.removeNo"), style: "cancel" },
        {
          text: t("itinerary.edit.removeYes"),
          style: "destructive",
          onPress: () => {
            sheetRef.current?.close();
            setSelectedId(null);
            const newDayItems = items.filter((i) => i.placeId !== item.placeId);
            updateDayOptimistic(activeDay, newDayItems);
            removePlace(itineraryRequest, item.placeId, item.source ?? "auto");
          },
        },
      ],
    );
  };

  const handleResetEdits = () => {
    Alert.alert(
      t("itinerary.edit.resetTitle"),
      t("itinerary.edit.resetConfirm"),
      [
        { text: t("itinerary.edit.removeNo"), style: "cancel" },
        {
          text: t("itinerary.edit.resetYes"),
          style: "destructive",
          onPress: async () => {
            await clearEdits(itineraryRequest);
            // Reset için yeniden hesaplama gerekiyor (auto items eski hâline dönmeli)
            await invalidateItinerary();
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      {showSkeleton ? (
        <View className="flex-1 px-6 pt-6">
          <Skeleton className="h-48 w-full rounded-3xl" />
          <Skeleton className="h-4 w-24 rounded-full" />
          <Skeleton className="mt-3 h-10 w-56 rounded-2xl" />
          <Skeleton className="mt-3 h-5 w-72 rounded-2xl" />

          <View className="mt-8">
            {Array.from({ length: 5 }).map((_, idx) => (
              <View key={idx} className="mb-5 flex-row">
                <View className="w-20 pr-3 items-end">
                  <Skeleton className="h-3 w-12 rounded-full" />
                  <Skeleton className="mt-2 h-3 w-12 rounded-full" />
                </View>
                <View className="items-center">
                  <Skeleton className="mt-1 h-3 w-3 rounded-full" />
                  <Skeleton className="mt-2 h-16 w-px" />
                </View>
                <View className="flex-1 pl-3">
                  <Skeleton className="h-24 w-full rounded-3xl" />
                </View>
              </View>
            ))}
          </View>
        </View>
      ) : isError ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-base text-zinc-900" style={{ fontWeight: "800" }}>
            {t("itinerary.planFailedTitle")}
          </Text>
          <Text className="mt-2 text-center text-sm text-zinc-500" style={{ fontWeight: "600" }}>
            {(error as Error)?.message ?? t("common.unknownError")}
          </Text>
          <Pressable
            onPress={() => refetch()}
            className="mt-6 rounded-2xl bg-zinc-900 px-5 py-3"
          >
            <Text className="text-white" style={{ fontWeight: "700" }}>
              {t("itinerary.retry")}
            </Text>
          </Pressable>
        </View>
      ) : (
        <View className="flex-1">
          <View className="px-6 pt-4">
            <View className="overflow-hidden rounded-3xl border border-zinc-200 bg-zinc-100">
              {initialRegion ? (
                <MapView
                  ref={mapRef}
                  style={{ height: 220, width: "100%" }}
                  initialRegion={initialRegion}
                  showsUserLocation={Boolean(userLocation)}
                >
                  {userLocation ? (
                    <Marker
                      coordinate={{
                        latitude: userLocation.latitude,
                        longitude: userLocation.longitude,
                      }}
                      pinColor="#2563eb"
                    />
                  ) : null}
                  {coordinates.map((c, idx) => {
                    const isSelected = selectedId === c.id;
                    return (
                      <Marker
                        key={c.id}
                        coordinate={{ latitude: c.latitude, longitude: c.longitude }}
                        onPress={() => {
                          const item = itemById.get(c.id);
                          if (item) openSheetFor(item);
                        }}
                      >
                        <View
                          className={[
                            "h-8 w-8 items-center justify-center rounded-full border",
                            isSelected ? "border-orange-600 bg-orange-600" : "border-zinc-900 bg-white",
                          ].join(" ")}
                        >
                          <Text className={isSelected ? "text-white" : "text-zinc-900"} style={{ fontWeight: "800" }}>
                            {idx + 1}
                          </Text>
                        </View>
                        <Callout>
                          <View className="max-w-[220px]">
                            <Text className="text-sm text-zinc-900" style={{ fontWeight: "800" }}>
                              {c.title}
                            </Text>
                          </View>
                        </Callout>
                      </Marker>
                    );
                  })}
                  {coordinates.length >= 2 ? (
                    <>
                      <Polyline
                        coordinates={coordinates.map((c) => ({ latitude: c.latitude, longitude: c.longitude }))}
                        strokeColor="rgba(245, 158, 11, 0.25)"
                        strokeWidth={8}
                      />
                      <Polyline
                        coordinates={coordinates.map((c) => ({ latitude: c.latitude, longitude: c.longitude }))}
                        strokeColor="rgba(249, 115, 22, 0.9)"
                        strokeWidth={5}
                      />
                    </>
                  ) : null}
                </MapView>
              ) : (
                <View className="h-[220px] w-full items-center justify-center">
                  <Text className="text-zinc-500">{t("itinerary.mapFailed")}</Text>
                </View>
              )}
            </View>
          </View>

          <DraggableFlatList
            ref={listRef as any}
            data={items}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 140 + insets.bottom }}
            activationDistance={20}
            onDragEnd={({ data }) => {
              // Optimistic: hemen yeni sırayı uygula
              updateDayOptimistic(activeDay, data);
              // Arka planda kalıcı kayıt
              setDayOrder(itineraryRequest, activeDay, data.map((it) => it.placeId));
            }}
            ListHeaderComponent={
              <View className="pt-6 pb-4">
                <View className="flex-row items-center justify-between">
                  <View className="flex-1 pr-3">
                    <Text className="text-sm text-zinc-500" style={{ fontWeight: "700" }}>
                      {params.cityName}
                    </Text>
                    <Text className="mt-2 text-3xl text-zinc-900" style={{ fontWeight: "800" }}>
                      {daysTitle}
                    </Text>
                    <Text className="mt-2 text-base leading-6 text-zinc-500">
                      {t("itinerary.tempoLine", { tempo: paceText, interests: interestsText })}
                    </Text>
                    {allItems.length > 0 ? (
                      <View className="mt-3 flex-row items-center self-start rounded-full bg-orange-50 px-3 py-1.5">
                        <Ionicons name="wallet-outline" size={14} color="#c2410c" />
                        <Text className="ml-1.5 text-xs text-orange-700" style={{ fontWeight: "800" }}>
                          {t("itinerary.budgetLabel")}: {budgetTotalText}
                        </Text>
                        <Text className="ml-1 text-[10px] text-orange-700/70" style={{ fontWeight: "700" }}>
                          {t("itinerary.budgetEstimate")}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <View className="flex-row items-center">
                    {isFetching ? (
                      <View className="mr-2 h-10 w-10 items-center justify-center rounded-2xl bg-zinc-100">
                        <Ionicons name="refresh" size={18} color="#18181b" />
                      </View>
                    ) : null}
                    <Pressable
                      onPress={handleSaveItinerary}
                      disabled={!allItems.length}
                      className="mr-2 h-10 w-10 items-center justify-center rounded-2xl bg-zinc-100"
                    >
                      <Ionicons
                        name="bookmark-outline"
                        size={18}
                        color={allItems.length ? "#18181b" : "#a1a1aa"}
                      />
                    </Pressable>
                    <Pressable
                      onPress={handleShare}
                      disabled={!allItems.length}
                      className="mr-2 h-10 w-10 items-center justify-center rounded-2xl bg-zinc-100"
                    >
                      <Ionicons name="share-outline" size={18} color={allItems.length ? "#18181b" : "#a1a1aa"} />
                    </Pressable>
                    <Pressable
                      onPress={handleResetEdits}
                      className="h-10 w-10 items-center justify-center rounded-2xl bg-zinc-100"
                    >
                      <Ionicons name="refresh-circle-outline" size={20} color="#18181b" />
                    </Pressable>
                  </View>
                </View>

                <View className="mt-3 flex-row items-center">
                  <Ionicons name="reorder-three-outline" size={14} color="#71717a" />
                  <Text className="ml-1 text-[11px] text-zinc-500" style={{ fontWeight: "600" }}>
                    {t("itinerary.edit.reorderHint")}
                  </Text>
                </View>

                <View className="mt-4 flex-row">
                  <Pressable
                    onPress={handleStartTour}
                    className={[
                      "mr-2 flex-1 flex-row items-center justify-center rounded-2xl px-4 py-3",
                      tourActive ? "bg-zinc-900" : "bg-orange-600",
                    ].join(" ")}
                  >
                    <Ionicons name="walk-outline" size={18} color="#ffffff" />
                    <Text className="ml-2 text-white" style={{ fontWeight: "800" }}>
                      {t("itinerary.startTour")}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={handleGoToNextStop}
                    disabled={!items.length}
                    className={[
                      "flex-1 flex-row items-center justify-center rounded-2xl border px-4 py-3",
                      items.length ? "border-zinc-200 bg-white" : "border-zinc-100 bg-zinc-100",
                    ].join(" ")}
                  >
                    <Ionicons name="navigate-outline" size={18} color="#18181b" />
                    <Text className="ml-2 text-zinc-900" style={{ fontWeight: "800" }}>
                      {t("itinerary.nextStop")}
                    </Text>
                  </Pressable>
                </View>

                <Text className="mt-3 text-xs text-zinc-500" style={{ fontWeight: "700" }}>
                  {tourActive
                    ? `${t("itinerary.tourActive")} · ${nextTourItem?.title ?? t("itinerary.nextStop")}`
                    : t("itinerary.tourInactive")}
                </Text>

                {availableDays.length > 1 ? (
                  <View className="mt-4 flex-row">
                    {availableDays.map((d) => {
                      const selected = d === activeDay;
                      return (
                        <Pressable
                          key={d}
                          onPress={() => {
                            setActiveDay(d);
                            setSelectedId(null);
                          }}
                          className={[
                            "mr-2 rounded-full px-4 py-2",
                            selected ? "bg-zinc-900" : "bg-zinc-100",
                          ].join(" ")}
                        >
                          <Text
                            className={selected ? "text-white" : "text-zinc-700"}
                            style={{ fontWeight: "800", fontSize: 12 }}
                          >
                            {t("itinerary.dayLabel", { n: d })}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
              </View>
            }
            ItemSeparatorComponent={() => <View className="h-1" />}
            renderItem={({ item, drag, isActive, getIndex }: RenderItemParams<ItineraryItem>) => {
              const index = getIndex() ?? 0;
              const isLast = index === items.length - 1;
              const hasNlp = item.category === "food" && item.nlpHighlight;
              const isSelected = selectedId === item.id;
              return (
                <ScaleDecorator>
                <View className="flex-row" style={{ opacity: isActive ? 0.85 : 1 }}>
                  <View className="w-20 pr-3 pt-1 items-end">
                    <Text className="text-xs text-zinc-500" style={{ fontWeight: "700" }}>
                      {item.startTime}
                    </Text>
                    <Text className="mt-1 text-xs text-zinc-400" style={{ fontWeight: "700" }}>
                      {item.endTime}
                    </Text>
                  </View>

                  <View className="items-center">
                    <View
                      className={[
                        "mt-2 h-6 w-6 items-center justify-center rounded-full",
                        isSelected ? "bg-orange-600" : "bg-zinc-900",
                      ].join(" ")}
                    >
                      <Text className="text-[10px] text-white" style={{ fontWeight: "800" }}>
                        {index + 1}
                      </Text>
                    </View>
                    {!isLast ? (
                      <View className="mt-1 flex-1 w-px bg-zinc-200" />
                    ) : (
                      <View className="mt-1 h-6 w-px" />
                    )}
                  </View>

                  <View className="flex-1 pl-3 pb-6">
                    <Pressable
                      onPress={() => openSheetFor(item)}
                      onLongPress={drag}
                      delayLongPress={200}
                      disabled={isActive}
                      className={[
                        "relative rounded-3xl border bg-white p-5",
                        isSelected ? "border-orange-400" : "border-zinc-200",
                      ].join(" ")}
                    >
                      {/* Sağ üst: kaldır butonu (her zaman) */}
                      <Pressable
                        onPress={() => {
                          Alert.alert(
                            t("itinerary.edit.removeConfirmTitle"),
                            t("itinerary.edit.removeConfirmBody", { title: item.title }),
                            [
                              { text: t("itinerary.edit.removeNo"), style: "cancel" },
                              {
                                text: t("itinerary.edit.removeYes"),
                                style: "destructive",
                                onPress: () => {
                                  // Optimistic: hemen UI'dan kaldır
                                  const newDayItems = items.filter(
                                    (i) => i.placeId !== item.placeId,
                                  );
                                  updateDayOptimistic(activeDay, newDayItems);
                                  // Arka planda kalıcı kayıt
                                  removePlace(
                                    itineraryRequest,
                                    item.placeId,
                                    item.source ?? "auto",
                                  );
                                },
                              },
                            ],
                          );
                        }}
                        hitSlop={10}
                        className="absolute right-3 top-3 z-10 h-8 w-8 items-center justify-center rounded-full bg-zinc-100"
                      >
                        <Ionicons name="close" size={16} color="#52525b" />
                      </Pressable>

                      {/* Badge'ler (varsa) — × butonun soluna kayıyor */}
                      {item.source === "user" ? (
                        <View className="absolute right-12 top-4 flex-row items-center rounded-full bg-blue-600 px-2.5 py-1">
                          <Ionicons name="person" size={10} color="#ffffff" />
                          <Text className="ml-1 text-[10px] text-white" style={{ fontWeight: "800" }}>
                            {t("itinerary.edit.userBadge")}
                          </Text>
                        </View>
                      ) : item.category === "food" && item.dietMatch ? (
                        <View className="absolute right-12 top-4 rounded-full bg-orange-600 px-2.5 py-1">
                          <Text className="text-[10px] text-white" style={{ fontWeight: "800" }}>
                            {t("itinerary.ideal")}
                          </Text>
                        </View>
                      ) : null}
                      <Text className="text-xs text-zinc-500" style={{ fontWeight: "700" }}>
                        {item.startTime} - {item.endTime}
                      </Text>

                      <View className="mt-3 flex-row items-center">
                        <View className="h-9 w-9 items-center justify-center rounded-2xl bg-zinc-100">
                          <Ionicons name={getCategoryIconName(item)} size={18} color="#18181b" />
                        </View>
                        <Text className="ml-3 flex-1 text-base text-zinc-900" style={{ fontWeight: "800" }}>
                          {item.title}
                        </Text>
                      </View>

                      {hasNlp ? (
                        <View className="mt-4 rounded-2xl bg-zinc-900 px-4 py-3">
                          <Text className="text-xs text-white" style={{ fontWeight: "700" }}>
                            {t("itinerary.analysisTitle")}
                          </Text>
                          <Text className="mt-1 text-sm text-white" style={{ fontWeight: "700" }}>
                            {t("itinerary.analysisText", {
                              dish: resolveDishName(item.nlpHighlight!, t),
                              percent: item.nlpHighlight!.positivePercent,
                            })}
                          </Text>
                          {item.nlpHighlight?.sampleReview ? (
                            <>
                              <Text className="mt-2 text-xs text-white/85" style={{ fontWeight: "600" }}>
                                “{item.nlpHighlight.sampleReview}”
                              </Text>
                              {item.nlpHighlight.sampleReviewOriginal ? (
                                <View className="mt-2 self-start rounded-full bg-white/15 px-2 py-0.5">
                                  <Text className="text-[10px] text-white/90" style={{ fontWeight: "800" }}>
                                    {t("itinerary.translatedBadge")}
                                  </Text>
                                </View>
                              ) : null}
                            </>
                          ) : null}
                        </View>
                      ) : item.category === "food" ? (
                        <View className="mt-4 rounded-2xl bg-zinc-100 px-4 py-3">
                          <Text className="text-xs text-zinc-600" style={{ fontWeight: "700" }}>
                            {t("itinerary.noReview")}
                          </Text>
                        </View>
                      ) : null}
                    </Pressable>
                  </View>
                </View>
                </ScaleDecorator>
              );
            }}
            ListEmptyComponent={
              <View className="mt-10 items-center">
                <Text className="text-zinc-500">{t("itinerary.empty")}</Text>
              </View>
            }
          />

          <BottomSheet
            ref={sheetRef}
            index={selectedItem ? 0 : -1}
            enablePanDownToClose
            snapPoints={snapPoints}
            backgroundStyle={{ backgroundColor: "#ffffff" }}
            handleIndicatorStyle={{ backgroundColor: "#e4e4e7" }}
            backdropComponent={(props) => (
              <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.35} />
            )}
            onClose={() => setSelectedId(null)}
          >
            {selectedItem ? (
              <View className="flex-1 px-6 pb-6">
                {selectedItem.photoUrl ? (
                  <View className="overflow-hidden rounded-3xl bg-zinc-100">
                    <Image
                      source={{ uri: selectedItem.photoUrl }}
                      style={{ height: 160, width: "100%" }}
                      resizeMode="cover"
                    />
                  </View>
                ) : (
                  <View className="h-14 w-14 items-center justify-center rounded-2xl bg-orange-600">
                    <Ionicons name="sparkles" size={20} color="#ffffff" />
                  </View>
                )}

                <Text className="mt-4 text-xl text-zinc-900" style={{ fontWeight: "900" }}>
                  {selectedItem.title}
                </Text>

                <View className="mt-2 flex-row items-center">
                  <View className="rounded-full bg-zinc-100 px-3 py-1.5">
                    <Text className="text-xs text-zinc-700" style={{ fontWeight: "800" }}>
                      {selectedItem.category === "food" ? t("itinerary.categoryFood") : t("itinerary.categoryPlace")}
                    </Text>
                  </View>
                  {typeof selectedItem.rating === "number" ? (
                    <View className="ml-2 flex-row items-center rounded-full bg-zinc-100 px-3 py-1.5">
                      <Ionicons name="star" size={14} color="#f59e0b" />
                      <Text className="ml-1 text-xs text-zinc-700" style={{ fontWeight: "800" }}>
                        {selectedItem.rating.toFixed(1)}
                      </Text>
                    </View>
                  ) : null}
                </View>

                {selectedItem.category === "food" && selectedItem.dietMatch ? (
                  <View className="mt-3 self-start rounded-full bg-orange-600 px-3 py-1.5">
                    <Text className="text-xs text-white" style={{ fontWeight: "800" }}>
                      {t("itinerary.ideal")}
                    </Text>
                  </View>
                ) : null}

                {selectedItem.category === "food" && selectedItem.nlpHighlight ? (
                  <View className="mt-4 rounded-3xl bg-zinc-900 px-5 py-4">
                    <Text className="text-xs text-white" style={{ fontWeight: "800" }}>
                      {t("itinerary.famousDish")}
                    </Text>
                    <Text className="mt-2 text-base text-white" style={{ fontWeight: "800" }}>
                      {resolveDishName(selectedItem.nlpHighlight, t)}
                    </Text>
                    <Text className="mt-1 text-sm text-white/90" style={{ fontWeight: "700" }}>
                      {t("itinerary.positivity", { percent: selectedItem.nlpHighlight.positivePercent })}
                    </Text>
                    {selectedItem.nlpHighlight.sampleReview ? (
                      <View className="mt-4 rounded-2xl bg-white/10 px-4 py-3">
                        <View className="flex-row items-center">
                          <Text className="text-xs text-white/90" style={{ fontWeight: "800" }}>
                            {t("itinerary.realReview")}
                          </Text>
                          {selectedItem.nlpHighlight.sampleReviewOriginal ? (
                            <View className="ml-2 rounded-full bg-white/15 px-2 py-0.5">
                              <Text className="text-[10px] text-white/90" style={{ fontWeight: "800" }}>
                                {t("itinerary.translatedBadge")}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                        <Text className="mt-2 text-xs text-white/85" style={{ fontWeight: "600" }}>
                          “{selectedItem.nlpHighlight.sampleReview}”
                        </Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}

                <View className="mt-6 flex-row">
                  <Pressable
                    onPress={handleGetDirections}
                    className="mr-2 h-12 flex-1 flex-row items-center justify-center rounded-2xl bg-orange-600"
                  >
                    <Ionicons name="navigate" size={18} color="#ffffff" />
                    <Text className="ml-2 text-white" style={{ fontWeight: "800" }}>
                      {t("itinerary.getDirections")}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={handleToggleFavorite}
                    className={[
                      "mr-2 h-12 w-14 items-center justify-center rounded-2xl border bg-white",
                      favoriteQuery.data ? "border-orange-200" : "border-zinc-200",
                    ].join(" ")}
                  >
                    <Ionicons
                      name={favoriteQuery.data ? "heart" : "heart-outline"}
                      size={20}
                      color={favoriteQuery.data ? "#ea580c" : "#18181b"}
                    />
                  </Pressable>
                  <Pressable
                    onPress={handleRemoveSelected}
                    className="h-12 w-14 items-center justify-center rounded-2xl border border-zinc-200 bg-white"
                  >
                    <Ionicons name="trash-outline" size={20} color="#dc2626" />
                  </Pressable>
                </View>
              </View>
            ) : null}
          </BottomSheet>

          <Pressable
            onPress={() => setAddModalOpen(true)}
            className="absolute right-6 h-14 w-14 items-center justify-center rounded-full bg-orange-600"
            style={{
              bottom: 16 + insets.bottom,
              shadowColor: "#000",
              shadowOpacity: 0.18,
              shadowOffset: { width: 0, height: 4 },
              shadowRadius: 10,
              elevation: 6,
            }}
          >
            <Ionicons name="add" size={28} color="#ffffff" />
          </Pressable>

          <AddPlaceModal
            visible={addModalOpen}
            onClose={() => setAddModalOpen(false)}
            request={itineraryRequest}
            availableDays={availableDays.length ? availableDays : [1]}
            defaultDay={activeDay}
            onAdded={(added) => {
              setAddModalOpen(false);
              // Optimistic: yeni öğeyi ilgili günün sonuna ekle, saatleri yeniden hesapla
              const targetDay = added.day;
              const dayItems = (data ?? []).filter(
                (it) => (typeof it.day === "number" ? it.day : 1) === targetDay,
              );
              const newItem: ItineraryItem = {
                id: `${itineraryRequest.cityId}-d${targetDay}-user-${added.placeId}`,
                placeId: added.placeId,
                startTime: "00:00",
                endTime: "00:00",
                title: added.name,
                category: added.category,
                subtype: added.subtype,
                lat: added.lat,
                lng: added.lng,
                rating: added.rating,
                photoUrl: added.photoUrl,
                day: targetDay,
                source: "user",
                pinned: true,
              };
              updateDayOptimistic(targetDay, [...dayItems, newItem]);
              if (targetDay !== activeDay) setActiveDay(targetDay);
            }}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

