# RotaLezzet — İş, Maliyet ve Strateji Notları

> Bu dosya ürünün **teknik olmayan** yol haritasını tutar: yayına çıkarma, maliyetler,
> gelir modelleri, test stratejileri. Kodla ilgili kurallar `.cursorrules` dosyasındadır.

---

## 1. Platform Desteği ve Test

### Durum
- Kod cross-platform: **iOS + Android**.
- Platform-spesifik tek yer: `ItineraryResultScreen.handleGetDirections`
  → iOS: `maps://`, Android: `geo:` URL.
- Kullanılan tüm paketler (react-native-maps, bottom-sheet, async-storage,
  draggable-flatlist, gesture-handler) her iki platformda da çalışır.

### iOS Test Seçenekleri (Mac yoksa)
| Yöntem | Ücret | Notlar |
|---|---|---|
| Arkadaşın iPhone'u + Expo Go | Ücretsiz | **En pratik.** `npx expo start --tunnel` + QR. |
| iOS Simulator (Xcode) | Ücretsiz | **Mac gerekli.** |
| MacInCloud / MacStadium | ~$20/ay | Uzak Mac kiralama. |
| BrowserStack App Live | ~$20/ay | Gerçek iPhone'lara uzak erişim. |
| TestFlight (beta) | $99/yıl Apple hesabı | 100 kişiye kadar iç test. |

---

## 2. Yayına Çıkarma (Store Süreci)

### Google Play Store (Android) — Daha Kolay
1. **Google Play Console** hesabı → tek seferlik **$25** (ömür boyu).
2. Build: `eas build --platform android --profile production` → `.aab`.
3. Hazırlık:
   - Uygulama ikonu (512×512), feature graphic (1024×500), 2-8 ekran görüntüsü.
   - Açıklama (TR + EN), **gizlilik politikası URL'si (zorunlu)**.
   - Veri güvenliği formu (hangi veriyi topluyoruz).
4. Akış: Internal → Closed (≥12 tester, 14 gün) → Production.
5. İlk inceleme: **2-7 gün**.

### Apple App Store (iOS) — Daha Zor
1. **Apple Developer Program** → **$99/yıl** (her yıl yenilenmeli).
2. Build: `eas build --platform ios --profile production` → `.ipa`.
3. Hazırlık:
   - İkonlar, ekran görüntüleri (birden çok iPhone boyutu).
   - Açıklama, yaş sınıfı, gizlilik politikası, ATT (App Tracking Transparency) config.
4. Akış: TestFlight → Review → Production.
5. İlk inceleme: **1-3 gün**, **ortalama 1-2 revizyon** almayı bekle.
6. Sık red sebepleri:
   - Eksik gizlilik politikası / kullanıcı giriş-hesap silme özelliği.
   - Crash/bug → review sırasında tetiklenebiliyor.
   - Placeholder metin / yanlış yerelleştirme.

### EAS Komutları (Expo)
```bash
eas build --platform android --profile production
eas build --platform ios --profile production
eas submit --platform android
eas submit --platform ios
```

---

## 3. Aylık Gider Kalemleri

### Sabit
| Servis | Plan | Aylık |
|---|---|---|
| Supabase | Free | $0 (500MB DB, 500K Edge Function çağrısı/ay) |
| Supabase Pro | Pro | $25 (8GB DB, 100GB transfer, günlük backup) |
| Apple Developer | Zorunlu | ~$8.25 (yıllık $99) |
| Google Play | Zorunlu | Tek seferlik $25 |
| Domain + gizlilik sitesi | Opsiyonel | ~$1.25 (yıllık $15) |

### Kullanım Bazlı — Google Cloud APIs
> Google her ay **$200 ücretsiz kredi** verir (Map/Places için).

| API | Fiyat | $200 kredi ile |
|---|---|---|
| Places Text Search (New) | $32 / 1000 istek | ~6.250 arama |
| Places Details (New) | $17 / 1000 istek | ~11.700 sorgu |
| Places Autocomplete | $2.83 / session | ~70.000 oturum |
| Maps SDK (Android/iOS) | $7 / 1000 yükleme | ~28.000 harita |
| Time Zone API | $5 / 1000 istek | ~40.000 istek |
| Cloud Translation | $20 / 1M karakter | İlk 500K karakter/ay bedava |

### Mevcut Maliyet Azaltıcılar
- **30 gün cache** (city_places_cache tablosu) → aynı şehir + tercih 30 gün boyunca
  Google'a gitmez. Tahmini **10-20× azalma**.
- Photo proxy → doğrudan `photoUrl` kullanıyoruz, ek Google Photo API çağrısı yok.
- Autocomplete session token: (gelecekte eklenebilir, maliyeti daha da düşürür.)

### Tahmini Senaryolar
| Aylık Aktif Kullanıcı | Tahmini Aylık Maliyet |
|---|---|
| 0-1.000 | ~$0 (Google $200 kredi + Supabase Free yeterli) |
| 1.000-10.000 | ~$25-50 (Supabase Pro + küçük Google aşımı) |
| 10.000+ | $200-500 (Google API aşımı ana kalem) |

---

## 4. Gelir Modelleri

### A. Reklam (AdMob) — En Kolay, En Düşük Getiri
- Banner (timeline kartları arasında, her 4-5 kartta 1).
- Interstitial ("Rotayı Oluştur" sonrası, agresif olmamak şart).
- **eCPM:** 1000 gösterim başına ~$1-3.
- 10K aylık aktif × 10 gösterim = $10-30/ay.
- **UX'i bozar, premium algıyı düşürür.** Son çare.

### B. Freemium / Premium — En Sürdürülebilir ⭐
- **Ücretsiz:** 1 günlük plan, 1 şehir geçmişi.
- **Premium ($2.99/ay veya $19.99/yıl):**
  - Çoklu günlük planlar (2, 3+)
  - Sınırsız şehir geçmişi / favoriler
  - Offline mod (indirilmiş rotalar)
  - Gelişmiş filtreler (bütçe, erişilebilirlik)
  - Reklamsız
- Dönüşüm oranı: ortalama **%2-5**.
- 10K kullanıcı × %3 × $3 = **~$900/ay potansiyel**.
- Store komisyonu: ilk yıl **%30**, 12 ay sonrası aboneler için **%15**.

### C. Affiliate (Ortaklık Gelirleri)
- **Restoran rezervasyonu:** OpenTable / TheFork → $1-5 / rezervasyon.
- **Otel:** Booking.com / Hotels.com affiliate → %4-12 komisyon.
- **Uçak bileti:** Skyscanner affiliate → tıklama başına cent'ler.
- "Rota şu bölgede, konaklama için bu otel" akıllı yerleşimi.
- Getirisi yüksek ama entegrasyon uğraştırır.

### D. B2B — Uzun Vade
- Turizm ofisleri / oteller: sponsorlu yer önerisi.
- White-label: otel zinciri kendi markasıyla → aylık $100-500/müşteri.

### Önerilen Yol Haritası
1. **1. yıl:** Ücretsiz + reklamsız. 5000+ organik kullanıcı hedefle, kötü yorum alma.
2. **2. yıl:** Premium tier aç (freemium).
3. **3. yıl:** Affiliate entegre et.
4. Reklam en son düşünülmeli.

---

## 5. Yayın Öncesi Hazırlık Listesi

### Zorunlu
- [ ] Gizlilik politikası URL'si (TR + EN)
- [ ] Kullanım şartları (Terms of Service)
- [ ] Hesap silme akışı (App Store için zorunlu)
- [ ] İkonlar: iOS 1024×1024, Android adaptive icon
- [ ] Splash screen
- [ ] Ekran görüntüleri (iPhone 6.7" + 6.5" + 5.5", Android phone + tablet)
- [ ] Uygulama açıklaması (TR + EN, 4000 karakter, ilk 170'i görünür)
- [ ] Destek e-posta adresi
- [ ] Hata raporlama (Sentry entegrasyonu önerilir)

### Güçlü Tavsiyeler
- [ ] Analytics (Firebase veya PostHog) → kullanıcı davranışı
- [ ] Crash reporting (Sentry)
- [ ] Uygulama içi geri bildirim formu
- [ ] Versiyon güncelleme uyarısı (eski Expo SDK'lar için)
- [ ] Supabase RLS (Row Level Security) politikaları — bulut senkron eklediğimizde

---

## 6. Yaklaşan Sprintler (Teknik)

### Kısa Vade
- [ ] Optimistic UI (✅ yapıldı)
- [ ] Mavi marker — user-added yerler için haritada ayırt etme
- [ ] Boş gün CTA — tüm öğeler silinmişse "Yer ekle" mesajı
- [ ] Snackbar + undo (silme için 5sn geri alma)

### Orta Vade
- [ ] Supabase Auth + bulut senkron (edits + favoriler)
- [ ] Offline mod (MMKV + NetInfo)
- [ ] Favoriler / geçmiş rotalar ekranı
- [ ] Hesap silme akışı (store zorunlu)

### Uzun Vade
- [ ] Premium tier + in-app purchase (RevenueCat)
- [ ] Paylaş (deep link ile rota paylaşma)
- [ ] Bildirimler (trip hatırlatma)
- [ ] Grup planı (2+ kullanıcı ortak rota)
