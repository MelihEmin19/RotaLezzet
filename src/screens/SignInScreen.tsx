import { useState } from "react";
import {
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

import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";

import { PrimaryButton } from "../components/PrimaryButton";
import type { RootStackParamList } from "../navigation/types";
import {
  getAuthErrorMessage,
  sendPasswordResetEmail,
  signInWithEmailPassword,
} from "../services/auth";
import { getAuthRedirectUri } from "../services/authRedirect";

type Props = NativeStackScreenProps<RootStackParamList, "SignIn">;

export function SignInScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setSubmitting] = useState(false);

  const isReady = email.trim().length >= 5 && password.trim().length >= 6;

  const goNext = () => {
    const target = route.params?.redirectTo ?? "Profile";
    navigation.replace(target);
  };

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
              {t("auth.signInTitle")}
            </Text>
            <Text className="mt-2 text-base leading-6 text-zinc-500">
              {t("auth.signInSubtitle")}
            </Text>
          </View>

          <View className="mt-10">
            <Text className="text-sm text-zinc-500" style={{ fontWeight: "700" }}>
              {t("auth.email")}
            </Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder={t("auth.emailPlaceholder")}
              placeholderTextColor="#a1a1aa"
              className="mt-2 rounded-2xl border border-zinc-200 px-4 py-4 text-base text-zinc-900"
            />
          </View>

          <View className="mt-6">
            <Text className="text-sm text-zinc-500" style={{ fontWeight: "700" }}>
              {t("auth.password")}
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

          <View className="mt-10">
            <PrimaryButton
              label={t("auth.signIn")}
              disabled={!isReady || isSubmitting}
              loading={isSubmitting}
              onPress={async () => {
                try {
                  setSubmitting(true);
                  await signInWithEmailPassword(email, password);
                  goNext();
                } catch (error) {
                  Alert.alert(t("auth.signInFailedTitle"), getAuthErrorMessage(error));
                } finally {
                  setSubmitting(false);
                }
              }}
            />
          </View>

          <Pressable
            onPress={async () => {
              if (email.trim().length < 5) {
                Alert.alert(t("auth.forgotPasswordTitle"), t("auth.forgotPasswordNeedEmail"));
                return;
              }
              try {
                await sendPasswordResetEmail(email);
                Alert.alert(
                  t("auth.forgotPasswordSentTitle"),
                  t("auth.forgotPasswordSentBody", { redirect: getAuthRedirectUri() }),
                );
              } catch (error) {
                Alert.alert(t("auth.forgotPasswordFailedTitle"), getAuthErrorMessage(error));
              }
            }}
            className="mt-4 self-center"
          >
            <Text className="text-sm text-zinc-500" style={{ fontWeight: "700" }}>
              {t("auth.forgotPassword")}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => navigation.replace("SignUp", { redirectTo: route.params?.redirectTo })}
            className="mt-4 self-center"
          >
            <Text className="text-sm text-orange-600" style={{ fontWeight: "800" }}>
              {t("auth.noAccount")}
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
