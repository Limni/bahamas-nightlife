import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, supabaseConfigured } from './supabase';
import type { Profile } from './types';

// Visitor accounts (Supabase Auth, email + password). Shared by the public
// site and the admin console — signing in once covers both.

interface AuthValue {
  session: Session | null;
  profile: Profile | null;
  isAdmin: boolean;
  /** True until the stored session has been checked on load. */
  loading: boolean;
  /** Set when the visitor arrived from a password-reset email. */
  recovering: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (name: string, email: string, password: string) => Promise<{ error: string | null; needsConfirm: boolean }>;
  sendReset: (email: string) => Promise<string | null>;
  updatePassword: (password: string) => Promise<string | null>;
  updateName: (name: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

const friendly = (message: string) => {
  if (/invalid login credentials/i.test(message)) return 'That email and password don’t match.';
  if (/email not confirmed/i.test(message)) return 'Check your inbox and confirm your email first.';
  if (/already registered/i.test(message)) return 'There’s already an account with that email — sign in instead.';
  if (/signups not allowed/i.test(message)) return 'New sign-ups are switched off right now.';
  return message;
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(supabaseConfigured);
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    if (!supabaseConfigured) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;
  useEffect(() => {
    setProfile(null);
    setIsAdmin(false);
    if (!userId) return;
    supabase.from('profiles').select('*').eq('id', userId).maybeSingle().then(({ data }) => setProfile(data as Profile | null));
    supabase.rpc('is_admin').then(({ data }) => setIsAdmin(data === true));
  }, [userId]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    return error ? friendly(error.message) : null;
  }, []);

  const signUp = useCallback(async (name: string, email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { display_name: name.trim() }, emailRedirectTo: `${window.location.origin}/account` },
    });
    if (error) return { error: friendly(error.message), needsConfirm: false };
    // With "Confirm email" on (the Supabase default) there's no session until they click the link.
    return { error: null, needsConfirm: !data.session };
  }, []);

  const sendReset = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/account`,
    });
    return error ? friendly(error.message) : null;
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (!error) setRecovering(false);
    return error ? friendly(error.message) : null;
  }, []);

  const updateName = useCallback(
    async (name: string) => {
      if (!userId) return 'Not signed in';
      const { data, error } = await supabase
        .from('profiles')
        .update({ display_name: name.trim() })
        .eq('id', userId)
        .select('*')
        .single();
      if (error) return error.message;
      setProfile(data as Profile);
      return null;
    },
    [userId],
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo(
    () => ({ session, profile, isAdmin, loading, recovering, signIn, signUp, sendReset, updatePassword, updateName, signOut }),
    [session, profile, isAdmin, loading, recovering, signIn, signUp, sendReset, updatePassword, updateName, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
