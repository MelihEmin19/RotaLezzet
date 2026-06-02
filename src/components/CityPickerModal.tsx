import { useMemo, useState } from "react";
import {
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

import type { City } from "../types/city";
import { useTranslation } from "react-i18next";

type Props = {
  visible: boolean;
  title?: string;
  cities: City[];
  selectedCityId?: string;
  onSelect: (city: City) => void;
  onClose: () => void;
};

export function CityPickerModal({
  visible,
  title,
  cities,
  selectedCityId,
  onSelect,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const resolvedTitle = title ?? t("citySelect.modalTitle");

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr-TR");
    if (!q) return cities;
    return cities.filter((c) => c.name.toLocaleLowerCase("tr-TR").includes(q));
  }, [cities, query]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView className="flex-1 bg-white">
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
        >
          <View className="px-5 pt-2">
            <View className="items-center">
              <View className="h-1.5 w-10 rounded-full bg-zinc-200" />
            </View>

            <View className="mt-4 flex-row items-center justify-between">
              <Text className="text-xl text-zinc-900" style={{ fontWeight: "700" }}>
                {resolvedTitle}
              </Text>
              <Pressable onPress={onClose} className="rounded-full bg-zinc-100 px-4 py-2">
                <Text className="text-zinc-700" style={{ fontWeight: "600" }}>
                  {t("common.close")}
                </Text>
              </Pressable>
            </View>

            <View className="mt-4 rounded-2xl bg-zinc-100 px-4 py-3">
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={t("common.searchPlaceholder")}
                placeholderTextColor="#71717a"
                autoCorrect={false}
                autoCapitalize="none"
                className="text-base text-zinc-900"
              />
            </View>
          </View>

          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            contentContainerClassName="px-5 py-4"
            ItemSeparatorComponent={() => <View className="h-2" />}
            renderItem={({ item }) => {
              const isSelected = item.id === selectedCityId;
              return (
                <Pressable
                  onPress={() => onSelect(item)}
                  className={[
                    "flex-row items-center justify-between rounded-2xl border px-4 py-4",
                    isSelected ? "border-zinc-900 bg-zinc-50" : "border-zinc-200 bg-white",
                  ].join(" ")}
                >
                  <Text className="text-base text-zinc-900" style={{ fontWeight: "600" }}>
                    {item.name}
                  </Text>
                  {isSelected ? (
                    <Text className="text-zinc-900" style={{ fontWeight: "700" }}>
                      ✓
                    </Text>
                  ) : null}
                </Pressable>
              );
            }}
            ListEmptyComponent={() => (
              <View className="mt-10 items-center">
                <Text className="text-zinc-500">{t("common.noResults")}</Text>
              </View>
            )}
          />
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

