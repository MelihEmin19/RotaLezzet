-- RotaLezzet - city_places_cache için final RLS ayari
-- Bu dosyayi Supabase Dashboard > SQL Editor icinde calistir.

ALTER TABLE public.city_places_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cache_select_public" ON public.city_places_cache;
DROP POLICY IF EXISTS "cache_select_anon" ON public.city_places_cache;
DROP POLICY IF EXISTS "cache_insert_anon" ON public.city_places_cache;
DROP POLICY IF EXISTS "cache_update_anon" ON public.city_places_cache;
DROP POLICY IF EXISTS "cache_delete_block" ON public.city_places_cache;

-- Mobil istemci sadece okuyabilir.
CREATE POLICY "cache_select_public"
ON public.city_places_cache
FOR SELECT
TO anon, authenticated
USING (true);

-- INSERT / UPDATE / DELETE policy TANIMLAMIYORUZ.
-- Boylece anon ve authenticated istemciler cache'i degistiremez.
-- Cache yazma artik Edge Function icinde service_role ile yapiliyor.
