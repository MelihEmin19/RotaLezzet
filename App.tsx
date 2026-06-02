import "./global.css";

import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, View } from "react-native";

import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { I18nextProvider } from "react-i18next";
import {
  createNavigationContainerRef,
  NavigationContainer,
} from "@react-navigation/native";
import { QueryClientProvider } from "@tanstack/react-query";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { RootNavigator } from "./src/navigation/RootNavigator";
import type { RootStackParamList } from "./src/navigation/types";
import { AuthProvider } from "./src/hooks/useAuth";
import { useAuthDeepLink } from "./src/hooks/useAuthDeepLink";
import { i18n, initI18n } from "./src/i18n";
import { getCurrentSession } from "./src/services/supabase";
import { getDeviceLanguage, getStoredLanguage } from "./src/services/language";
import { isGuestMode } from "./src/services/guestMode";
import { withTimeout } from "./src/services/async";
import { queryClient } from "./src/services/queryClient";

type InitialRoute = "LanguageSelect" | "Welcome" | "CitySelect";

const navigationRef = createNavigationContainerRef<RootStackParamList>();

function AppNavigation(props: { initialRoute: InitialRoute }) {
  useAuthDeepLink(navigationRef);

  return (
    <NavigationContainer ref={navigationRef}>
      <RootNavigator initialRouteName={props.initialRoute} />
    </NavigationContainer>
  );
}

export default function App() {
  const [isReady, setReady] = useState(false);
  const [initialRoute, setInitialRoute] = useState<InitialRoute>("LanguageSelect");

  useEffect(() => {
    let mounted = true;
    (async () => {
      const stored = await getStoredLanguage();
      const lang = stored ?? getDeviceLanguage();
      await initI18n(lang);

      if (!stored) {
        if (mounted) {
          setInitialRoute("LanguageSelect");
          setReady(true);
        }
        return;
      }

      const [session, guest] = await Promise.all([
        withTimeout(getCurrentSession(), 8_000, "Oturum kontrolu zaman asimi").catch(() => null),
        isGuestMode(),
      ]);

      if (!mounted) return;
      if (session?.user) {
        setInitialRoute("CitySelect");
      } else if (guest) {
        setInitialRoute("CitySelect");
      } else {
        setInitialRoute("Welcome");
      }
      setReady(true);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const i18nValue = useMemo(() => i18n, []);

  if (!isReady) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#fff" }}>
        <ActivityIndicator size="large" color="#ea580c" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <BottomSheetModalProvider>
            <AuthProvider>
              <I18nextProvider i18n={i18nValue}>
                <AppNavigation initialRoute={initialRoute} />
              </I18nextProvider>
            </AuthProvider>
          </BottomSheetModalProvider>
          <StatusBar style="dark" />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
