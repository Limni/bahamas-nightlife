import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** False until .env.local is filled in — the app shows setup steps instead of crashing. */
export const supabaseConfigured = !!url && !!anonKey && !url.includes('YOUR-PROJECT');

// Email links (invite, recovery, sign-up) land with `#access_token=…&type=…`
// or `#error_code=…`. Read it before createClient, which clears the hash.
const hash = typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.hash.slice(1));
/** The kind of email link this page was opened from ('invite', 'recovery', 'signup'…), if any. */
export const authLinkType = hash.get('access_token') ? hash.get('type') : null;
/** Why an email link didn't work (e.g. 'otp_expired'), if it didn't. */
export const authLinkError = hash.get('error_code') ?? hash.get('error');

export const supabase = createClient(
  supabaseConfigured ? url! : 'https://placeholder.supabase.co',
  supabaseConfigured ? anonKey! : 'placeholder',
);

export const MEDIA_BUCKET = 'venue-media';
export const SUBMISSION_BUCKET = 'submission-uploads';
