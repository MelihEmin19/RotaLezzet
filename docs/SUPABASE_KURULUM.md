# Supabase ve Google Places kurulumu

Uygulama şehir araması ve rota özellikleri için **Supabase Edge Functions** kullanır. `.env` dosyasındaki `EXPO_PUBLIC_*` değerleri sadece mobil uygulamadır; Google anahtarı **Supabase secret** olarak tanımlanmalıdır.

## 1. Google Cloud (zorunlu)

1. [Google Cloud Console](https://console.cloud.google.com/) → projeniz.
2. **APIs & Services → Library** → **Places API (New)** → **Enable**.
3. **APIs & Services → Credentials** → API key oluşturun veya mevcut anahtarı düzenleyin.
4. Anahtar kısıtları:
   - Edge Function sunucudan çağrı yapar; yalnızca **Android/iOS uygulama** kısıtı varsa istekler **403 PERMISSION_DENIED** verir.
   - Öneri: ayrı bir **sunucu anahtarı** (kısıtsız veya IP kısıtlı) kullanın.

Test (bilgisayarınızda, proje kökünde):

```powershell
node scripts/check-backend.mjs
```

`google status 200` ve `city-autocomplete status 200` görmelisiniz.

## 2. Supabase secret

Dashboard: **Project Settings → Edge Functions → Secrets**

| Secret | Açıklama |
|--------|----------|
| `GOOGLE_PLACES_API_KEY` | Google Places API (New) anahtarı |

CLI ile (proje linkli):

```powershell
npx supabase secrets set GOOGLE_PLACES_API_KEY="BURAYA_ANAHTAR" --project-ref cepwjbvkxdgfalhefuhj
npx supabase functions deploy city-autocomplete city-resolve place-autocomplete get-smart-itinerary photo-proxy --no-verify-jwt --project-ref cepwjbvkxdgfalhefuhj
```

## 3. Auth – kayıt, OTP ve mail bağlantısı

**Authentication → URL Configuration**

- **Redirect URLs:** `rotalezzet://**`, `exp://**` (Expo Go için zorunlu)
- OTP ekranında görünen `exp://.../--/auth/callback` adresini de listeye ekleyin.

**E-posta şablonu (6 haneli kod için)**

- **Authentication → Email Templates → Confirm signup**
- Gövdede `{{ .Token }}` kullanın (sadece `{{ .ConfirmationURL }}` varsa mailde **bağlantı** gelir, kod gelmez).

**Şifremi unuttum:** SMTP kapalıysa mail gelmez; Auth ayarlarından e-posta sağlayıcısını kontrol edin.

Mail bağlantısına tıklayınca uygulama açılmıyorsa: Expo Go’yu açık tutun, `npx expo start --tunnel` çalışsın, Redirect URL’leri kaydedin, yeni kayıt maili isteyin.

## 4. Expo

`.env` değiştirdikten sonra:

```powershell
npx expo start --clear --tunnel
```

Telefon ve bilgisayar farklı ağdaysa `--tunnel` kullanın.
