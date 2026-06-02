import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "../locales/en.json";
import tr from "../locales/tr.json";

export const supportedLanguages = ["tr", "en"] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];

export function normalizeLanguage(input: string | null | undefined): SupportedLanguage {
  const v = (input ?? "").trim().toLowerCase();
  if (v.startsWith("en")) return "en";
  return "tr";
}

export async function initI18n(language: SupportedLanguage) {
  if (i18n.isInitialized) {
    await i18n.changeLanguage(language);
    return i18n;
  }

  await i18n.use(initReactI18next).init({
    compatibilityJSON: "v4",
    resources: {
      tr: { translation: tr },
      en: { translation: en },
    },
    lng: language,
    fallbackLng: "tr",
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });

  return i18n;
}

export { i18n };

