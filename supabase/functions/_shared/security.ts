/// <reference lib="deno.ns" />

const DEFAULT_ALLOW_HEADERS = "authorization, x-client-info, apikey, content-type";
const DEFAULT_ALLOW_METHODS = "GET,POST,OPTIONS";
const DEFAULT_MAX_AGE_SECONDS = "86400";
const RATE_LIMIT_BUCKETS = new Map<string, { count: number; resetAt: number }>();
const PHOTO_PROXY_TTL_MS = 10 * 60 * 1000;
const textEncoder = new TextEncoder();

function normalizeOrigin(origin: string) {
  return origin.trim().replace(/\/+$/g, "");
}

function getConfiguredOrigins() {
  const raw = Deno.env.get("ALLOWED_ORIGINS") ?? "";
  return raw
    .split(",")
    .map((item) => normalizeOrigin(item))
    .filter(Boolean);
}

function isLocalOrigin(origin: string) {
  try {
    const url = new URL(origin);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.hostname === "localhost" || url.hostname === "127.0.0.1"
      : false;
  } catch {
    return false;
  }
}

function isOriginAllowed(origin: string) {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  if (isLocalOrigin(normalized)) return true;
  return getConfiguredOrigins().includes(normalized);
}

export function getCorsHeaders(req: Request, extraHeaders?: HeadersInit) {
  const origin = req.headers.get("origin");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": DEFAULT_ALLOW_HEADERS,
    "Access-Control-Allow-Methods": DEFAULT_ALLOW_METHODS,
    "Access-Control-Max-Age": DEFAULT_MAX_AGE_SECONDS,
    Vary: "Origin",
  };

  if (!origin) {
    headers["Access-Control-Allow-Origin"] = "*";
  } else if (isOriginAllowed(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  if (extraHeaders) {
    for (const [key, value] of Object.entries(extraHeaders as Record<string, string>)) {
      headers[key] = value;
    }
  }

  return headers;
}

export function ensureBrowserOriginAllowed(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return null;
  if (isOriginAllowed(origin)) return null;
  return jsonResponse(req, { error: "Origin not allowed" }, 403);
}

export function handleOptions(req: Request) {
  const blocked = ensureBrowserOriginAllowed(req);
  if (blocked) return blocked;
  return new Response("ok", { headers: getCorsHeaders(req) });
}

export function jsonResponse(req: Request, body: unknown, status = 200, extraHeaders?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...getCorsHeaders(req),
      "Content-Type": "application/json",
      ...(extraHeaders as Record<string, string> | undefined),
    },
  });
}

function getClientIp(req: Request) {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }

  const realIp = req.headers.get("x-real-ip") ?? req.headers.get("cf-connecting-ip");
  return realIp?.trim() || "unknown";
}

function pruneExpiredBuckets(now: number) {
  if (RATE_LIMIT_BUCKETS.size < 500) return;
  for (const [key, bucket] of RATE_LIMIT_BUCKETS.entries()) {
    if (bucket.resetAt <= now) {
      RATE_LIMIT_BUCKETS.delete(key);
    }
  }
}

export function enforceRateLimit(req: Request, name: string, limit: number, windowMs: number) {
  const now = Date.now();
  pruneExpiredBuckets(now);

  const key = `${name}:${getClientIp(req)}`;
  const existing = RATE_LIMIT_BUCKETS.get(key);
  if (!existing || existing.resetAt <= now) {
    RATE_LIMIT_BUCKETS.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }

  if (existing.count >= limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    return jsonResponse(
      req,
      { error: "Çok fazla istek gönderildi. Lütfen biraz sonra tekrar deneyin." },
      429,
      { "Retry-After": String(retryAfterSeconds) },
    );
  }

  existing.count += 1;
  RATE_LIMIT_BUCKETS.set(key, existing);
  return null;
}

export function logInternalError(scope: string, error: unknown) {
  console.error(`[${scope}]`, error instanceof Error ? error.message : error);
}

function getPublicErrorMessage(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);

  if (msg.includes("Eksik secret: GOOGLE_PLACES_API_KEY")) {
    return "Sunucuda Google Places anahtarı yok. Supabase Dashboard → Project Settings → Edge Functions → Secrets bölümüne GOOGLE_PLACES_API_KEY ekleyip fonksiyonları yeniden deploy edin.";
  }

  if (msg.includes("Google Places hatası")) {
    if (/PERMISSION_DENIED|does not have permission|403|API key not valid|API_KEY_INVALID/i.test(msg)) {
      return "Google Places API anahtarı reddedildi. Google Cloud Console'da Places API (New) etkinleştirin; anahtar kısıtlamasını sunucu/Edge Function kullanımına uygun ayarlayın.";
    }
    return "Şehir araması şu an kullanılamıyor. Lütfen biraz sonra tekrar deneyin.";
  }

  return "İşlem şu anda tamamlanamıyor.";
}

export function internalError(req: Request, scope: string, error: unknown) {
  logInternalError(scope, error);
  return jsonResponse(req, { error: getPublicErrorMessage(error) }, 500);
}

export function sanitizePhotoWidth(input: string | null, fallback = "800") {
  return input && /^\d{2,5}$/.test(input) ? input : fallback;
}

export function isValidPhotoName(input: string | null) {
  return Boolean(input && /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/.test(input));
}

function getPhotoSigningSecret() {
  const explicit = Deno.env.get("PHOTO_PROXY_SIGNING_KEY")?.trim();
  if (explicit) return explicit;

  const fallback = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (fallback) return fallback;

  throw new Error("Eksik secret: PHOTO_PROXY_SIGNING_KEY");
}

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function signPayload(payload: string) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(getPhotoSigningSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", cryptoKey, textEncoder.encode(payload));
  return toBase64Url(new Uint8Array(signature));
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function buildSignedPhotoUrl(selfBaseUrl: string, photoName: string, maxwidth = "800") {
  if (!isValidPhotoName(photoName)) return undefined;

  const safeWidth = sanitizePhotoWidth(maxwidth, "800");
  const exp = Date.now() + PHOTO_PROXY_TTL_MS;
  const payload = `${photoName}:${safeWidth}:${exp}`;
  const sig = await signPayload(payload);
  const url = new URL(selfBaseUrl);
  url.searchParams.set("photo_name", photoName);
  url.searchParams.set("maxwidth", safeWidth);
  url.searchParams.set("exp", String(exp));
  url.searchParams.set("sig", sig);
  return url.toString();
}

export function getFunctionPublicUrl(req: Request, functionName: string) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim().replace(/\/+$/g, "");
  if (supabaseUrl) {
    return `${supabaseUrl}/functions/v1/${functionName}`;
  }

  try {
    const requestUrl = new URL(req.url);
    if (requestUrl.host) {
      return `${requestUrl.protocol}//${requestUrl.host}/functions/v1/${functionName}`;
    }
  } catch {
    // ignore and continue with header-based fallback
  }

  const forwardedHost = req.headers.get("x-forwarded-host")?.trim();
  const host = forwardedHost || req.headers.get("host")?.trim();
  const proto = req.headers.get("x-forwarded-proto")?.trim() || "https";
  if (!host) {
    throw new Error("Public function URL oluşturulamadı");
  }

  return `${proto}://${host}/functions/v1/${functionName}`;
}

export async function verifySignedPhotoRequest(url: URL) {
  const photoName = url.searchParams.get("photo_name");
  const maxwidth = sanitizePhotoWidth(url.searchParams.get("maxwidth"), "800");
  const expRaw = url.searchParams.get("exp");
  const sig = url.searchParams.get("sig")?.trim() ?? "";

  if (!isValidPhotoName(photoName) || !expRaw || !sig) {
    return { ok: false as const, status: 400, error: "Geçersiz foto isteği" };
  }

  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < Date.now()) {
    return { ok: false as const, status: 403, error: "Foto bağlantısının süresi doldu" };
  }

  const expectedSig = await signPayload(`${photoName}:${maxwidth}:${exp}`);
  if (!constantTimeEqual(sig, expectedSig)) {
    return { ok: false as const, status: 403, error: "Geçersiz foto imzası" };
  }

  return {
    ok: true as const,
    photoName,
    maxwidth,
  };
}
