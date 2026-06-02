# RotaLezzet

Turistik şehirlerde **kişiselleştirilmiş gezi rotası** sunan çapraz platform mobil uygulama (iOS & Android). Kullanıcı şehir ve tercihlerini seçer; uygulama durakları sıralar, haritada gösterir ve tur modu ile gezmeyi destekler.

> **Özel depo:** Bu proje GitHub'da private tutulur. `.env` ve API anahtarları repoya eklenmez.

---

## Özellikler

| Alan | Açıklama |
|------|----------|
| **Kimlik** | Kayıt, giriş, e-posta doğrulama (OTP / mail linki), şifre sıfırlama, misafir modu |
| **Şehir & arama** | Google Places tabanlı şehir autocomplete (`city-autocomplete`, `city-resolve`) |
| **Otomatik rota** | Gün sayısı, ilgi alanı (tarih, doğa, gastronomi, alışveriş), tempo → `get-smart-itinerary` |
| **Özel rota** | Şehir içi manuel mekan ekleme, isteğe bağlı en yakın komşu (NN) sıralama |
| **Harita & tur** | `react-native-maps`, rota çizgisi, «Tura Başla», sıradaki durağa harici navigasyon |
| **Profil** | Kayıtlı rotalar, favoriler, profil düzenleme; rotayı manuel kaydetme |
| **Ek** | Tahmini bütçe, PDF/metin paylaşım, offline rota önbelleği, TR/EN (i18next), admin paneli |

---

## Teknolojiler

**İstemci:** React Native 0.81 · Expo SDK 54 · TypeScript · React Navigation · TanStack Query · NativeWind  

**Bulut:** Supabase (PostgreSQL, Auth, RLS) · Edge Functions (Deno) · Google Places API (New)

```
Mobil uygulama
    │  HTTPS (apikey / JWT)
    ▼
Supabase Edge Functions  ──►  Google Places API
    │
    ▼
PostgreSQL (profiles, favorites, saved_itineraries, …)
```

---

## Proje yapısı

```
RotaLezzet/
├── App.tsx                 # Kök bileşen, auth bootstrap
├── src/
│   ├── screens/            # Welcome, CitySelect, Preferences, ItineraryResult, …
│   ├── services/           # auth, edgeFetch, citySearch, savedItineraries, …
│   ├── hooks/              # useAuth, useAuthDeepLink
│   ├── navigation/
│   └── locales/            # tr.json, en.json
├── supabase/
│   ├── functions/          # city-autocomplete, get-smart-itinerary, …
│   └── migrations/
├── docs/
│   └── SUPABASE_KURULUM.md # Backend ve Auth kurulum adımları
└── scripts/
    └── check-backend.mjs   # Edge + Google bağlantı testi
```

---

## Gereksinimler

- **Node.js** `>=20.19.4 <21` (`.nvmrc` ile uyumlu)
- [Expo Go](https://expo.dev/go) (fiziksel cihaz testi)
- [Supabase](https://supabase.com) projesi
- Google Cloud’da **Places API (New)** etkin

---

## Kurulum

### 1. Depoyu klonlayın

```bash
git clone https://github.com/MelihEmin19/RotaLezzet.git
cd RotaLezzet
npm install
```

### 2. Ortam değişkenleri

Proje kökünde `.env` oluşturun (örnek: `.env.example`):

```env
EXPO_PUBLIC_SUPABASE_URL=https://PROJE_ID.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=anon_key_buraya
```

> Google Places anahtarı **istemcide değil**; Supabase Edge Function secret olarak tanımlanır (`GOOGLE_PLACES_API_KEY`).

### 3. Supabase

1. SQL migration dosyalarını `supabase/migrations/` altından çalıştırın.
2. Edge Functions deploy edin (`--no-verify-jwt`: `city-autocomplete`, `city-resolve`, `place-autocomplete`, `get-smart-itinerary`, `photo-proxy`).
3. Secret: `GOOGLE_PLACES_API_KEY`.
4. Auth redirect: `rotalezzet://**`, `exp://**`.

Ayrıntılı adımlar: **[docs/SUPABASE_KURULUM.md](docs/SUPABASE_KURULUM.md)**

Backend testi:

```bash
node scripts/check-backend.mjs
```

Beklenen: `google status 200` ve `city-autocomplete status 200`.

### 4. Uygulamayı çalıştırma

```bash
npx expo start --clear
```

Farklı Wi‑Fi / mobil veri kullanıyorsanız:

```bash
npx expo start --clear --tunnel
```

Expo Go ile QR kodu okutun. `.env` değiştirdikten sonra dev server’ı yeniden başlatın.

---

## Edge Functions

| Fonksiyon | Açıklama |
|-----------|----------|
| `city-autocomplete` | Şehir arama önerileri |
| `city-resolve` | Seçilen şehrin koordinat / timezone |
| `place-autocomplete` | Mekan arama (özel rota) |
| `get-smart-itinerary` | Tercihlere göre rota üretimi |
| `photo-proxy` | İmzalı Places foto URL |
| `admin-dashboard` | Admin istatistikleri (JWT + admin rolü) |

Genel çağrılar: `src/services/edgeFetch.ts` (`invokePublicEdgeFunction` / `invokeAuthedEdgeFunction`).

---

## Ekranlar (özet)

1. **LanguageSelect** → **Welcome** → Kayıt / Giriş / Misafir  
2. **CitySelect** → **Preferences** → **ItineraryResult** (harita + program)  
3. **Profile** — kayıtlı rotalar, **CustomItineraryBuilder**  
4. **VerifyOtp** / **ResetPassword** — auth akışları  

---

## NPM komutları

| Komut | Açıklama |
|-------|----------|
| `npm start` | Expo dev server |
| `npm run android` | Android emülatör / cihaz |
| `npm run ios` | iOS simülatör (macOS) |
| `npm run web` | Web önizleme |

---

## Güvenlik notları

- `.env` ve `supabase/.temp/` `.gitignore` içindedir; commit etmeyin.
- `EXPO_PUBLIC_*` değerleri istemci paketine gömülür; yalnızca anon key kullanın.
- Google / service role anahtarlarını yalnızca Supabase secret veya sunucu tarafında tutun.
- `app.json` içindeki harita anahtarı production için kısıtlanmalıdır.

---

## İlgili dokümanlar

- [docs/SUPABASE_KURULUM.md](docs/SUPABASE_KURULUM.md) — Supabase, Google Places, Auth  
- [BUSINESS.md](BUSINESS.md) — Mağaza yayını, maliyet ve iş notları (teknik olmayan)

---

## Lisans

Bu depo özel (private) bir akademik / kişisel projedir. İzinsiz kopyalama veya dağıtım yapılmamalıdır.

**Geliştirici:** Melih Emin Karakökçek · Manisa Celal Bayar Üniversitesi
