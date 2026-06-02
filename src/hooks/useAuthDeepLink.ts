import { useEffect } from "react";
import { Alert } from "react-native";

import type { NavigationContainerRef } from "@react-navigation/native";
import * as Linking from "expo-linking";
import { useTranslation } from "react-i18next";

import type { RootStackParamList } from "../navigation/types";
import { applyAuthCallbackFromUrl, isAuthCallbackUrl } from "../services/authRedirect";
import { setSessionFromTokens } from "../services/auth";

export function useAuthDeepLink(
  navigationRef: NavigationContainerRef<RootStackParamList> | null,
) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!navigationRef) return;

    const navigateAfterAuth = (isRecovery: boolean) => {
      if (!navigationRef.isReady()) return;
      if (isRecovery) {
        navigationRef.navigate("ResetPassword");
      } else {
        navigationRef.reset({ index: 0, routes: [{ name: "CitySelect" }] });
      }
    };

    const handleUrl = async (url: string | null) => {
      if (!isAuthCallbackUrl(url)) return;

      try {
        const result = await applyAuthCallbackFromUrl(url!, async (access, refresh) => {
          await setSessionFromTokens(access, refresh);
        });

        if (!result.hasSession) return;

        navigateAfterAuth(result.isRecovery);
        Alert.alert(t("auth.otpVerifiedTitle"), t("auth.otpVerifiedBody"));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log("[auth-deeplink]", message);
        Alert.alert(t("auth.otpFailedTitle"), message);
      }
    };

    void Linking.getInitialURL().then(handleUrl);
    const sub = Linking.addEventListener("url", (event: { url: string }) => {
      void handleUrl(event.url);
    });
    return () => sub.remove();
  }, [navigationRef, t]);
}
