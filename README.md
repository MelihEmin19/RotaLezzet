# RotaLezzet 🌍🧭

**Proje Tanımı:**
RotaLezzet, turistik şehirlere seyahat eden kullanıcıların planlama sürecindeki karmaşayı ortadan kaldıran akıllı bir gezi rotası uygulamasıdır. Kullanıcının belirlediği gün sayısı, seyahat temposu ve ilgi alanlarına (tarih, doğa, gastronomi vb.) göre yapay zeka destekli, coğrafi olarak en verimli (en yakın komşu) rotayı otomatik olarak oluşturur. Ziyaretçiler bu sayede saatlerce araştırma yapmadan, zamanlarını ve bütçelerini optimize ederek şehri bir rehber eşliğinde geziyormuş gibi keşfedebilirler.

---

## 🚀 Mevcut Özellikler
- **Kimlik Doğrulama:** Kayıt, giriş, e-posta doğrulama (OTP), şifre sıfırlama ve misafir modu.
- **Akıllı Rota Üretimi:** Seçilen şehir, gün sayısı, ilgi alanı ve tempoya göre optimize edilmiş rota oluşturma.
- **Harita Entegrasyonu:** `react-native-maps` ile rotayı haritada çizme (Polyline) ve mekanları işaretleme.
- **Özel Rota & Düzenleme:** Sürükle-bırak (Drag & Drop) ile rota sıralamasını değiştirme ve manuel mekan ekleme.
- **Navigasyon Desteği:** "Tura Başla" ile harici harita uygulamalarına (Apple Maps / Google Maps) yönlendirme.
- **Çoklu Dil Desteği:** i18next ile Türkçe ve İngilizce dil seçenekleri.
- **Çevrimdışı Önbellekleme:** Yerel depolama ile rotaların internet olmadan da görüntülenebilmesi.

## 🛠 Kullanılan Teknolojiler
- **Frontend (Mobil):** React Native (v0.81), Expo SDK 54, JavaScript/TypeScript
- **Stil & UI:** NativeWind (Tailwind CSS), Görsel bileşenler için Bottom-Sheet
- **Backend & Veritabanı:** Supabase (PostgreSQL, Kimlik Doğrulama, Row Level Security)
- **Serverless / API:** Supabase Edge Functions (Deno), Google Places API (New)
- **Harita:** React Native Maps, Google Maps API (Android için)
- **Durum Yönetimi:** TanStack Query (React Query)

---

## ⏳ Gelecekte Eklenecek Özellikler (Planlananlar)
- **Ödeme Entegrasyonu:** Premium özellikler (çoklu günlük planlar, sınırsız şehir geçmişi) için in-app purchase (RevenueCat) veya Stripe entegrasyonu.
- **Sosyal Paylaşım:** Oluşturulan rotaların PDF formatında indirilmesi veya doğrudan link ile başkalarıyla paylaşılması.
- **Grup Planlaması:** 2 veya daha fazla kullanıcının aynı rota üzerinde ortaklaşa düzenleme yapabilmesi.
- **Push Bildirimleri:** Gezi sırasındaki duraklar ve zaman yönetimi için akıllı hatırlatıcılar.

---

## 💻 Kurulum Adımları

Projeyi lokalde test etmek ve ayağa kaldırmak için terminalde aşağıdaki 3 temel komutu çalıştırmanız yeterlidir:

```bash
# 1. Depoyu klonlayın ve klasöre girin
git clone https://github.com/MelihEmin19/RotaLezzet.git && cd RotaLezzet

# 2. Gerekli bağımlılıkları yükleyin
npm install

# 3. Expo geliştirici sunucusunu başlatın
npx expo start --clear
```

> **Önemli Not:** Projenin çalışabilmesi için kök dizinde `.env` dosyasının oluşturulması ve Supabase (URL, Anon Key) ayarlarının yapılandırılması gerekmektedir. Google Places API anahtarı istemcide (mobil tarafta) tutulmaz, güvenlik sebebiyle Supabase Edge Functions tarafında secret olarak barındırılır. (Uygulama derlemesi ve Google Haritalar entegrasyonu için `app.json` dosyasına yalnızca platform kısıtlaması yapılmış harita anahtarı eklenir.)

---
**Geliştirici:** Melih Emin Karakökçek
