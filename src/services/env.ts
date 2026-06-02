type PublicEnvKey =
  | "EXPO_PUBLIC_SUPABASE_URL"
  | "EXPO_PUBLIC_SUPABASE_ANON_KEY";

export function getPublicEnv(key: PublicEnvKey): string | null {
  const value = process.env[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

export function requirePublicEnv(key: PublicEnvKey): string {
  const value = getPublicEnv(key);
  if (!value) {
    throw new Error(`${key} bulunamadı. Lütfen kök dizindeki .env dosyasında tanımlayın.`);
  }
  return value;
}

