import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { AdminDashboardScreen } from "../screens/AdminDashboardScreen";
import { CitySelectScreen } from "../screens/CitySelectScreen";
import { CustomItineraryBuilderScreen } from "../screens/CustomItineraryBuilderScreen";
import { ItineraryResultScreen } from "../screens/ItineraryResultScreen";
import { LanguageSelectScreen } from "../screens/LanguageSelectScreen";
import { PreferencesScreen } from "../screens/PreferencesScreen";
import { ProfileScreen } from "../screens/ProfileScreen";
import { ResetPasswordScreen } from "../screens/ResetPasswordScreen";
import { SignInScreen } from "../screens/SignInScreen";
import { SignUpScreen } from "../screens/SignUpScreen";
import { VerifyOtpScreen } from "../screens/VerifyOtpScreen";
import { WelcomeScreen } from "../screens/WelcomeScreen";
import { i18n } from "../i18n";
import type { RootStackParamList } from "./types";

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator(props: { initialRouteName: keyof RootStackParamList }) {
  return (
    <Stack.Navigator
      initialRouteName={props.initialRouteName}
      screenOptions={{
        headerTitleStyle: { fontWeight: "700" },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen
        name="LanguageSelect"
        component={LanguageSelectScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="Welcome"
        component={WelcomeScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="CitySelect"
        component={CitySelectScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SignIn"
        component={SignInScreen}
        options={{ title: i18n.t("auth.signIn") }}
      />
      <Stack.Screen
        name="SignUp"
        component={SignUpScreen}
        options={{ title: i18n.t("auth.signUp") }}
      />
      <Stack.Screen
        name="VerifyOtp"
        component={VerifyOtpScreen}
        options={{ title: i18n.t("auth.otpTitle") }}
      />
      <Stack.Screen
        name="ResetPassword"
        component={ResetPasswordScreen}
        options={{ title: i18n.t("auth.resetPasswordTitle") }}
      />
      <Stack.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ title: i18n.t("profile.title") }}
      />
      <Stack.Screen
        name="AdminDashboard"
        component={AdminDashboardScreen}
        options={{ title: i18n.t("admin.title") }}
      />
      <Stack.Screen
        name="CustomItineraryBuilder"
        component={CustomItineraryBuilderScreen}
        options={{ title: i18n.t("custom.title") }}
      />
      <Stack.Screen
        name="Preferences"
        component={PreferencesScreen}
        options={({ route }) => ({ title: route.params.cityName })}
      />
      <Stack.Screen
        name="ItineraryResult"
        component={ItineraryResultScreen}
        options={({ route }) => ({
          title:
            route.params.days === "1"
              ? i18n.t("itinerary.days1")
              : route.params.days === "2"
                ? i18n.t("itinerary.days2")
                : i18n.t("itinerary.days3p"),
        })}
      />
    </Stack.Navigator>
  );
}

