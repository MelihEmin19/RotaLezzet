/// <reference lib="deno.ns" />

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  enforceRateLimit,
  ensureBrowserOriginAllowed,
  getCorsHeaders,
  handleOptions,
  internalError,
  jsonResponse,
  sanitizePhotoWidth,
  verifySignedPhotoRequest,
} from "../_shared/security.ts";

function requireSecret(key: string) {
  const value = Deno.env.get(key);
  if (!value || !value.trim()) throw new Error(`Eksik secret: ${key}`);
  return value.trim();
}

async function proxyPlacePhotoV1(photoName: string, maxwidth: string, req: Request) {
  const key = requireSecret("GOOGLE_PLACES_API_KEY");
  const safeWidth = sanitizePhotoWidth(maxwidth, "800");
  const url = new URL(`https://places.googleapis.com/v1/${photoName}/media`);
  url.searchParams.set("maxWidthPx", safeWidth);

  const res = await fetch(url.toString(), {
    redirect: "follow",
    headers: {
      "X-Goog-Api-Key": key,
    },
  });

  return new Response(res.body, {
    status: res.status,
    headers: {
      ...getCorsHeaders(req),
      "Cache-Control": "public, max-age=300",
      "Content-Type": res.headers.get("content-type") ?? "image/jpeg",
    },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return handleOptions(req);
  }

  try {
    const blockedOrigin = ensureBrowserOriginAllowed(req);
    if (blockedOrigin) return blockedOrigin;

    if (req.method !== "GET") {
      return jsonResponse(req, { error: "Method not allowed" }, 405);
    }

    const rateLimited = enforceRateLimit(req, "photo-proxy-get", 180, 60_000);
    if (rateLimited) return rateLimited;

    const verified = await verifySignedPhotoRequest(new URL(req.url));
    if (!verified.ok) {
      return jsonResponse(req, { error: verified.error }, verified.status);
    }

    return await proxyPlacePhotoV1(String(verified.photoName), verified.maxwidth, req);
  } catch (error) {
    return internalError(req, "photo-proxy", error);
  }
});
