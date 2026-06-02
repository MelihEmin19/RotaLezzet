import { useEffect, useRef, useState } from "react";
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
import { getAuthErrorMessage, resendSignupOtp, verifySignupOtp } from "../services/auth";
import { getAuthRedirectUri } from "../services/authRedirect";

type Props = NativeStackScreenProps<RootStackParamList, "VerifyOtp">;

const CODE_LENGTH = 6;
const RESEND_COOLDOWN = 60;

export function VerifyOtpScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const email = route.params.email;
  const redirectTo = route.params.redirectTo ?? "CitySelect";

  const [digits, setDigits] = useState<string[]>(() => Array(CODE_LENGTH).fill(""));
  const [isSubmitting, setSubmitting] = useState(false);
  const [isResending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const inputs = useRef<Array<TextInput | null>>([]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const code = digits.join("");
  const isReady = code.length === CODE_LENGTH && /^\d{6}$/.test(code);

  const setDigitAt = (index: number, value: string) => {
    const clean = value.replace(/[^0-9]/g, "");
    if (clean.length === 0) {
      const next = digits.slice();
      next[index] = "";
      setDigits(next);
      return;
    }
    if (clean.length > 1) {
      const next = digits.slice();
      for (let i = 0; i < clean.length && index + i < CODE_LENGTH; i += 1) {
        next[index + i] = clean[i];
      }
      setDigits(next);
      const last = Math.min(index + clean.length, CODE_LENGTH - 1);
      inputs.current[last]?.focus();
      return;
    }
    const next = digits.slice();
    next[index] = clean;
    setDigits(next);
    if (index < CODE_LENGTH - 1) inputs.current[index + 1]?.focus();
  };

  const handleVerify = async () => {
    try {
      setSubmitting(true);
      await verifySignupOtp({ email, token: code });
      navigation.reset({ index: 0, routes: [{ name: redirectTo }] });
    } catch (error) {
      Alert.alert(t("auth.otpFailedTitle"), getAuthErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0) return;
    try {
      setResending(true);
      await resendSignupOtp(email);
      setCooldown(RESEND_COOLDOWN);
      Alert.alert(t("auth.otpResentTitle"), t("auth.otpResentBody"));
    } catch (error) {
      Alert.alert(t("auth.otpResendFailedTitle"), getAuthErrorMessage(error));
    } finally {
      setResending(false);
    }
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
              {t("auth.otpTitle")}
            </Text>
            <Text className="mt-2 text-base leading-6 text-zinc-500">
              {t("auth.otpSubtitle", { email })}
            </Text>
            <Text className="mt-4 text-xs leading-5 text-zinc-400">
              {t("auth.otpLinkHint")}
              {"\n"}
              {getAuthRedirectUri()}
            </Text>
          </View>

          <View className="mt-10 flex-row justify-between">
            {digits.map((digit, idx) => (
              <TextInput
                key={idx}
                ref={(el) => {
                  inputs.current[idx] = el;
                }}
                value={digit}
                onChangeText={(v) => setDigitAt(idx, v)}
                keyboardType="number-pad"
                maxLength={idx === 0 ? CODE_LENGTH : 1}
                onKeyPress={({ nativeEvent }) => {
                  if (nativeEvent.key === "Backspace" && !digit && idx > 0) {
                    inputs.current[idx - 1]?.focus();
                  }
                }}
                className="h-16 w-12 rounded-2xl border border-zinc-200 text-center text-2xl text-zinc-900"
                style={{ fontWeight: "800" }}
              />
            ))}
          </View>

          <View className="mt-10">
            <PrimaryButton
              label={t("auth.otpVerify")}
              disabled={!isReady || isSubmitting}
              loading={isSubmitting}
              onPress={handleVerify}
            />
          </View>

          <Pressable
            onPress={handleResend}
            disabled={cooldown > 0 || isResending}
            className="mt-6 self-center"
          >
            <Text
              className="text-sm text-orange-600"
              style={{ fontWeight: "800", opacity: cooldown > 0 ? 0.4 : 1 }}
            >
              {cooldown > 0
                ? t("auth.otpResendIn", { sec: cooldown })
                : t("auth.otpResend")}
            </Text>
          </Pressable>

          <Pressable onPress={() => navigation.goBack()} className="mt-4 self-center">
            <Text className="text-sm text-zinc-500" style={{ fontWeight: "700" }}>
              {t("auth.otpChangeEmail")}
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
