// Supabase Edge Function: invite someone to Nassau Nights by email.
//
// Sending Supabase's invite email needs the service-role key, which must never
// reach the browser, so /admin/users calls this function instead. It checks
// that the caller is an admin (is_admin() with the caller's own token), then
// calls auth.admin.inviteUserByEmail. Supabase sends the "Invite user" email
// template (paste supabase/templates/invite.html into the dashboard).
//
// Deploy: Dashboard → Edge Functions → Deploy a new function → "Via editor",
// name it `invite-member` and paste this file; or `supabase functions deploy
// invite-member`. SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
// are provided to every function automatically. Keep "Verify JWT" on.
//
// Body: { email, display_name?, make_admin?, redirect_to? }
// Re-inviting someone who hasn't accepted yet sends the email again; an
// account that's already confirmed gets a 409.

import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Who's asking, checked with their own token so RLS and is_admin() apply.
  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: who } = await caller.auth.getUser(jwt);
  const { data: isAdmin } = await caller.rpc('is_admin');
  if (!who?.user || isAdmin !== true) return json({ error: 'Only admins can send invitations' }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad request' }, 400);
  }

  const email = String(body.email ?? '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'That doesn’t look like an email address' }, 400);
  }
  const displayName = String(body.display_name ?? '').trim().slice(0, 40);
  // Supabase only honours redirect URLs on the project's allow list, so a
  // forged value just falls back to the Site URL.
  const redirectTo = typeof body.redirect_to === 'string' ? body.redirect_to : undefined;

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // The email says who invited them (display name, never their email).
  const { data: inviter } = await admin.from('profiles').select('display_name').eq('id', who.user.id).maybeSingle();

  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    // Becomes raw_user_meta_data: handle_new_user() reads display_name for the
    // profile, and the email template reads both via {{ .Data.* }}.
    data: {
      ...(displayName ? { display_name: displayName } : {}),
      invited_by: inviter?.display_name ?? 'The Nassau Nights team',
    },
  });
  if (error || !data?.user) {
    const exists = /already (been )?registered|already exists/i.test(error?.message ?? '');
    return json(
      { error: exists ? 'There’s already an account with that email.' : (error?.message ?? 'Invite failed') },
      exists ? 409 : 400,
    );
  }

  if (body.make_admin === true) {
    const { error: adminError } = await admin
      .from('admins')
      .upsert({ user_id: data.user.id }, { onConflict: 'user_id', ignoreDuplicates: true });
    if (adminError) {
      return json({ user_id: data.user.id, warning: `Invite sent, but they couldn’t be made an admin: ${adminError.message}` });
    }
  }

  return json({ user_id: data.user.id });
});
