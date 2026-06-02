import type { ConfigContext, ExpoConfig } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

  return {
    ...config,
    plugins: [...(config.plugins ?? []), "expo-localization"],
    extra: {
      ...(config.extra ?? {}),
      supabaseUrl,
      supabaseAnonKey,
    },
  } as ExpoConfig;
};

