import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const hash = async (value: string | ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', typeof value === 'string' ? new TextEncoder().encode(value) : value))).map(v => v.toString(16).padStart(2, '0')).join('');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Keep JWT verification enabled. Guests use the public anon token; members
// are verified with getUser. Database/storage writes are service-role only.
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error:'Use POST' }, 405);
  const salt = Deno.env.get('SUBMISSION_RATE_SALT');
  if (!salt || salt.length < 32) return json({ error:'Suggestions are temporarily unavailable. Please try later.' }, 503);
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth:{ persistSession:false, autoRefreshToken:false } });
  try {
    // Bound the body even when Content-Length is absent/chunked.
    const reader = req.body?.getReader();
    if (!reader) return json({ error:'Missing suggestion' }, 400);
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 32 * 1024 * 1024) { await reader.cancel(); return json({ error:'Photos are too large. Please choose fewer or smaller images.' }, 413); }
      chunks.push(value);
    }
    const body = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
    const form = await new Request(req.url, { method:'POST', headers:{ 'Content-Type':req.headers.get('content-type') || '' }, body }).formData();
    const raw = JSON.parse(String(form.get('suggestion') || '{}'));
    const id = String(form.get('request_id') || '');
    if (!uuid.test(id)) return json({ error:'Invalid request ID' }, 400);
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    let userId: string | null = null;
    let email: string | null = null;
    let name: string | null = null;
    if (token !== Deno.env.get('SUPABASE_ANON_KEY')) {
      const { data, error } = await admin.auth.getUser(token);
      if (error || !data.user) return json({ error:'Please sign in again before sending.' }, 401);
      userId = data.user.id; email = data.user.email || null;
      const { data: profile } = await admin.from('profiles').select('display_name').eq('id', userId).single();
      name = profile?.display_name || null;
      const { data: user, error: userError } = await admin.auth.admin.getUserById(userId);
      if (userError || !user.user) return json({ error:'Could not verify your account. Please try later.' },503);
      if (user.user?.banned_until && Date.parse(user.user.banned_until) > Date.now()) return json({ error:'This account cannot send suggestions.' }, 403);
    }
    const text = (v: unknown, max: number) => typeof v === 'string' ? v.trim().slice(0,max) : '';
    const kind = text(raw.kind,20), message = text(raw.message,2000), venueId = raw.venue_id || null;
    if (!['new_spot','update','closed','event','other'].includes(kind) || !message || (venueId && !uuid.test(venueId)) || (['update','closed'].includes(kind) && !venueId)) return json({ error:'Please check the suggestion details.' },400);
    if (venueId) {
      const { data: venue } = await admin.from('venues').select('id').eq('id',venueId).eq('is_published',true).maybeSingle();
      if (!venue) return json({ error:'That venue is no longer listed.' },400);
    }
    const payload = { kind, venue_id:venueId, venue_name:text(raw.venue_name,120) || null, message,
      fields:Array.isArray(raw.fields) ? raw.fields.filter((f: unknown) => typeof f === 'string').slice(0,10).map((f: string)=>f.slice(0,60)) : [],
      contact_name:userId ? name : text(raw.contact_name,80) || null, contact_email:userId ? email : text(raw.contact_email,200) || null,
      credit_ok:raw.credit_ok === true, user_id:userId };
    if (kind === 'new_spot' && !payload.venue_name) return json({ error:'Please name the spot.' },400);
    const files = form.getAll('photos');
    if (files.length > 6) return json({ error:'Choose up to six photos.' },400);
    const uploads: { bytes:ArrayBuffer; type:string; ext:string }[] = [];
    for (const file of files) {
      if (!(file instanceof File) || file.size > 8 * 1024 * 1024) return json({ error:'Each photo must be under 8 MB.' },400);
      const bytes = await file.arrayBuffer(), head = new Uint8Array(bytes);
      const jpeg = head[0] === 255 && head[1] === 216 && head[2] === 255;
      const png = [137,80,78,71,13,10,26,10].every((b,i)=>head[i] === b);
      const webp = new TextDecoder().decode(head.slice(0,4)) === 'RIFF' && new TextDecoder().decode(head.slice(8,12)) === 'WEBP';
      if (!jpeg && !png && !webp) return json({ error:'Please use JPEG, PNG or WebP photos.' },400);
      uploads.push({ bytes, type:jpeg ? 'image/jpeg' : png ? 'image/png' : 'image/webp', ext:jpeg ? 'jpg' : png ? 'png' : 'webp' });
    }
    // Use the last gateway-appended address, never the caller-controlled first
    // entry. Global quota also bounds storage if a gateway/header changes.
    const ip = req.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim();
    if (!userId && !ip) return json({ error:'Suggestions are temporarily unavailable. Please try later.' },503);
    const key = await hash(`${salt}:${userId ? `user:${userId}` : `ip:${ip}`}`);
    const fingerprint = await hash(JSON.stringify(payload) + (await Promise.all(uploads.map(f=>hash(f.bytes)))).join(','));
    const { data: reservation, error: reserveError } = await admin.rpc('reserve_suggestion', { p_id:id, p_key:key, p_fingerprint:fingerprint });
    if (reserveError) return json({ error:'Could not prepare your suggestion. Please try later.' },503);
    if (reservation === 'done') return json({ id });
    if (reservation !== 'ready') return json({ error:reservation === 'conflict' ? 'This request changed. Reload before sending it again.' : 'Please wait before sending another suggestion.' }, reservation === 'conflict' ? 409 : 429);
    const paths: string[] = [];
    for (let i=0;i<uploads.length;i++) {
      const file = uploads[i], path = `inbox/${id}/${i}.${file.ext}`;
      const { error } = await admin.storage.from('submission-uploads').upload(path,file.bytes,{contentType:file.type,upsert:true});
      if (error) throw new Error('Photo upload failed');
      paths.push(path);
    }
    const { error: finishError } = await admin.rpc('finish_suggestion', { p_id:id, p_key:key, p_fingerprint:fingerprint, p_payload:{...payload, photo_paths:paths} });
    if (finishError) throw new Error('Could not save suggestion');
    return json({ id });
  } catch {
    return json({ error:'Could not send your suggestion. Please wait two minutes and try again; retries will not create duplicates.' },400);
  }
});
