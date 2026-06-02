import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";

import { PrimaryButton } from "../components/PrimaryButton";
import type { RootStackParamList } from "../navigation/types";
import type { DietOption, InterestOption, PaceOption, TripDaysOption } from "../types/preferences";

type Props = NativeStackScreenProps<RootStackParamList, "Preferences">;

const interestOptions: InterestOption[] = ["Tarih", "Doğa", "Gastronomi", "Alışveriş"];
const paceOptions: PaceOption[] = ["Yavaş", "Dengeli", "Yoğun"];
const dietOptions: DietOption[] = ["Etçil", "Vejetaryen", "Vegan", "Deniz Ürünleri"];

function interestI18nKey(opt: InterestOption) {
  if (opt === "Tarih") return "preferences.interest.history";
  if (opt === "Doğa") return "preferences.interest.nature";
  if (opt === "Gastronomi") return "preferences.interest.gastronomy";
  return "preferences.interest.shopping";
}

function paceI18nKey(opt: PaceOption) {
  if (opt === "Yavaş") return "preferences.pace.slow";
  if (opt === "Dengeli") return "preferences.pace.balanced";
  return "preferences.pace.fast";
}

function dietI18nKey(opt: DietOption) {
  if (opt === "Etçil") return "preferences.diet.meat";
  if (opt === "Vejetaryen") return "preferences.diet.vegetarian";
  if (opt === "Vegan") return "preferences.diet.vegan";
  return "preferences.diet.seafood";
}

export function PreferencesScreen({ route, navigation }: Props) {
  const { t, i18n } = useTranslation();
  const city = route.params;
  const [days, setDays] = useState<TripDaysOption | null>(null);
  const [pace, setPace] = useState<PaceOption | null>(null);
  const [interests, setInterests] = useState<InterestOption[]>([]);
  const [diet, setDiet] = useState<DietOption | null>(null);
  const [isGenerating, setGenerating] = useState(false);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);

  const isReady = Boolean(days && pace && interests.length > 0);

  useEffect(() => {
    if (!isGenerating) return;

    setLoadingMessageIndex(0);
    const timers: Array<ReturnType<typeof setTimeout>> = [];

    timers.push(
      setTimeout(() => setLoadingMessageIndex(1), 900),
      setTimeout(() => setLoadingMessageIndex(2), 1800),
      setTimeout(() => {
        if (!days || !pace || interests.length === 0) return;
        navigation.replace("ItineraryResult", {
          cityId: city.cityId,
          cityName: city.cityName,
          language: city.language,
          regionCode: city.regionCode,
          cityPlaceId: city.cityPlaceId,
          cityLat: city.cityLat,
          cityLng: city.cityLng,
          destinationTimeZoneId: city.destinationTimeZoneId,
          days,
          interests,
          tempo: pace,
          diet: diet ?? undefined,
        });
      }, 2600),
    );

    return () => {
      timers.forEach((t) => clearTimeout(t));
    };
  }, [city.cityId, city.cityName, days, diet, interests, isGenerating, navigation, pace]);

  const toggleInterest = (key: InterestOption) => {
    setInterests((prev) => {
      if (prev.includes(key)) return prev.filter((x) => x !== key);
      return [...prev, key];
    });
  };

  const loadingMessages = [
    t("preferences.loading.msg1"),
    t("preferences.loading.msg2"),
    t("preferences.loading.msg3"),
  ] as const;

  const daysLabel = (opt: TripDaysOption) => {
    const lang = (i18n.language ?? "tr").toLowerCase();
    if (lang.startsWith("en")) {
      if (opt === "1") return "1 day";
      if (opt === "2") return "2 days";
      return "3+ days";
    }
    return `${opt} ${t("preferences.daysSuffix")}`;
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView contentContainerClassName="px-6 pb-10" showsVerticalScrollIndicator={false}>
        <View className="pt-6">
          <Text className="text-3xl text-zinc-900" style={{ fontWeight: "800" }}>
            {t("preferences.title")}
          </Text>
          <Text className="mt-2 text-base leading-6 text-zinc-500">
            {t("preferences.subtitle", { city: city.cityName })}
          </Text>
        </View>

        <View className="mt-10">
          <Text className="text-sm text-zinc-500" style={{ fontWeight: "700" }}>
            {t("preferences.daysTitle")}
          </Text>

          <View className="mt-3 flex-row">
            {(["1", "2", "3+"] as const).map((opt) => {
              const isSelected = days === opt;
              return (
                <Pressable
                  key={opt}
                  onPress={() => setDays(opt)}
                  className={[
                    "mr-2 flex-1 items-center justify-center rounded-2xl border px-4 py-4",
                    isSelected ? "border-zinc-900 bg-zinc-900" : "border-zinc-200 bg-white",
                  ].join(" ")}
                >
                  <Text className={isSelected ? "text-white" : "text-zinc-900"} style={{ fontWeight: "700" }}>
                    {daysLabel(opt)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View className="mt-10">
          <Text className="text-sm text-zinc-500" style={{ fontWeight: "700" }}>
            {t("preferences.interestsTitle")}
          </Text>
          <Text className="mt-2 text-sm leading-5 text-zinc-400">
            {t("preferences.interestsHint")}
          </Text>

          <View className="mt-4 flex-row flex-wrap">
            {interestOptions.map((opt) => {
              const isSelected = interests.includes(opt);
              const base = interestI18nKey(opt);
              return (
                <Pressable
                  key={opt}
                  onPress={() => toggleInterest(opt)}
                  className={[
                    "mb-3 w-1/2 pr-2",
                    opt === "Doğa" || opt === "Alışveriş" ? "pl-2 pr-0" : "",
                  ].join(" ")}
                >
                  <View
                    className={[
                      "rounded-2xl border px-4 py-4",
                      isSelected ? "border-zinc-900 bg-zinc-50" : "border-zinc-200 bg-white",
                    ].join(" ")}
                  >
                    <Text className="text-base text-zinc-900" style={{ fontWeight: "700" }}>
                      {t(`${base}.title`)}
                    </Text>
                    <Text className="mt-1 text-xs text-zinc-500" style={{ fontWeight: "600" }}>
                      {t(`${base}.subtitle`)}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View className="mt-10">
          <Text className="text-sm text-zinc-500" style={{ fontWeight: "700" }}>
            {t("preferences.paceTitle")}
          </Text>

          <View className="mt-3">
            {paceOptions.map((opt) => {
              const isSelected = pace === opt;
              return (
                <Pressable
                  key={opt}
                  onPress={() => setPace(opt)}
                  className={[
                    "mb-2 flex-row items-center justify-between rounded-2xl border px-4 py-4",
                    isSelected ? "border-zinc-900 bg-zinc-50" : "border-zinc-200 bg-white",
                  ].join(" ")}
                >
                  <Text className="text-base text-zinc-900" style={{ fontWeight: "700" }}>
                    {t(paceI18nKey(opt))}
                  </Text>
                  {isSelected ? (
                    <Text className="text-zinc-900" style={{ fontWeight: "800" }}>
                      ✓
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </View>

        <View className="mt-10">
          <Text className="text-sm text-zinc-500" style={{ fontWeight: "700" }}>
            {t("preferences.dietTitle")}
          </Text>
          <Text className="mt-2 text-sm leading-5 text-zinc-400">
            {t("preferences.dietHint")}
          </Text>

          <View className="mt-4 flex-row flex-wrap">
            {dietOptions.map((opt, idx) => {
              const isSelected = diet === opt;
              const isRightColumn = idx % 2 === 1;
              return (
                <Pressable
                  key={opt}
                  onPress={() => setDiet((prev) => (prev === opt ? null : opt))}
                  className={["mb-3 w-1/2", isRightColumn ? "pl-2 pr-0" : "pr-2"].join(" ")}
                >
                  <View
                    className={[
                      "rounded-2xl border px-4 py-4",
                      isSelected ? "border-orange-600 bg-orange-50" : "border-zinc-200 bg-white",
                    ].join(" ")}
                  >
                    <Text className="text-base text-zinc-900" style={{ fontWeight: "800" }}>
                      {t(dietI18nKey(opt))}
                    </Text>
                    <Text className="mt-1 text-xs text-zinc-500" style={{ fontWeight: "600" }}>
                      {isSelected ? t("common.selected") : t("common.select")}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View className="mt-10">
          <PrimaryButton
            label={t("preferences.build")}
            disabled={!isReady || isGenerating}
            loading={isGenerating}
            onPress={() => {
              if (!isReady || !days || !pace) return;
              setGenerating(true);
            }}
          />
          <Text className="mt-4 text-center text-xs text-zinc-400">
            {t("preferences.editLater")}
          </Text>
        </View>
      </ScrollView>

      {isGenerating ? (
        <View className="absolute inset-0 items-center justify-center bg-white/95 px-8">
          <View className="w-full max-w-md rounded-3xl border border-zinc-200 bg-white px-6 py-8">
            <View className="items-center">
              <ActivityIndicator size="large" color="#18181b" />
              <Text className="mt-5 text-base text-zinc-900" style={{ fontWeight: "700" }}>
                {loadingMessages[loadingMessageIndex]}
              </Text>
              <Text className="mt-2 text-sm text-zinc-500" style={{ fontWeight: "600" }}>
                {t("preferences.loading.hint")}
              </Text>
            </View>

            <View className="mt-6 flex-row items-center justify-center">
              {loadingMessages.map((_, idx) => {
                const isActive = idx === loadingMessageIndex;
                return (
                  <View
                    key={idx}
                    className={[
                      "mx-1 h-2 w-2 rounded-full",
                      isActive ? "bg-zinc-900" : "bg-zinc-200",
                    ].join(" ")}
                  />
                );
              })}
            </View>
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

