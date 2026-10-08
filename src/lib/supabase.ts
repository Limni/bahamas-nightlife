import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** False until .env.local is filled in — the app shows setup steps instead of crashing. */
export const supabaseConfigured = !!url && !!anonKey && !url.includes('YOUR-PROJECT');

export const supabase = createClient(
  supabaseConfigured ? url! : 'https://placeholder.supabase.co',
  supabaseConfigured ? anonKey! : 'placeholder',
);

export const MEDIA_BUCKET = 'venue-media';
export const SUBMISSION_BUCKET = 'submission-uploads';
