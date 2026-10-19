import { useEffect, useState } from 'react';
import { supabase, supabaseConfigured } from './supabase';

// ---------------------------------------------------------------------------
// Rewards at partner venues (a sponsorship deal; see docs/rewards.md). The
// member shows a QR code (create_redeem_code(): 8 characters, 5 minutes, one
// use); venue staff scan it in /manage/redeem. All checks are in SQL.
// ---------------------------------------------------------------------------

export interface Reward {
  id: string;
  venue_id: string;
  title: string;
  description: string | null;
  cost: number;
  nightly_limit: number | null;
  is_active: boolean;
  sort: number;
}

export type RewardWithVenue = Reward & { venues: { name: string; slug: string; cover_url: string | null } | null };

/** Active rewards at this venue; RLS returns none unless it's a current partner. */
export function useVenueRewards(venueId: string) {
  const [rewards, setRewards] = useState<Reward[]>([]);
  useEffect(() => {
    if (!supabaseConfigured) return;
    let alive = true;
    supabase
      .from('rewards')
      .select('*')
      .eq('venue_id', venueId)
      .eq('is_active', true)
      .order('sort')
      .order('cost')
      .then(({ data, error }) => alive && setRewards(error ? [] : ((data ?? []) as Reward[])));
    return () => {
      alive = false;
    };
  }, [venueId]);
  return rewards;
}

/** Every active reward at every partner venue ("Where to use your points"). */
export function useAllRewards(enabled = true) {
  const [rewards, setRewards] = useState<RewardWithVenue[]>([]);
  useEffect(() => {
    if (!supabaseConfigured || !enabled) return;
    let alive = true;
    supabase
      .from('rewards')
      .select('*, venues(name, slug, cover_url)')
      .eq('is_active', true)
      .order('cost')
      .then(({ data, error }) => alive && setRewards(error ? [] : ((data ?? []) as unknown as RewardWithVenue[])));
    return () => {
      alive = false;
    };
  }, [enabled]);
  return rewards;
}

/** Codes are 8 of A–Z/2–9 (no 0/O/1/I). Accepts the code, "K7Q2 M9XP", or the QR's /manage/redeem?code= link. */
export function parseRedeemCode(text: string): string | null {
  let raw = text.trim();
  try {
    const url = new URL(raw);
    raw = url.searchParams.get('code') ?? '';
  } catch {
    /* not a link */
  }
  const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z0-9]{8}$/.test(code) ? code : null;
}

export const formatCode = (code: string) => `${code.slice(0, 4)} ${code.slice(4)}`;

/** What the QR holds: a link, so staff can also scan it with the phone's own camera app. */
export const redeemUrl = (code: string) => `${window.location.origin}/manage/redeem?code=${code}`;

export type CodeResult =
  | { status: 'ok'; code: string; expires_at: string; balance: number }
  | { status: 'signed_out' | 'suspended' | 'disabled' };

export type CodeStatus =
  | { status: 'waiting'; expires_at: string }
  | { status: 'used'; title: string | null; points: number | null; venue: string | null; balance: number }
  | { status: 'expired' | 'unknown' };

export async function createRedeemCode(): Promise<CodeResult | { status: 'error'; message: string }> {
  const { data, error } = await supabase.rpc('create_redeem_code');
  if (error) return { status: 'error', message: error.message };
  return data as CodeResult;
}

export async function redeemCodeStatus(code: string): Promise<CodeStatus | null> {
  const { data, error } = await supabase.rpc('redeem_code_status', { p_code: code });
  return error ? null : (data as CodeStatus);
}
