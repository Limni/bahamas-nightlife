// Supabase Edge Function: invite someone to Nassau Nights.
//
// /admin/users calls this instead of Supabase's own invite email: on the free
// plan the built-in mailer's templates can't be edited (and it only delivers
// to the project's team). So this function
//   1. checks the caller is an admin (is_admin() with the caller's own token),
//   2. creates the invite with auth.admin.generateLink — the account and a
//      one-time "accept" link, but no email from Supabase,
//   3. emails our own styled invitation through Resend when RESEND_API_KEY and
//      INVITE_FROM are set; otherwise it returns the link and the admin shares
//      it (copy / WhatsApp / their own email app).
//
// Deploy: Dashboard → Edge Functions → Deploy a new function → "Via editor",
// name it `invite-member` and paste this file (or `supabase functions deploy
// invite-member`). Keep "Verify JWT" on. SUPABASE_URL / SUPABASE_ANON_KEY /
// SUPABASE_SERVICE_ROLE_KEY are provided automatically; the optional email
// secrets go in Edge Functions → Secrets (see DEPLOY.md, "Member invitations").
//
// Body: { email, display_name?, make_admin?, redirect_to? }
// Reply: { user_id, emailed: true } or { user_id, emailed: false, link, warning? }.
// Re-inviting someone who hasn't accepted yet makes a fresh link (the old one
// stops working); an account that's already confirmed gets a 409.

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

  // Who's asking, checked with their own token so is_admin() sees them.
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
  const invitedBy = inviter?.display_name && inviter.display_name !== 'Member' ? inviter.display_name : 'The Nassau Nights team';

  const { data, error } = await admin.auth.admin.generateLink({
    type: 'invite',
    email,
    options: {
      redirectTo,
      // Becomes raw_user_meta_data: handle_new_user() reads display_name for the profile.
      data: { ...(displayName ? { display_name: displayName } : {}), invited_by: invitedBy },
    },
  });
  if (error || !data?.user || !data.properties?.action_link) {
    const exists = /already (been )?registered|already exists/i.test(error?.message ?? '');
    return json(
      { error: exists ? 'There’s already an account with that email.' : (error?.message ?? 'Invite failed') },
      exists ? 409 : 400,
    );
  }
  const userId = data.user.id;
  const link = data.properties.action_link;

  const warnings: string[] = [];
  if (body.make_admin === true) {
    const { error: adminError } = await admin
      .from('admins')
      .upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true });
    if (adminError) warnings.push(`They couldn’t be made an admin: ${adminError.message}`);
  }

  const resendKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('INVITE_FROM'); // e.g. "Nassau Nights <hello@nassaunights.com>"
  if (!resendKey || !from) {
    return json({ user_id: userId, emailed: false, link, ...(warnings.length ? { warning: warnings.join(' ') } : {}) });
  }

  const name = displayName || String(data.user.user_metadata?.display_name ?? '');
  let siteUrl: string | null = null;
  try {
    siteUrl = redirectTo ? new URL(redirectTo).origin : null;
  } catch {
    /* not a URL: no logo */
  }
  const message = inviteEmail({ link, email, name: name === 'Member' ? '' : name, invitedBy, siteUrl });
  const sent = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [email], subject: message.subject, html: message.html, text: message.text }),
  });
  if (!sent.ok) {
    // The invite exists either way; hand the link back so it can still be shared.
    const detail = await sent.text().catch(() => '');
    warnings.push(`The email couldn’t be sent (${sent.status}${detail ? `: ${detail.slice(0, 160)}` : ''}). Share the link instead.`);
    return json({ user_id: userId, emailed: false, link, warning: warnings.join(' ') });
  }
  return json({ user_id: userId, emailed: true, ...(warnings.length ? { warning: warnings.join(' ') } : {}) });
});

// ---------------------------------------------------------------------------
// The invitation email, in the site's neon style. Inline styles and tables
// only: most mail apps drop <style> blocks and flexbox. Names are escaped
// (they're typed by people).
// ---------------------------------------------------------------------------

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function inviteEmail(o: { link: string; email: string; name: string; invitedBy: string; siteUrl: string | null }) {
  const name = esc(o.name);
  const by = esc(o.invitedBy);
  const link = esc(o.link);
  const subject = o.name ? `${o.name}, you’re invited to Nassau Nights 🌴` : 'You’re invited to Nassau Nights 🌴';
  const font = `'DM Sans', Arial, Helvetica, sans-serif`;
  const display = `'Unbounded', 'Arial Black', Arial, Helvetica, sans-serif`;

  const perk = (icon: string, title: string, text: string, last = false) => `
    <tr>
      <td width="44" valign="top" style="padding:0 0 ${last ? 4 : 18}px 0; font-size:22px; line-height:28px;">${icon}</td>
      <td valign="top" style="padding:0 0 ${last ? 4 : 18}px 0; font-family:${font}; font-size:15px; line-height:1.5; color:#c9bfdf;">
        <strong style="color:#ffffff;">${title}</strong> ${text}
      </td>
    </tr>`;

  const logo = o.siteUrl
    ? `<td style="padding-right:12px; vertical-align:middle;"><img src="${esc(o.siteUrl)}/icons/icon-192.png" width="44" height="44" alt="" style="display:block; width:44px; height:44px; border:0; border-radius:12px;" /></td>`
    : '';

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta name="color-scheme" content="dark light" />
  <meta name="supported-color-schemes" content="dark light" />
  <title>${esc(subject)}</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&amp;family=Unbounded:wght@700;800&amp;display=swap" rel="stylesheet" />
</head>
<body style="margin:0; padding:0; background-color:#0a0714; -webkit-text-size-adjust:100%;">
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:#0a0714;">
    ${by} saved you a spot on Nassau&rsquo;s live nightlife guide. Tap to accept.&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0a0714" style="background-color:#0a0714; background-image:radial-gradient(circle at 15% 0%, rgba(247,47,176,0.22), transparent 55%), radial-gradient(circle at 90% 100%, rgba(6,182,212,0.18), transparent 50%);">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  ${logo}
                  <td style="vertical-align:middle; font-family:${display}; font-size:22px; font-weight:800; letter-spacing:-0.5px; color:#ffffff;">
                    Nassau <span style="color:#ff94de; text-shadow:0 0 12px rgba(247,47,176,0.85);">Nights</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td bgcolor="#130e24" style="background-color:#130e24; border:1px solid #2d2449; border-radius:28px; overflow:hidden;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td height="4" bgcolor="#f72fb0" style="height:4px; line-height:4px; font-size:4px; background-color:#f72fb0; background-image:linear-gradient(90deg, #f72fb0, #a855f7, #06b6d4); border-radius:28px 28px 0 0;">&nbsp;</td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:36px 36px 8px 36px;">
                    <p style="margin:0 0 14px 0; font-family:${font}; font-size:12px; font-weight:700; letter-spacing:2.5px; text-transform:uppercase; color:#67e8f9;">&#9679;&nbsp; You&rsquo;re invited</p>
                    <h1 style="margin:0; font-family:${display}; font-size:30px; line-height:1.2; font-weight:800; letter-spacing:-0.5px; color:#ffffff;">
                      ${name ? `${name}, you&rsquo;re on the&nbsp;list.` : 'You&rsquo;re on the&nbsp;list.'}
                    </h1>
                    <p style="margin:18px 0 0 0; font-family:${font}; font-size:16px; line-height:1.65; color:#c9bfdf;">
                      <strong style="color:#ffffff;">${by}</strong> invited you to join <strong style="color:#ffffff;">Nassau Nights</strong>, the live guide to Nassau after dark: bars, clubs, beach bars and tonight&rsquo;s events, on a map that shows where it&rsquo;s buzzing right now.
                    </p>
                  </td>
                </tr>
                <tr>
                  <td align="left" style="padding:28px 36px 8px 36px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td align="center" bgcolor="#f72fb0" style="border-radius:16px; background-color:#f72fb0; background-image:linear-gradient(135deg, #f72fb0, #06b6d4); box-shadow:0 0 24px rgba(247,47,176,0.55);">
                          <a href="${link}" target="_blank" style="display:inline-block; padding:16px 34px; font-family:${font}; font-size:16px; font-weight:700; color:#ffffff; text-decoration:none; border-radius:16px;">Accept invitation &nbsp;&rarr;</a>
                        </td>
                      </tr>
                    </table>
                    <p style="margin:14px 0 0 0; font-family:${font}; font-size:13px; line-height:1.5; color:#a397c2;">
                      You&rsquo;ll choose a password, and you&rsquo;re in. The link works once and expires in 24&nbsp;hours.
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:28px 36px 8px 36px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #2d2449;">
                      <tr>
                        <td style="padding-top:24px;">
                          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                            ${perk('&#128293;', 'See where it&rsquo;s buzzing.', 'Live crowd levels on the map, compared with each spot&rsquo;s usual night.')}
                            ${perk('&#127881;', 'Never miss the night.', 'DJ sets, live bands, ladies nights and beach parties, tonight and every week.')}
                            ${perk('&#11088;', 'Have your say.', 'Rate and review your spots, and send tips that keep the guide fresh.', true)}
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:24px 36px 36px 36px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td bgcolor="#1d1633" style="background-color:#1d1633; border-radius:14px; padding:14px 16px; font-family:${font}; font-size:12px; line-height:1.5; color:#a397c2;">
                          Button not working? Paste this into your browser:<br />
                          <a href="${link}" style="color:#ff94de; word-break:break-all; text-decoration:underline;">${link}</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:28px 24px 0 24px; font-family:${font}; font-size:12px; line-height:1.6; color:#7a6d9c;">
              This invitation was sent to ${esc(o.email)}.<br />
              Not expecting it? Ignore this email; no account is active until you accept.<br /><br />
              ${o.siteUrl ? `<a href="${esc(o.siteUrl)}" style="color:#a397c2; text-decoration:none;">Nassau Nights</a>` : 'Nassau Nights'} &middot; Nassau, Bahamas &#127796;
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  // Plain-text part: better deliverability, and what some watches/clients show.
  const text = [
    o.name ? `${o.name}, you're on the list.` : `You're on the list.`,
    '',
    `${o.invitedBy} invited you to join Nassau Nights, the live guide to Nassau after dark: bars, clubs, beach bars and tonight's events.`,
    '',
    `Accept your invitation (you'll choose a password):`,
    o.link,
    '',
    'The link works once and expires in 24 hours.',
    `Not expecting this? Ignore it; no account is active until you accept.`,
  ].join('\n');

  return { subject, html, text };
}
