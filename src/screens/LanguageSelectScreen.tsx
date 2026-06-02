import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";

import type { RootStackParamList } from "../navigation/types";
import { normalizeLanguage, type SupportedLanguage } from "../i18n";
import { setStoredLanguage } from "../services/language";

type Props = NativeStackScreenProps<RootStackParamList, "LanguageSelect">;

export function LanguageSelectScreen({ navigation, route }: Props) {
  const { t, i18n } = useTranslation();
  const force = Boolean(route.params && (route.params as any).force);

  const selectLanguage = async (lang: SupportedLanguage) => {
    await setStoredLanguage(lang);
    await i18n.changeLanguage(lang);
    if (force) {
      navigation.goBack();
      return;
    }
    navigation.reset({ index: 0, routes: [{ name: "Welcome" }] });
  };

  const current = normalizeLanguage(i18n.language);

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-1 px-6 pt-10">
        <View className="h-14 w-14 items-center justify-center rounded-2xl bg-zinc-900">
          <Text className="text-white" style={{ fontWeight: "800" }}>
            RL
          </Text>
        </View>

        <Text className="mt-6 text-3xl text-zinc-900" style={{ fontWeight: "900" }}>
          {t("language.chooseTitle")}
        </Text>
        <Text className="mt-2 text-base leading-6 text-zinc-500" style={{ fontWeight: "600" }}>
          {t("language.chooseSubtitle")}
        </Text>

        <View className="mt-10">
          <Pressable
            onPress={() => selectLanguage("tr")}
            className={[
              "rounded-3xl border px-5 py-5",
              current === "tr" ? "border-orange-500 bg-orange-50" : "border-zinc-200 bg-white",
            ].join(" ")}
          >
            <Text className="text-base text-zinc-900" style={{ fontWeight: "900" }}>
              {t("language.turkish")}
            </Text>
            <Text className="mt-1 text-sm text-zinc-500" style={{ fontWeight: "600" }}>
              Türkçe
            </Text>
          </Pressable>

          <Pressable
            onPress={() => selectLanguage("en")}
            className={[
              "mt-4 rounded-3xl border px-5 py-5",
              current === "en" ? "border-orange-500 bg-orange-50" : "border-zinc-200 bg-white",
            ].join(" ")}
          >
            <Text className="text-base text-zinc-900" style={{ fontWeight: "900" }}>
              {t("language.english")}
            </Text>
            <Text className="mt-1 text-sm text-zinc-500" style={{ fontWeight: "600" }}>
              English
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

