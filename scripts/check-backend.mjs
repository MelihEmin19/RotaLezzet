import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env") });

const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const googleKey =
  process.env.GOOGLE_PLACES_API_KEY?.trim() ||
  process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY?.trim();

if (!url || !anon) {
  console.error("Eksik: EXPO_PUBLIC_SUPABASE_URL veya EXPO_PUBLIC_SUPABASE_ANON_KEY");
  process.exit(1);
}

async function testGoogle() {
  if (!googleKey) {
    console.log("google: ATLANDI (GOOGLE_PLACES_API_KEY veya EXPO_PUBLIC_GOOGLE_PLACES_API_KEY yok)");
    return;
  }
  const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": googleKey,
      "X-Goog-FieldMask": "suggestions.placePrediction.placeId",
    },
    body: JSON.stringify({
      input: "Istanbul",
      languageCode: "tr",
      includedPrimaryTypes: ["(cities)"],
    }),
  });
  const text = await res.text();
  console.log(`google status ${res.status}`);
  if (!res.ok) console.log(text.slice(0, 300));
}

async function testCityAutocomplete() {
  const res = await fetch(`${url}/functions/v1/city-autocomplete`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ input: "Istanbul", language: "tr", regionCode: "TR" }),
  });
  const text = await res.text();
  console.log(`city-autocomplete status ${res.status}`);
  console.log(text.slice(0, 400));
}

console.log("Supabase:", url.slice(0, 40) + "…");
await testGoogle();
await testCityAutocomplete();
