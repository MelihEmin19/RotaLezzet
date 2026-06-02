import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type { Session, User } from "@supabase/supabase-js";

import type { UserProfile } from "../types/auth";
import { withTimeout } from "../services/async";
import { ensureMyProfile, getMyProfile } from "../services/profile";
import { isGuestMode, setGuestMode } from "../services/guestMode";
import { getSupabaseClient } from "../services/supabase";

type AuthContextValue = {
  isLoading: boolean;
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  isGuest: boolean;
  refreshProfile: () => Promise<void>;
  enterGuestMode: () => Promise<void>;
  exitGuestMode: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function loadProfileForUser(user: User | null): Promise<UserProfile | null> {
  if (!user) return null;
  const existing = await withTimeout(
    getMyProfile(user.id),
    10_000,
    "Profil istegi zaman asimina ugradi.",
  );
  if (existing) return existing;
  return withTimeout(
    ensureMyProfile(user),
    10_000,
    "Profil olusturma istegi zaman asimina ugradi.",
  );
}

export function AuthProvider(props: { children: ReactNode }) {
  const [isLoading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isGuest, setIsGuest] = useState(false);

  const refreshProfile = useCallback(async () => {
    const supabase = getSupabaseClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error) throw error;
    const nextProfile = await loadProfileForUser(user);
    setProfile(nextProfile);
  }, []);

  const enterGuestMode = useCallback(async () => {
    await setGuestMode(true);
    setIsGuest(true);
  }, []);

  const exitGuestMode = useCallback(async () => {
    await setGuestMode(false);
    setIsGuest(false);
  }, []);

  useEffect(() => {
    const supabase = getSupabaseClient();
    let mounted = true;

    (async () => {
      try {
        const [{ data: { session: currentSession } }, guest] = await Promise.all([
          withTimeout(supabase.auth.getSession(), 8_000, "Oturum kontrolu zaman asimi"),
          isGuestMode(),
        ]);
        if (!mounted) return;
        setSession(currentSession);
        setIsGuest(guest && !currentSession?.user);
        try {
          setProfile(await loadProfileForUser(currentSession?.user ?? null));
        } catch (error) {
          console.log("[auth-profile-load]", error instanceof Error ? error.message : error);
          setProfile(null);
        }
      } catch (error) {
        console.log("[auth-init]", error instanceof Error ? error.message : error);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      if (nextSession?.user) {
        await setGuestMode(false);
        setIsGuest(false);
      }
      try {
        setProfile(await loadProfileForUser(nextSession?.user ?? null));
      } catch (error) {
        console.log("[auth-state-profile-load]", error instanceof Error ? error.message : error);
        setProfile(null);
      }
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      isLoading,
      session,
      user: session?.user ?? null,
      profile,
      isGuest,
      refreshProfile,
      enterGuestMode,
      exitGuestMode,
    }),
    [enterGuestMode, exitGuestMode, isGuest, isLoading, profile, refreshProfile, session],
  );

  return <AuthContext.Provider value={value}>{props.children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used within AuthProvider.");
  }
  return value;
}
