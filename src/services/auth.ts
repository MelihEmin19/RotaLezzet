import type { AuthError, Session } from "@supabase/supabase-js";

import { getAuthRedirectUri } from "./authRedirect";
import { getSupabaseClient } from "./supabase";

export async function signInWithEmailPassword(email: string, password: string): Promise<Session | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) throw error;
  return data.session;
}

export type SignUpResult = {
  session: Session | null;
  needsOtp: boolean;
};

export async function signUpWithEmailPassword(params: {
  email: string;
  password: string;
  fullName: string;
}): Promise<SignUpResult> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.signUp({
    email: params.email.trim(),
    password: params.password,
    options: {
      emailRedirectTo: getAuthRedirectUri(),
      data: {
        full_name: params.fullName.trim(),
      },
    },
  });
  if (error) throw error;
  return {
    session: data.session ?? null,
    needsOtp: !data.session && Boolean(data.user),
  };
}

export async function verifySignupOtp(params: {
  email: string;
  token: string;
}): Promise<Session | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.verifyOtp({
    email: params.email.trim(),
    token: params.token.trim(),
    type: "signup",
  });
  if (error) {
    if (/expired|invalid/i.test(error.message)) {
      const fallback = await supabase.auth.verifyOtp({
        email: params.email.trim(),
        token: params.token.trim(),
        type: "email",
      });
      if (fallback.error) throw fallback.error;
      return fallback.data.session ?? null;
    }
    throw error;
  }
  return data.session ?? null;
}

export async function resendSignupOtp(email: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: email.trim(),
    options: {
      emailRedirectTo: getAuthRedirectUri(),
    },
  });
  if (error) throw error;
}

export async function signOutCurrentUser(): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function sendPasswordResetEmail(email: string): Promise<void> {
  const supabase = getSupabaseClient();
  const redirectTo = getAuthRedirectUri();
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo,
  });
  if (error) throw error;
}

export async function updatePassword(newPassword: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

export async function setSessionFromTokens(
  accessToken: string,
  refreshToken: string,
): Promise<Session | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (error) throw error;
  return data.session;
}

export function getAuthErrorMessage(error: unknown) {
  if (error instanceof TypeError && /network request failed|failed to fetch/i.test(error.message)) {
    return "İnternet bağlantısı kurulamadı. Wi‑Fi veya mobil veriyi kontrol edip uygulamayı yeniden başlat.";
  }

  const authError = error as AuthError | Error | null;
  if (!authError) return "Bilinmeyen hata";

  const msg = authError.message || "Bilinmeyen hata";
  if (/redirect.*not allowed|invalid redirect/i.test(msg)) {
    return "Şifre sıfırlama adresi Supabase'de tanımlı değil. Dashboard → Authentication → URL Configuration içine rotalezzet://** ekleyin.";
  }
  if (/rate limit|too many|over_email_send|429/i.test(msg)) {
    return "Çok fazla kayıt veya e-posta denemesi yapıldı (Supabase limiti). 30–60 dakika bekleyin. Acilse: Supabase Dashboard → Authentication → Users → Add user ile hesap oluşturup uygulamadan Giriş yapın.";
  }

  return msg;
}
