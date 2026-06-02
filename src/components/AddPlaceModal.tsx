import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import type { ItineraryRequest, UserAddedPlace } from "../types/itinerary";
import { addPlace } from "../services/userEdits";
import {
  autocompletePlaces,
  resolvePlace,
  type PlaceSuggestion,
} from "../services/placeSearch";

type Props = {
  visible: boolean;
  request: ItineraryRequest;
  availableDays: number[];
  defaultDay: number;
  onClose: () => void;
  onAdded: (added: UserAddedPlace) => void | Promise<void>;
};

export function AddPlaceModal({
  visible,
  request,
  availableDays,
  defaultDay,
  onClose,
  onAdded,
}: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<PlaceSuggestion | null>(null);
  const [day, setDay] = useState<number>(defaultDay);
  const [category, setCategory] = useState<"food" | "place">("place");
  const [submitting, setSubmitting] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Modal her açıldığında temizlen.
  useEffect(() => {
    if (visible) {
      setQuery("");
      setSuggestions([]);
      setSelected(null);
      setDay(defaultDay);
      setCategory("place");
    }
  }, [visible, defaultDay]);

  // Debounced autocomplete
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!visible) return;
    if (selected) return; // seçim yapıldıysa arama tetikleme.
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        setSearching(true);
        const res = await autocompletePlaces({
          input: q,
          language: request.language,
          regionCode: request.regionCode,
          cityLat: request.cityLat,
          cityLng: request.cityLng,
        });
        setSuggestions(res);
      } catch {
        setSuggestions([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, visible, selected, request.language, request.regionCode, request.cityLat, request.cityLng]);

  const handleSelectSuggestion = (s: PlaceSuggestion) => {
    setSelected(s);
    setCategory(s.category);
  };

  const handleConfirm = async () => {
    if (!selected || submitting) return;
    setSubmitting(true);
    try {
      const det = await resolvePlace({
        placeId: selected.placeId,
        language: request.language,
        regionCode: request.regionCode,
      });
      const added: UserAddedPlace = {
        placeId: det.placeId,
        name: det.name || selected.description.split(",")[0],
        lat: det.lat,
        lng: det.lng,
        rating: det.rating,
        photoUrl: det.photoUrl,
        category,
        subtype: category === "place" ? det.subtype ?? selected.subtype : undefined,
        day,
        addedAt: new Date().toISOString(),
      };
      // Önce optimistic UI güncellensin, sonra arka planda kayıt
      await onAdded(added);
      addPlace(request, added);
    } catch {
      // Sessizce yut; ileride bir Snackbar eklenebilir.
    } finally {
      setSubmitting(false);
    }
  };

  const headerTitle = useMemo(() => t("itinerary.edit.addPlaceTitle"), [t]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView className="flex-1 bg-white">
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View className="px-5 pt-2">
            <View className="items-center">
              <View className="h-1.5 w-10 rounded-full bg-zinc-200" />
            </View>

            <View className="mt-4 flex-row items-center justify-between">
              <Text className="text-xl text-zinc-900" style={{ fontWeight: "800" }}>
                {headerTitle}
              </Text>
              <Pressable
                onPress={onClose}
                className="h-9 w-9 items-center justify-center rounded-full bg-zinc-100"
              >
                <Ionicons name="close" size={18} color="#18181b" />
              </Pressable>
            </View>

            <View className="mt-4 flex-row items-center rounded-2xl border border-zinc-200 bg-white px-3">
              <Ionicons name="search" size={18} color="#71717a" />
              <TextInput
                className="ml-2 flex-1 py-3 text-base text-zinc-900"
                placeholder={t("itinerary.edit.addPlaceSearchHint")}
                placeholderTextColor="#a1a1aa"
                value={query}
                onChangeText={(text) => {
                  setQuery(text);
                  if (selected) setSelected(null);
                }}
                autoFocus
                returnKeyType="search"
              />
              {searching ? <ActivityIndicator size="small" color="#71717a" /> : null}
            </View>
          </View>

          {/* Seçim yapılmadan önce: öneri listesi */}
          {!selected ? (
            <FlatList
              data={suggestions}
              keyExtractor={(item) => item.placeId}
              keyboardShouldPersistTaps="handled"
              contentContainerClassName="px-5 pb-6 pt-3"
              ItemSeparatorComponent={() => <View className="h-px bg-zinc-100" />}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => handleSelectSuggestion(item)}
                  className="flex-row items-center py-3"
                >
                  <View className="h-10 w-10 items-center justify-center rounded-2xl bg-zinc-100">
                    <Ionicons
                      name={
                        item.category === "food"
                          ? "restaurant-outline"
                          : item.subtype === "shopping"
                          ? "bag-handle-outline"
                          : item.subtype === "nature"
                          ? "leaf-outline"
                          : "camera-outline"
                      }
                      size={18}
                      color="#18181b"
                    />
                  </View>
                  <View className="ml-3 flex-1">
                    <Text className="text-base text-zinc-900" style={{ fontWeight: "700" }}>
                      {item.description.split(",")[0]}
                    </Text>
                    {item.description.includes(",") ? (
                      <Text
                        className="mt-0.5 text-xs text-zinc-500"
                        style={{ fontWeight: "600" }}
                        numberOfLines={1}
                      >
                        {item.description.substring(item.description.indexOf(",") + 1).trim()}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              )}
              ListEmptyComponent={
                query.trim().length >= 2 && !searching ? (
                  <View className="items-center pt-10">
                    <Text className="text-sm text-zinc-500">{t("common.noResults")}</Text>
                  </View>
                ) : null
              }
            />
          ) : (
            // Seçim yapıldı: gün + kategori + onay
            <View className="flex-1 px-5 pt-4">
              <View className="rounded-3xl border border-zinc-200 bg-white p-4">
                <Text className="text-base text-zinc-900" style={{ fontWeight: "800" }}>
                  {selected.description.split(",")[0]}
                </Text>
                {selected.description.includes(",") ? (
                  <Text className="mt-1 text-xs text-zinc-500" style={{ fontWeight: "600" }}>
                    {selected.description.substring(selected.description.indexOf(",") + 1).trim()}
                  </Text>
                ) : null}
              </View>

              {/* Tür seçici */}
              <Text className="mt-5 text-sm text-zinc-500" style={{ fontWeight: "700" }}>
                {t("itinerary.edit.addAsCategory")}
              </Text>
              <View className="mt-2 flex-row">
                {(["place", "food"] as const).map((c) => {
                  const sel = c === category;
                  return (
                    <Pressable
                      key={c}
                      onPress={() => setCategory(c)}
                      className={[
                        "mr-2 rounded-full px-4 py-2",
                        sel ? "bg-zinc-900" : "bg-zinc-100",
                      ].join(" ")}
                    >
                      <Text
                        className={sel ? "text-white" : "text-zinc-700"}
                        style={{ fontWeight: "800", fontSize: 12 }}
                      >
                        {c === "food"
                          ? t("itinerary.edit.addAsFood")
                          : t("itinerary.edit.addAsPlace")}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Gün seçici */}
              {availableDays.length > 1 ? (
                <>
                  <Text className="mt-5 text-sm text-zinc-500" style={{ fontWeight: "700" }}>
                    {t("itinerary.edit.addToDay")}
                  </Text>
                  <View className="mt-2 flex-row flex-wrap">
                    {availableDays.map((d) => {
                      const sel = d === day;
                      return (
                        <Pressable
                          key={d}
                          onPress={() => setDay(d)}
                          className={[
                            "mr-2 mb-2 rounded-full px-4 py-2",
                            sel ? "bg-orange-600" : "bg-zinc-100",
                          ].join(" ")}
                        >
                          <Text
                            className={sel ? "text-white" : "text-zinc-700"}
                            style={{ fontWeight: "800", fontSize: 12 }}
                          >
                            {t("itinerary.dayLabel", { n: d })}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              ) : null}

              <View className="flex-1" />

              <Pressable
                onPress={handleConfirm}
                disabled={submitting}
                className="mb-6 h-12 w-full flex-row items-center justify-center rounded-2xl bg-orange-600"
                style={{ opacity: submitting ? 0.7 : 1 }}
              >
                {submitting ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <>
                    <Ionicons name="add-circle" size={18} color="#ffffff" />
                    <Text className="ml-2 text-white" style={{ fontWeight: "800" }}>
                      {t("itinerary.edit.addConfirm")}
                    </Text>
                  </>
                )}
              </Pressable>
            </View>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
