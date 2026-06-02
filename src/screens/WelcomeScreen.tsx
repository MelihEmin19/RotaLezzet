import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";

import { PrimaryButton } from "../components/PrimaryButton";
import { useAuth } from "../hooks/useAuth";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "Welcome">;

export function WelcomeScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { enterGuestMode } = useAuth();

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-1 px-6 pt-10">
        <View className="h-16 w-16 items-center justify-center rounded-3xl bg-zinc-900">
          <Text className="text-xl text-white" style={{ fontWeight: "900" }}>
            RL
          </Text>
        </View>

        <Text className="mt-8 text-4xl text-zinc-900" style={{ fontWeight: "900" }}>
          {t("welcome.title")}
        </Text>
        <Text className="mt-3 text-base leading-6 text-zinc-500">
          {t("welcome.subtitle")}
        </Text>

        <View className="mt-12">
          <View className="rounded-3xl border border-zinc-200 bg-zinc-50 px-5 py-5">
            <Text className="text-base text-zinc-900" style={{ fontWeight: "800" }}>
              {t("welcome.featuresTitle")}
            </Text>
            <View className="mt-3">
              <Text className="text-sm text-zinc-600 leading-6">
                {t("welcome.feature1")}
              </Text>
              <Text className="mt-2 text-sm text-zinc-600 leading-6">
                {t("welcome.feature2")}
              </Text>
              <Text className="mt-2 text-sm text-zinc-600 leading-6">
                {t("welcome.feature3")}
              </Text>
            </View>
          </View>
        </View>

        <View className="flex-1 justify-end pb-10">
          <PrimaryButton
            label={t("welcome.signUp")}
            onPress={() =>
              navigation.navigate("SignUp", { redirectTo: "CitySelect" })
            }
          />

          <Pressable
            onPress={() =>
              navigation.navigate("SignIn", { redirectTo: "CitySelect" })
            }
            className="mt-3 rounded-2xl border border-zinc-200 px-5 py-4"
          >
            <Text className="text-center text-zinc-900" style={{ fontWeight: "800" }}>
              {t("welcome.signIn")}
            </Text>
          </Pressable>

          <Pressable
            onPress={async () => {
              await enterGuestMode();
              navigation.reset({ index: 0, routes: [{ name: "CitySelect" }] });
            }}
            className="mt-6 self-center"
          >
            <Text className="text-sm text-zinc-500" style={{ fontWeight: "700" }}>
              {t("welcome.guest")}
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
