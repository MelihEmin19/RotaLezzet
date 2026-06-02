import * as Linking from "expo-linking";
import type { Session } from "@supabase/supabase-js";

import { getSupabaseClient } from "./supabase";

/** Supabase sifre sifirlama / auth callback icin mobil yonlendirme adresi. */
export function getAuthRedirectUri(): string {
  return Linking.createURL("auth/callback");
}

function parseAuthParams(url: string): URLSearchParams {
  const hashIndex = url.indexOf("#");
  if (hashIndex >= 0) {
    return new URLSearchParams(url.slice(hashIndex + 1));
  }
  const queryIndex = url.indexOf("?");
  if (queryIndex >= 0) {
    return new URLSearchParams(url.slice(queryIndex + 1));
  }
  return new URLSearchParams();
}

function getQueryParam(url: string, key: string): string | null {
  const fromParsed = Linking.parse(url).queryParams?.[key];
  if (typeof fromParsed === "string" && fromParsed.length > 0) return fromParsed;
  if (Array.isArray(fromParsed) && typeof fromParsed[0] === "string") return fromParsed[0];
  return parseAuthParams(url).get(key);
}

export type AuthCallbackResult = {
  isRecovery: boolean;
  hasSession: boolean;
};

export async function applyAuthCallbackFromUrl(
  url: string,
  setSession: (accessToken: string, refreshToken: string) => Promise<void>,
): Promise<AuthCallbackResult> {
  const accessToken = getQueryParam(url, "access_token");
  const refreshToken = getQueryParam(url, "refresh_token");
  const type = getQueryParam(url, "type");

  if (accessToken && refreshToken) {
    await setSession(accessToken, refreshToken);
    return {
      isRecovery: type === "recovery",
      hasSession: true,
    };
  }

  const tokenHash = getQueryParam(url, "token_hash");
  if (tokenHash) {
    const session = await verifyTokenHash(tokenHash, type ?? "email");
    if (session) {
      return { isRecovery: type === "recovery", hasSession: true };
    }
    return { isRecovery: false, hasSession: false };
  }

  const code = getQueryParam(url, "code");
  if (code) {
    const session = await exchangePkceCode(code);
    if (session) {
      return { isRecovery: type === "recovery", hasSession: true };
    }
  }

  return { isRecovery: false, hasSession: false };
}

async function verifyTokenHash(tokenHash: string, type: string): Promise<Session | null> {
  const supabase = getSupabaseClient();
  const otpType =
    type === "signup" || type === "email" || type === "recovery" || type === "invite"
      ? type
      : "email";
  const { data, error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: otpType,
  });
  if (error) throw error;
  return data.session ?? null;
}

async function exchangePkceCode(code: string): Promise<Session | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) throw error;
  return data.session ?? null;
}

export function isAuthCallbackUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return (
    url.includes("access_token") ||
    url.includes("token_hash") ||
    url.includes("code=") ||
    /[?&#]type=(signup|email|recovery)/i.test(url)
  );
}
