import { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";

import { PrimaryButton } from "../components/PrimaryButton";
import type { RootStackParamList } from "../navigation/types";
import { getAuthErrorMessage, updatePassword } from "../services/auth";

type Props = NativeStackScreenProps<RootStackParamList, "ResetPassword">;

export function ResetPasswordScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [isSubmitting, setSubmitting] = useState(false);

  const isReady = password.length >= 6 && password === confirm;

  return (
    <SafeAreaView className="flex-1 bg-white">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          <View className="pt-10">
            <Text className="text-3xl text-zinc-900" style={{ fontWeight: "900" }}>
              {t("auth.resetPasswordTitle")}
            </Text>
            <Text className="mt-2 text-base leading-6 text-zinc-500">
              {t("auth.resetPasswordSubtitle")}
            </Text>
          </View>

          <View className="mt-10">
            <Text className="text-sm text-zinc-500" style={{ fontWeight: "700" }}>
              {t("auth.newPassword")}
            </Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder={t("auth.passwordPlaceholder")}
              placeholderTextColor="#a1a1aa"
              className="mt-2 rounded-2xl border border-zinc-200 px-4 py-4 text-base text-zinc-900"
            />
          </View>

          <View className="mt-6">
            <Text className="text-sm text-zinc-500" style={{ fontWeight: "700" }}>
              {t("auth.confirmPassword")}
            </Text>
            <TextInput
              value={confirm}
              onChangeText={setConfirm}
              secureTextEntry
              placeholder={t("auth.confirmPasswordPlaceholder")}
              placeholderTextColor="#a1a1aa"
              className="mt-2 rounded-2xl border border-zinc-200 px-4 py-4 text-base text-zinc-900"
            />
          </View>

          <View className="mt-10">
            <PrimaryButton
              label={t("auth.resetPasswordSave")}
              disabled={!isReady || isSubmitting}
              loading={isSubmitting}
              onPress={async () => {
                try {
                  setSubmitting(true);
                  await updatePassword(password);
                  Alert.alert(t("auth.resetPasswordDoneTitle"), t("auth.resetPasswordDoneBody"));
                  navigation.reset({ index: 0, routes: [{ name: "SignIn" }] });
                } catch (error) {
                  Alert.alert(t("auth.resetPasswordFailedTitle"), getAuthErrorMessage(error));
                } finally {
                  setSubmitting(false);
                }
              }}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
