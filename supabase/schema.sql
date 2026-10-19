-- =============================================================================
-- Nassau Nights — full database setup (bars, clubs, lounges + events + live
-- activity).
--
-- Run this once in the Supabase dashboard → SQL Editor (or psql). It is
-- idempotent: every statement is safe to re-run, so you can also re-run it
-- after pulling an update to pick up new columns/policies.
--
-- Conventions
--   * Every public table has RLS enabled with explicit policies.
--   * Directory content (venues, photos, menu items, tags, events) is world-
--     readable once published, but only admins can write it.
--   * Live activity comes from anonymous GPS pings (report_presence). Raw
--     coordinates are never stored: a ping only records which venue (if any)
--     the device is inside, and only aggregates are readable.
--   * Community suggestions can be INSERTED by anyone (anon), but only admins
--     can read, update or delete them.
--   * Admins are rows in public.admins (see the bottom of this file for how
--     to make yourself an admin).
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Admins
-- -----------------------------------------------------------------------------
create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;

-- security definer so policies can call it without recursing into admins' RLS.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

drop policy if exists "Admins can see admins" on public.admins;
create policy "Admins can see admins" on public.admins
  for select using (public.is_admin());

-- A member suspended in /admin/users (auth.users.banned_until). Supabase Auth
-- refuses their sign-ins and refreshes, but an access token already issued
-- stays valid until it expires (≤ 1 h), so write policies check this too.
create or replace function public.is_suspended()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from auth.users where id = auth.uid() and banned_until > now());
$$;

-- -----------------------------------------------------------------------------
-- updated_at helper
-- -----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Venues
-- -----------------------------------------------------------------------------
create table if not exists public.venues (
  id             uuid primary key default gen_random_uuid(),
  slug           text unique,
  name           text not null check (char_length(name) between 1 and 120),
  description    text,
  categories     text[] not null default '{}',
  vibes          text[] not null default '{}',
  area           text,
  price_level    smallint check (price_level between 1 and 4),
  phone          text,
  website        text,
  instagram      text,
  facebook       text,
  address        text,
  lat            double precision check (lat between -90 and 90),
  lng            double precision check (lng between -180 and 180),
  -- Weekly hours, Bahamas local time: { "0": {"open":"09:00","close":"22:00"}, ... }
  -- Keys are weekday indexes ("0" = Sunday). A missing day = closed.
  hours          jsonb,
  hours_note     text,               -- e.g. "Kitchen closes at 11, bar runs late"
  cover_url      text,
  is_published   boolean not null default false,
  -- Sponsorship groundwork: featured venues are pinned to the top of the
  -- directory and get a gold marker on the map until featured_until passes.
  is_featured    boolean not null default false,
  featured_until timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists venues_published_idx on public.venues (is_published);

-- Activity geofence: a phone inside this radius of the pin counts as "here".
-- Big beach bars and clubs want more, a hole-in-the-wall bar less.
alter table public.venues add column if not exists radius_m smallint not null default 60
  check (radius_m between 15 and 400);

-- Google Places ID for spots imported by scripts/seed-google.ts. Lets the
-- import be re-run without creating duplicates. Null for hand-added spots.
alter table public.venues add column if not exists google_place_id text unique;

drop trigger if exists venues_touch on public.venues;
create trigger venues_touch
  before update on public.venues
  for each row execute function public.touch_updated_at();

-- Auto-generate a unique URL slug from the name when none is given.
create or replace function public.venues_set_slug()
returns trigger
language plpgsql
as $$
declare
  base      text;
  candidate text;
  n         int := 1;
begin
  if new.slug is null or new.slug = '' then
    base := trim(both '-' from regexp_replace(lower(new.name), '[^a-z0-9]+', '-', 'g'));
    if base = '' then base := 'spot'; end if;
    candidate := base;
    while exists (select 1 from public.venues where slug = candidate and id <> new.id) loop
      n := n + 1;
      candidate := base || '-' || n;
    end loop;
    new.slug := candidate;
  end if;
  return new;
end;
$$;

drop trigger if exists venues_slug on public.venues;
create trigger venues_slug
  before insert or update of slug, name on public.venues
  for each row execute function public.venues_set_slug();

alter table public.venues enable row level security;

drop policy if exists "Published venues are public" on public.venues;
create policy "Published venues are public" on public.venues
  for select using (is_published or public.is_admin());

drop policy if exists "Admins manage venues" on public.venues;
create policy "Admins manage venues" on public.venues
  for all using (public.is_admin()) with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- Photos (gallery + menu pages)
-- -----------------------------------------------------------------------------
create table if not exists public.venue_photos (
  id            uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete cascade,
  kind          text not null default 'gallery' check (kind in ('gallery', 'menu', 'food_menu')),
  url           text not null,
  storage_path  text,               -- path inside the venue-media bucket (for deletes)
  caption       text,
  sort          int not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists venue_photos_venue_idx
  on public.venue_photos (venue_id, kind, sort);

-- Photos of a printed menu: 'menu' = the drinks menu (the original kind, so
-- existing rows keep their meaning), 'food_menu' = the food menu.
alter table public.venue_photos drop constraint if exists venue_photos_kind_check;
alter table public.venue_photos add constraint venue_photos_kind_check
  check (kind in ('gallery', 'menu', 'food_menu'));

alter table public.venue_photos enable row level security;

drop policy if exists "Photos of published venues are public" on public.venue_photos;
create policy "Photos of published venues are public" on public.venue_photos
  for select using (
    public.is_admin()
    or exists (select 1 from public.venues r where r.id = venue_id and r.is_published)
  );

drop policy if exists "Admins manage photos" on public.venue_photos;
create policy "Admins manage photos" on public.venue_photos
  for all using (public.is_admin()) with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- Menu items (optional structured menu; menu photos live in venue_photos)
-- -----------------------------------------------------------------------------
create table if not exists public.menu_items (
  id            uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete cascade,
  section       text not null default 'Menu',
  name          text not null,
  description   text,
  price         numeric(10, 2),
  sort          int not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists menu_items_venue_idx on public.menu_items (venue_id, sort);

-- Separate drinks and food menus. Added later: existing items are sorted
-- into one once, by section name (anything food-sounding goes to food).
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'menu_items' and column_name = 'menu') then
    alter table public.menu_items add column menu text not null default 'drinks';
    update public.menu_items set menu = 'food'
    where section ~* '(food|bite|snack|starter|appetizer|appetiser|main|entree|entrée|plate|platter|burger|wing|taco|pizza|sandwich|salad|soup|side|dessert|kitchen|grill|seafood|conch|fish|chicken|brunch|breakfast|lunch|dinner|eat)';
  end if;
end $$;

alter table public.menu_items drop constraint if exists menu_items_menu_check;
alter table public.menu_items add constraint menu_items_menu_check check (menu in ('drinks', 'food'));

-- One optional photo per item (venue-media: <venue_id>/items/…), and the
-- number of members who like it (kept by a trigger on menu_item_likes).
alter table public.menu_items add column if not exists photo_url  text;
alter table public.menu_items add column if not exists photo_path text;
alter table public.menu_items add column if not exists like_count int not null default 0;

alter table public.menu_items enable row level security;

drop policy if exists "Menu items of published venues are public" on public.menu_items;
create policy "Menu items of published venues are public" on public.menu_items
  for select using (
    public.is_admin()
    or exists (select 1 from public.venues r where r.id = venue_id and r.is_published)
  );

drop policy if exists "Admins manage menu items" on public.menu_items;
create policy "Admins manage menu items" on public.menu_items
  for all using (public.is_admin()) with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- Tags — the filter vocabularies (category / vibe / area). Managed from the
-- admin console so new options never need a code change.
-- -----------------------------------------------------------------------------
create table if not exists public.tags (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('category', 'vibe', 'area')),
  label      text not null check (char_length(label) between 1 and 60),
  sort       int not null default 0,
  created_at timestamptz not null default now(),
  unique (kind, label)
);

alter table public.tags enable row level security;

drop policy if exists "Tags are public" on public.tags;
create policy "Tags are public" on public.tags for select using (true);

drop policy if exists "Admins manage tags" on public.tags;
create policy "Admins manage tags" on public.tags
  for all using (public.is_admin()) with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- Community suggestions
-- -----------------------------------------------------------------------------
create table if not exists public.submissions (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('new_spot', 'update', 'closed', 'event', 'other')),
  venue_id   uuid references public.venues (id) on delete set null,
  venue_name      text check (char_length(venue_name) <= 120),
  fields          text[] not null default '{}',   -- what changed: phone, hours, menu, ...
  message         text not null check (char_length(message) between 1 and 2000),
  contact_name    text check (char_length(contact_name) <= 80),
  contact_email   text check (char_length(contact_email) <= 200),
  credit_ok       boolean not null default true,  -- OK to thank them publicly by first name
  photo_paths     text[] not null default '{}',   -- paths in the private submission-uploads bucket
  status          text not null default 'new' check (status in ('new', 'reviewing', 'done', 'dismissed')),
  admin_note      text,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now(),
  constraint submissions_photo_limit check (coalesce(array_length(photo_paths, 1), 0) <= 6)
);

create index if not exists submissions_status_idx on public.submissions (status, created_at desc);

-- Stamp resolved_at when a suggestion is marked done/dismissed.
create or replace function public.submissions_resolve()
returns trigger
language plpgsql
as $$
begin
  if new.status in ('done', 'dismissed') and (old.status is distinct from new.status) then
    new.resolved_at := now();
  elsif new.status in ('new', 'reviewing') then
    new.resolved_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists submissions_resolve on public.submissions;
create trigger submissions_resolve
  before update on public.submissions
  for each row execute function public.submissions_resolve();

alter table public.submissions enable row level security;

-- Anyone may submit, but only as a fresh, untriaged suggestion.
drop policy if exists "Anyone can submit suggestions" on public.submissions;
create policy "Anyone can submit suggestions" on public.submissions
  for insert to anon, authenticated
  with check (status = 'new' and admin_note is null and resolved_at is null);

drop policy if exists "Admins read suggestions" on public.submissions;
create policy "Admins read suggestions" on public.submissions
  for select using (public.is_admin());

drop policy if exists "Admins update suggestions" on public.submissions;
create policy "Admins update suggestions" on public.submissions
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admins delete suggestions" on public.submissions;
create policy "Admins delete suggestions" on public.submissions
  for delete using (public.is_admin());

-- Public "community wins" feed: only first names of people who opted in, and
-- only for suggestions that were actually applied. No emails, no messages.
create or replace function public.recent_contributions(p_limit int default 12)
returns table (first_name text, kind text, venue_name text, resolved_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(nullif(split_part(trim(coalesce(s.contact_name, '')), ' ', 1), ''), 'A local') as first_name,
    s.kind,
    coalesce(r.name, s.venue_name) as venue_name,
    s.resolved_at
  from public.submissions s
  left join public.venues r on r.id = s.venue_id and r.is_published
  where s.status = 'done' and s.credit_ok
  order by s.resolved_at desc nulls last
  limit least(greatest(p_limit, 1), 50);
$$;

create or replace function public.contribution_count()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select count(*) from public.submissions where status = 'done';
$$;

grant execute on function public.recent_contributions(int) to anon, authenticated;
grant execute on function public.contribution_count() to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Storage
--   venue-media     public  — gallery, menu photos, covers, event flyers and
--                             short videos (admin/manager write). 25 MB per file:
--                             photos are compressed and videos re-encoded in the
--                             browser first, so real uploads are far smaller.
--   submission-uploads   private — photos attached to community suggestions
--                                  (anyone can upload; only admins can view)
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('venue-media', 'venue-media', true, 26214400,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
              'video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do update
  set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('submission-uploads', 'submission-uploads', false, 8388608,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Venue media is readable" on storage.objects;
create policy "Venue media is readable" on storage.objects
  for select using (bucket_id = 'venue-media');

drop policy if exists "Admins upload venue media" on storage.objects;
create policy "Admins upload venue media" on storage.objects
  for insert with check (bucket_id = 'venue-media' and public.is_admin());

drop policy if exists "Admins update venue media" on storage.objects;
create policy "Admins update venue media" on storage.objects
  for update using (bucket_id = 'venue-media' and public.is_admin());

drop policy if exists "Admins delete venue media" on storage.objects;
create policy "Admins delete venue media" on storage.objects
  for delete using (bucket_id = 'venue-media' and public.is_admin());

drop policy if exists "Anyone can upload suggestion photos" on storage.objects;
create policy "Anyone can upload suggestion photos" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'submission-uploads' and (storage.foldername(name))[1] = 'inbox');

drop policy if exists "Admins read suggestion photos" on storage.objects;
create policy "Admins read suggestion photos" on storage.objects
  for select using (bucket_id = 'submission-uploads' and public.is_admin());

drop policy if exists "Admins delete suggestion photos" on storage.objects;
create policy "Admins delete suggestion photos" on storage.objects
  for delete using (bucket_id = 'submission-uploads' and public.is_admin());

-- -----------------------------------------------------------------------------
-- Starter filter vocabularies (edit freely in the admin console → Tags)
-- -----------------------------------------------------------------------------
insert into public.tags (kind, label, sort) values
  ('category', 'Nightclub', 1), ('category', 'Cocktail Bar', 2), ('category', 'Lounge', 3),
  ('category', 'Beach Bar', 4), ('category', 'Rooftop Bar', 5), ('category', 'Live Music', 6),
  ('category', 'Sports Bar', 7), ('category', 'Pub', 8), ('category', 'Wine Bar', 9),
  ('category', 'Rum Bar', 10), ('category', 'Karaoke', 11), ('category', 'Casino', 12),
  ('category', 'Hookah Lounge', 13), ('category', 'Dive Bar', 14), ('category', 'Fish Fry & Bar', 15),
  ('category', 'Hotel Bar', 16), ('category', 'Bar & Grill', 17), ('category', 'Local Bar', 18),
  ('vibe', 'Dancing', 1), ('vibe', 'DJ Sets', 2), ('vibe', 'Live Band', 3),
  ('vibe', 'Happy Hour', 4), ('vibe', 'Late Night', 5), ('vibe', 'Waterfront', 6),
  ('vibe', 'Rooftop Views', 7), ('vibe', 'Dress to Impress', 8), ('vibe', 'Laid-back', 9),
  ('vibe', 'Local Favourite', 10), ('vibe', 'Date Night', 11), ('vibe', 'Group Friendly', 12),
  ('vibe', 'Ladies Night', 13), ('vibe', 'Bottle Service', 14), ('vibe', 'Outdoor', 15),
  ('vibe', 'Rake ''n'' Scrape', 16), ('vibe', 'Karaoke Night', 17), ('vibe', 'Hidden Gem', 18),
  ('vibe', 'LGBTQ+ Friendly', 19),
  ('area', 'Downtown / Bay Street', 1), ('area', 'Arawak Cay (Fish Fry)', 2),
  ('area', 'Cable Beach', 3), ('area', 'Paradise Island', 4), ('area', 'West Bay Street', 5),
  ('area', 'East Bay Street', 6), ('area', 'Potter''s Cay', 7), ('area', 'Sandyport', 8),
  ('area', 'Village Road', 9), ('area', 'Palmdale', 10), ('area', 'Love Beach', 11),
  ('area', 'Old Fort Bay / Lyford Cay', 12), ('area', 'Carmichael', 13),
  ('area', 'Prince Charles', 14), ('area', 'Eastern Road', 15), ('area', 'Airport Area', 16)
on conflict (kind, label) do nothing;

-- -----------------------------------------------------------------------------
-- Make yourself an admin (run after creating your user in Authentication → Users):
--
--   insert into public.admins (user_id)
--   select id from auth.users where email = 'you@example.com'
--   on conflict do nothing;
-- -----------------------------------------------------------------------------

-- Live updates: admin edits appear for visitors without a reload.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'venues') then
    alter publication supabase_realtime add table public.venues;
  end if;
end $$;

-- =============================================================================
-- Visitor accounts, ratings & reviews
--
-- Anyone can sign up (Supabase Auth, email + password). Signed-in members can
-- rate + review each published spot once (editable), and their suggestions are
-- linked to their account so they can follow the status.
-- Requires: Authentication → Sign In / Providers → "Allow new users to sign up" ON.
-- =============================================================================

-- Public profile (only a display name is ever shown publicly — never emails).
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'Member' check (char_length(display_name) between 1 and 40),
  created_at   timestamptz not null default now()
);
alter table public.profiles enable row level security;

drop policy if exists "Profiles are public" on public.profiles;
create policy "Profiles are public" on public.profiles for select using (true);

drop policy if exists "Members edit their own profile" on public.profiles;
create policy "Members edit their own profile" on public.profiles
  for update using (id = auth.uid() and not public.is_suspended())
  with check (id = auth.uid() and not public.is_suspended());

-- Admins can rename members (e.g. an offensive display name) in /admin/users.
drop policy if exists "Admins edit profiles" on public.profiles;
create policy "Admins edit profiles" on public.profiles
  for update using (public.is_admin()) with check (public.is_admin());

-- Create a profile for every new sign-up, using the name given at sign-up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), 'Member'), 40)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill accounts that existed before this migration (e.g. your admin login).
insert into public.profiles (id, display_name)
select u.id, left(coalesce(nullif(trim(u.raw_user_meta_data ->> 'display_name'), ''), 'Member'), 40)
from auth.users u
on conflict (id) do nothing;

-- Reviews: one per member per spot.
create table if not exists public.reviews (
  id            uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete cascade,
  user_id       uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  rating        smallint not null check (rating between 1 and 5),
  comment       text check (char_length(comment) <= 2000),
  is_hidden     boolean not null default false,   -- set by admins when moderating
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (venue_id, user_id)
);

create index if not exists reviews_venue_idx on public.reviews (venue_id, created_at desc);
create index if not exists reviews_user_idx on public.reviews (user_id);

drop trigger if exists reviews_touch on public.reviews;
create trigger reviews_touch
  before update on public.reviews
  for each row execute function public.touch_updated_at();

-- Only admins may hide/unhide; members can't un-hide their own moderated review.
create or replace function public.reviews_guard_hidden()
returns trigger
language plpgsql
as $$
begin
  if public.is_admin() then return new; end if;
  if tg_op = 'INSERT' then
    new.is_hidden := false;
  elsif new.is_hidden is distinct from old.is_hidden then
    raise exception 'Only admins can change review visibility';
  end if;
  return new;
end;
$$;

drop trigger if exists reviews_guard on public.reviews;
create trigger reviews_guard
  before insert or update on public.reviews
  for each row execute function public.reviews_guard_hidden();

alter table public.reviews enable row level security;

drop policy if exists "Visible reviews are public" on public.reviews;
create policy "Visible reviews are public" on public.reviews
  for select using (not is_hidden or user_id = auth.uid() or public.is_admin());

drop policy if exists "Members review published spots" on public.reviews;
create policy "Members review published spots" on public.reviews
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and not public.is_suspended()
    and exists (select 1 from public.venues r where r.id = venue_id and r.is_published)
  );

-- Suspended members can still delete (but not edit) their own reviews.
drop policy if exists "Members edit their own reviews" on public.reviews;
create policy "Members edit their own reviews" on public.reviews
  for update using ((user_id = auth.uid() and not public.is_suspended()) or public.is_admin())
  with check ((user_id = auth.uid() and not public.is_suspended()) or public.is_admin());

drop policy if exists "Members or admins delete reviews" on public.reviews;
create policy "Members or admins delete reviews" on public.reviews
  for delete using (user_id = auth.uid() or public.is_admin());

-- Likes on individual menu items (drinks and food): one per member per item.
-- Members only see their own likes; everyone sees menu_items.like_count.
create table if not exists public.menu_item_likes (
  item_id    uuid not null references public.menu_items (id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (item_id, user_id)
);

create index if not exists menu_item_likes_user_idx on public.menu_item_likes (user_id);

alter table public.menu_item_likes enable row level security;

drop policy if exists "Members see their own likes" on public.menu_item_likes;
create policy "Members see their own likes" on public.menu_item_likes
  for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists "Members like items on published spots" on public.menu_item_likes;
create policy "Members like items on published spots" on public.menu_item_likes
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and not public.is_suspended()
    and exists (
      select 1 from public.menu_items m join public.venues v on v.id = m.venue_id
      where m.id = item_id and v.is_published
    )
  );

drop policy if exists "Members unlike their own likes" on public.menu_item_likes;
create policy "Members unlike their own likes" on public.menu_item_likes
  for delete using (user_id = auth.uid() or public.is_admin());

-- security definer: members can't update menu_items themselves.
create or replace function public.menu_item_likes_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.menu_items set like_count = like_count + 1 where id = new.item_id;
  else
    update public.menu_items set like_count = greatest(like_count - 1, 0) where id = old.item_id;
  end if;
  return null;
end;
$$;

drop trigger if exists menu_item_likes_count on public.menu_item_likes;
create trigger menu_item_likes_count
  after insert or delete on public.menu_item_likes
  for each row execute function public.menu_item_likes_count();

-- Re-running the file also repairs any drifted counts.
update public.menu_items m
set like_count = c.n
from (
  select i.id, count(l.item_id)::int as n
  from public.menu_items i left join public.menu_item_likes l on l.item_id = i.id
  group by i.id
) c
where c.id = m.id and m.like_count <> c.n;

-- Per-spot rating summary (visible reviews only). security_invoker makes the
-- view respect the caller's RLS instead of the owner's.
create or replace view public.venue_ratings
with (security_invoker = on) as
select
  venue_id,
  round(avg(rating)::numeric, 2)::float8 as rating_avg,
  count(*)::int                          as rating_count
from public.reviews
where not is_hidden
group by venue_id;

grant select on public.venue_ratings to anon, authenticated;

-- Link suggestions to the signed-in member (anonymous suggestions still work).
alter table public.submissions
  add column if not exists user_id uuid default auth.uid() references public.profiles (id) on delete set null;

drop policy if exists "Anyone can submit suggestions" on public.submissions;
create policy "Anyone can submit suggestions" on public.submissions
  for insert to anon, authenticated
  with check (
    status = 'new' and admin_note is null and resolved_at is null
    and (user_id is null or user_id = auth.uid())
  );

-- A member's own suggestions and their status (admin notes stay private).
create or replace function public.my_submissions()
returns table (
  id uuid, kind text, venue_name text, message text, status text,
  created_at timestamptz, resolved_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.kind, coalesce(r.name, s.venue_name), s.message, s.status, s.created_at, s.resolved_at
  from public.submissions s
  left join public.venues r on r.id = s.venue_id
  where s.user_id = auth.uid()
  order by s.created_at desc
  limit 100;
$$;

revoke execute on function public.my_submissions() from public, anon;
grant execute on function public.my_submissions() to authenticated;

-- =============================================================================
-- Site settings (single row): the public theme, chosen in /admin/theme.
--
-- Theme ids aren't constrained to a list here so new themes ship without a
-- migration; the client falls back to 'neon' for an id it doesn't know.
-- =============================================================================
create table if not exists public.site_settings (
  id         boolean primary key default true check (id),
  theme      text not null default 'neon' check (theme ~ '^[a-z0-9-]{1,40}$'),
  updated_at timestamptz not null default now()
);

insert into public.site_settings (id) values (true) on conflict (id) do nothing;

drop trigger if exists site_settings_touch on public.site_settings;
create trigger site_settings_touch
  before update on public.site_settings
  for each row execute function public.touch_updated_at();

alter table public.site_settings enable row level security;

drop policy if exists "Site settings are public" on public.site_settings;
create policy "Site settings are public" on public.site_settings for select using (true);

drop policy if exists "Admins update site settings" on public.site_settings;
create policy "Admins update site settings" on public.site_settings
  for update using (public.is_admin()) with check (public.is_admin());

-- Live updates: a theme switch repaints open tabs without a reload.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'site_settings') then
    alter publication supabase_realtime add table public.site_settings;
  end if;
end $$;

-- =============================================================================
-- Events — highlighted nights, ported from Island GO's events. An event runs
-- start_date..end_date, optionally only inside weekly hours (same JSON format
-- as venues.hours, Bahamas time). A weekly event with no end_date repeats
-- until an admin ends or deletes it. While it's live it pulses on the map;
-- featured events are pinned first on the Events page and the Explore rail.
-- =============================================================================
create table if not exists public.events (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (char_length(title) between 1 and 140),
  description  text check (char_length(description) <= 4000),
  -- Usually hosted at a listed venue (the event uses its pin). Events away
  -- from one (beach parties, boat cruises, Junkanoo) set their own lat/lng.
  venue_id     uuid references public.venues (id) on delete set null,
  lat          double precision check (lat between -90 and 90),
  lng          double precision check (lng between -180 and 180),
  address      text,
  start_date   timestamptz not null,
  end_date     timestamptz,          -- null = repeats until further notice
  hours        jsonb,
  image_url    text,
  image_path   text,                 -- path inside the venue-media bucket (for deletes)
  price_note   text check (char_length(price_note) <= 80),   -- "$20 at the door", "Free before 11"
  ticket_url   text,
  is_published boolean not null default false,
  is_featured  boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint events_dates check (end_date >= start_date)
);

-- Recurring nights ("Ladies Night every Friday, until further notice"): the
-- weekly hours say which nights, and a null end_date means it never ends.
alter table public.events alter column end_date drop not null;

create index if not exists events_window_idx on public.events (is_published, end_date);
create index if not exists events_venue_idx on public.events (venue_id);

drop trigger if exists events_touch on public.events;
create trigger events_touch
  before update on public.events
  for each row execute function public.touch_updated_at();

alter table public.events enable row level security;

drop policy if exists "Published events are public" on public.events;
create policy "Published events are public" on public.events
  for select using (is_published or public.is_admin());

drop policy if exists "Admins manage events" on public.events;
create policy "Admins manage events" on public.events
  for all using (public.is_admin()) with check (public.is_admin());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'events') then
    alter publication supabase_realtime add table public.events;
  end if;
end $$;

-- =============================================================================
-- Live activity — how busy each venue is right now, and versus its usual.
--
-- Phones with location on (and the visitor's OK) call report_presence() every
-- couple of minutes while the site is open. It works out which venue geofence
-- (venues.radius_m around the pin) the phone is inside and keeps ONE row per
-- device: which venue, since when, last seen. Coordinates are never stored,
-- and a phone that isn't at a venue has no row at all. device_id is a random
-- id the browser rotates every night, so it can't be followed across days.
--
--   * A phone counts as "here" after DWELL (4 min) at the venue, so driving
--     past a bar on West Bay Street doesn't count, and stops counting STALE
--     (15 min) after its last ping.
--   * Each counted phone adds one visitor to the venue's tally for that hour
--     (venue_hourly.visitors), and one arrival per visit (arrivals). The
--     "usual" level and the popular-times chart average the last 8 weeks.
--   * Readable by everyone: venue_live (current count, pushed over Realtime),
--     venue_typical (average visitors per weekday + hour) and venue_stats
--     (30-day visits, busiest usual hour). Nobody can read presence rows.
--   * Counts under 2 are reported as 0, so a lone visitor is never revealed.
--
-- Averages refresh lazily: venue_activity() recomputes them at most once an
-- hour. Optionally schedule activity_housekeeping() every minute with pg_cron
-- so venue_live also decays while nobody is pinging (see the end of this file).
-- =============================================================================

-- Distance in metres. Clamped so floating-point noise can't push asin past 1.
create or replace function public.haversine_m(lat1 float8, lng1 float8, lat2 float8, lng2 float8)
returns float8
language sql
immutable
as $$
  select 12742000 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  )));
$$;

create table if not exists public.presence (
  device_id    uuid primary key,
  venue_id     uuid references public.venues (id) on delete set null,
  arrived_at   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  counted_hour timestamptz            -- last hour bucket this visit was tallied into
);
create index if not exists presence_venue_idx on public.presence (venue_id, last_seen);
alter table public.presence enable row level security;
-- No policies on purpose: only the security-definer functions below touch it.

create table if not exists public.venue_hourly (
  venue_id   uuid not null references public.venues (id) on delete cascade,
  hour_start timestamptz not null,   -- UTC hour bucket
  visitors   int not null default 0, -- distinct phones counted during the hour
  arrivals   int not null default 0, -- visits that started (passed DWELL) during the hour
  primary key (venue_id, hour_start)
);
alter table public.venue_hourly enable row level security;

drop policy if exists "Admins read hourly activity" on public.venue_hourly;
create policy "Admins read hourly activity" on public.venue_hourly
  for select using (public.is_admin());

create table if not exists public.venue_live (
  venue_id   uuid primary key references public.venues (id) on delete cascade,
  live_count int not null default 0, -- already floored: under 2 is stored as 0
  updated_at timestamptz not null default now()
);
alter table public.venue_live enable row level security;

drop policy if exists "Live activity is public" on public.venue_live;
create policy "Live activity is public" on public.venue_live for select using (true);

create table if not exists public.venue_typical (
  venue_id     uuid not null references public.venues (id) on delete cascade,
  dow          smallint not null check (dow between 0 and 6),   -- Nassau time, 0 = Sunday
  hour         smallint not null check (hour between 0 and 23), -- Nassau time
  avg_visitors real not null,
  primary key (venue_id, dow, hour)
);
alter table public.venue_typical enable row level security;

drop policy if exists "Typical activity is public" on public.venue_typical;
create policy "Typical activity is public" on public.venue_typical for select using (true);

create table if not exists public.venue_stats (
  venue_id    uuid primary key references public.venues (id) on delete cascade,
  visits_30d  int not null default 0,
  peak_avg    real not null default 0, -- the venue's busiest usual hour of the week
  computed_at timestamptz not null default now()
);
alter table public.venue_stats enable row level security;

drop policy if exists "Venue stats are public" on public.venue_stats;
create policy "Venue stats are public" on public.venue_stats for select using (true);

create table if not exists public.activity_meta (
  id       boolean primary key default true check (id),
  stats_at timestamptz not null default 'epoch'
);
insert into public.activity_meta (id) values (true) on conflict (id) do nothing;
alter table public.activity_meta enable row level security;

-- Phones at a venue right now (DWELL / STALE rules), floored for privacy.
create or replace function public.activity_live_count(p_venue uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select case when n < 2 then 0 else n end
  from (
    select count(*)::int as n
    from public.presence
    where venue_id = p_venue
      and last_seen > now() - interval '15 minutes'
      and last_seen - arrived_at >= interval '4 minutes'
  ) c;
$$;

-- Write the venue's current count to venue_live, only when it changed (each
-- write is a Realtime event every open tab hears).
create or replace function public.activity_refresh_live(p_venue uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if p_venue is null then return; end if;
  n := public.activity_live_count(p_venue);
  if n = 0 and not exists (select 1 from public.venue_live where venue_id = p_venue) then return; end if;
  insert into public.venue_live as l (venue_id, live_count, updated_at)
  values (p_venue, n, now())
  on conflict (venue_id) do update
    set live_count = excluded.live_count, updated_at = now()
    where l.live_count is distinct from excluded.live_count;
end;
$$;

-- Decay counts of venues nobody has pinged lately, forget quiet devices and
-- trim old tallies. Run lazily from the RPCs below, or every minute by pg_cron.
create or replace function public.activity_housekeeping()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v uuid;
begin
  for v in select venue_id from public.venue_live where live_count > 0 loop
    perform public.activity_refresh_live(v);
  end loop;
  delete from public.presence where last_seen < now() - interval '1 hour';
  delete from public.venue_hourly where hour_start < now() - interval '180 days';
end;
$$;

-- Rebuild venue_typical + venue_stats from the last 8 weeks of tallies.
create or replace function public.activity_refresh_stats()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.venue_typical where true;
  insert into public.venue_typical (venue_id, dow, hour, avg_visitors)
  select h.venue_id,
         extract(dow from h.hour_start at time zone 'America/Nassau')::smallint,
         extract(hour from h.hour_start at time zone 'America/Nassau')::smallint,
         (sum(h.visitors)::real / w.weeks)::real
  from public.venue_hourly h
  -- Average over the weeks the venue has actually been tracked (1..8), so a
  -- new listing isn't diluted by weeks of zeros it never had.
  join (
    select venue_id,
           greatest(1, least(8, round(extract(epoch from now() - min(hour_start)) / 604800.0)))::int as weeks
    from public.venue_hourly
    where hour_start >= now() - interval '8 weeks'
    group by venue_id
  ) w on w.venue_id = h.venue_id
  where h.hour_start >= now() - interval '8 weeks'
    and h.hour_start < date_trunc('hour', now())   -- the current hour is still filling up
  group by h.venue_id, 2, 3, w.weeks;

  insert into public.venue_stats (venue_id, visits_30d, peak_avg, computed_at)
  select v.id, coalesce(a.n, 0), coalesce(t.peak, 0), now()
  from public.venues v
  left join (
    select venue_id, sum(arrivals)::int as n
    from public.venue_hourly
    where hour_start >= now() - interval '30 days'
    group by venue_id
  ) a on a.venue_id = v.id
  left join (
    select venue_id, max(avg_visitors) as peak from public.venue_typical group by venue_id
  ) t on t.venue_id = v.id
  on conflict (venue_id) do update
    set visits_30d = excluded.visits_30d, peak_avg = excluded.peak_avg, computed_at = excluded.computed_at;

  update public.activity_meta set stats_at = now() where id;
end;
$$;

-- Called by the browser every ~2 minutes while location sharing is on.
-- Returns the venue the device is at (null when it isn't at one).
create or replace function public.report_presence(
  p_device   uuid,
  p_lat      float8,
  p_lng      float8,
  p_accuracy float8 default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  prev  public.presence;
  cur   public.presence;
  had   boolean;
  hit   uuid;
  hour_now constant timestamptz := date_trunc('hour', now());
begin
  if p_device is null or p_lat is null or p_lng is null
     or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    return null;
  end if;

  select * into prev from public.presence where device_id = p_device for update;
  had := found;

  -- One ping per device per 45 s; the client sends one every ~2 minutes.
  if had and prev.last_seen > now() - interval '45 seconds' then
    return prev.venue_id;
  end if;

  if p_accuracy is not null and p_accuracy > 100 then
    -- GPS gets fuzzy indoors. Keep a phone at the venue it was already at
    -- while the fix still roughly covers it; otherwise we can't tell where it
    -- is, so change nothing and let the row go stale.
    if had and prev.venue_id is not null and prev.last_seen > now() - interval '15 minutes' then
      select v.id into hit
      from public.venues v
      where v.id = prev.venue_id
        and public.haversine_m(p_lat, p_lng, v.lat, v.lng) <= v.radius_m + least(p_accuracy, 250);
    end if;
    if hit is null then return null; end if;
  else
    -- Nearest published venue whose geofence contains the fix (with a little
    -- slack for GPS error). The bounding box keeps it to nearby rows.
    select v.id into hit
    from public.venues v
    where v.is_published and v.lat is not null and v.lng is not null
      and v.lat between p_lat - 0.005 and p_lat + 0.005
      and v.lng between p_lng - 0.006 and p_lng + 0.006
      and public.haversine_m(p_lat, p_lng, v.lat, v.lng) <= v.radius_m + least(coalesce(p_accuracy, 0), 30)
    order by public.haversine_m(p_lat, p_lng, v.lat, v.lng)
    limit 1;
  end if;

  if hit is null then
    -- Not at a venue: keep nothing about this device.
    if had then
      delete from public.presence where device_id = p_device;
      perform public.activity_refresh_live(prev.venue_id);
    end if;
    return null;
  end if;

  if had and prev.venue_id = hit and prev.last_seen > now() - interval '15 minutes' then
    update public.presence set last_seen = now() where device_id = p_device returning * into cur;
  else
    -- Arrived (or came back after a gap): a new visit starts its DWELL clock.
    insert into public.presence as p (device_id, venue_id, arrived_at, last_seen, counted_hour)
    values (p_device, hit, now(), now(), null)
    on conflict (device_id) do update
      set venue_id = excluded.venue_id, arrived_at = now(), last_seen = now(), counted_hour = null
    returning * into cur;
    if had and prev.venue_id is distinct from hit then
      perform public.activity_refresh_live(prev.venue_id);
    end if;
  end if;

  -- Tally the visit once per hour after DWELL; the first tally is the arrival.
  if cur.last_seen - cur.arrived_at >= interval '4 minutes' and cur.counted_hour is distinct from hour_now then
    insert into public.venue_hourly as h (venue_id, hour_start, visitors, arrivals)
    values (hit, hour_now, 1, case when cur.counted_hour is null then 1 else 0 end)
    on conflict (venue_id, hour_start) do update
      set visitors = h.visitors + 1, arrivals = h.arrivals + excluded.arrivals;
    update public.presence set counted_hour = hour_now where device_id = p_device;
  end if;

  perform public.activity_refresh_live(hit);

  -- Housekeeping, amortised over pings.
  if random() < 0.02 then
    perform public.activity_housekeeping();
  end if;

  return hit;
end;
$$;

-- Everything the site needs to show activity, one row per venue that has any:
-- phones there now, the usual count for this weekday + hour, the venue's
-- busiest usual hour (for scale) and visits over the last 30 days.
create or replace function public.venue_activity()
returns table (venue_id uuid, live_count int, typical_now real, peak_avg real, visits_30d int)
language plpgsql
security definer
set search_path = public
as $$
declare
  local_now constant timestamp := now() at time zone 'America/Nassau';
begin
  -- Lazily refresh the averages, at most hourly and by one caller at a time.
  if (select stats_at from public.activity_meta where id) < now() - interval '1 hour' then
    if pg_try_advisory_xact_lock(hashtext('nassau-nights-activity-stats')) then
      perform public.activity_refresh_stats();
      perform public.activity_housekeeping();
    end if;
  end if;

  return query
  with live as (
    select p.venue_id as vid, count(*)::int as n
    from public.presence p
    where p.venue_id is not null
      and p.last_seen > now() - interval '15 minutes'
      and p.last_seen - p.arrived_at >= interval '4 minutes'
    group by p.venue_id
  )
  select v.id,
         case when coalesce(l.n, 0) < 2 then 0 else l.n end,
         coalesce(t.avg_visitors, 0)::real,
         coalesce(s.peak_avg, 0)::real,
         coalesce(s.visits_30d, 0)
  from public.venues v
  left join live l on l.vid = v.id
  left join public.venue_typical t
    on t.venue_id = v.id
   and t.dow = extract(dow from local_now)::smallint
   and t.hour = extract(hour from local_now)::smallint
  left join public.venue_stats s on s.venue_id = v.id
  where v.is_published
    and (l.n is not null or t.avg_visitors is not null or coalesce(s.visits_30d, 0) > 0 or coalesce(s.peak_avg, 0) > 0);
end;
$$;

-- Internal helpers are not callable through the API.
revoke execute on function public.activity_live_count(uuid) from public, anon, authenticated;
revoke execute on function public.activity_refresh_live(uuid) from public, anon, authenticated;
revoke execute on function public.activity_housekeeping() from public, anon, authenticated;
revoke execute on function public.activity_refresh_stats() from public, anon, authenticated;

grant execute on function public.report_presence(uuid, float8, float8, float8) to anon, authenticated;
grant execute on function public.venue_activity() to anon, authenticated;

-- Live counts change → open tabs refetch venue_activity().
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'venue_live') then
    alter publication supabase_realtime add table public.venue_live;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Optional: decay live counts every minute even when nobody is pinging.
-- Enable the pg_cron extension (Database → Extensions), then run once:
--
--   select cron.schedule('nassau-nights-activity', '* * * * *',
--                        'select public.activity_housekeeping()');
-- -----------------------------------------------------------------------------

-- =============================================================================
-- Member administration (/admin/users)
--
-- Accounts live in auth.users, which the API can't read, so admins manage
-- them through these security-definer functions. Each one checks is_admin()
-- itself. Emails come back only to admins.
--
-- Guard rails: you can't demote, suspend or delete yourself (so at least one
-- admin always remains), and another admin must be demoted before they can be
-- suspended or deleted.
-- =============================================================================

-- Dropped first: create or replace can't change a function's result columns
-- (invited_at, venue_count and is_editor were added after the first version).
drop function if exists public.admin_list_users(text, text, int, int);
create function public.admin_list_users(
  p_search text default null,
  p_filter text default 'all',      -- all | admins | editors | managers | suspended | unconfirmed | invited
  p_limit  int  default 50,
  p_offset int  default 0
)
returns table (
  id uuid, email text, display_name text, created_at timestamptz,
  last_sign_in_at timestamptz, email_confirmed_at timestamptz, banned_until timestamptz,
  invited_at timestamptz, is_admin boolean, is_editor boolean, venue_count int, review_count int, hidden_review_count int, submission_count int,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  q text := nullif(trim(p_search), '');
begin
  if not public.is_admin() then
    raise exception 'Only admins can list members' using errcode = '42501';
  end if;
  return query
  select u.id,
         u.email::text,
         coalesce(p.display_name, 'Member'),
         u.created_at,
         u.last_sign_in_at,
         u.email_confirmed_at,
         case when u.banned_until > now() then u.banned_until end,
         u.invited_at,
         a.user_id is not null,
         exists (select 1 from public.editors ed where ed.user_id = u.id),
         (select count(*)::int from public.venue_managers vm where vm.user_id = u.id),
         (select count(*)::int from public.reviews r where r.user_id = u.id),
         (select count(*)::int from public.reviews r where r.user_id = u.id and r.is_hidden),
         (select count(*)::int from public.submissions s where s.user_id = u.id),
         count(*) over ()
  from auth.users u
  left join public.profiles p on p.id = u.id
  left join public.admins a on a.user_id = u.id
  where (q is null
         or u.email ilike '%' || q || '%'
         or p.display_name ilike '%' || q || '%'
         or u.id::text = q)
    and case coalesce(p_filter, 'all')
          when 'admins' then a.user_id is not null
          when 'managers' then exists (select 1 from public.venue_managers vm where vm.user_id = u.id)
          when 'editors' then exists (select 1 from public.editors ed where ed.user_id = u.id)
          when 'invited' then u.invited_at is not null and u.email_confirmed_at is null
          when 'suspended' then coalesce(u.banned_until > now(), false)
          when 'unconfirmed' then u.email_confirmed_at is null
          else true
        end
  order by u.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create or replace function public.admin_set_admin(p_user uuid, p_admin boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can change admin access' using errcode = '42501';
  end if;
  if p_admin then
    if not exists (select 1 from auth.users where id = p_user) then
      raise exception 'That account no longer exists';
    end if;
    if exists (select 1 from auth.users where id = p_user and banned_until > now()) then
      raise exception 'Lift the suspension before making them an admin';
    end if;
    insert into public.admins (user_id) values (p_user) on conflict do nothing;
  else
    if p_user = auth.uid() then
      raise exception 'You can''t remove your own admin access';
    end if;
    delete from public.admins where user_id = p_user;
  end if;
end;
$$;

-- p_until null lifts a suspension. Suspending also ends their sessions, so
-- they're signed out everywhere once their current access token expires.
create or replace function public.admin_suspend_user(p_user uuid, p_until timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can suspend members' using errcode = '42501';
  end if;
  if p_until is not null then
    if p_user = auth.uid() then
      raise exception 'You can''t suspend yourself';
    end if;
    if exists (select 1 from public.admins where user_id = p_user) then
      raise exception 'Remove their admin access first';
    end if;
    -- Never 'infinity': Supabase Auth can't parse it. 100 years is "for good".
    p_until := least(p_until, now() + interval '100 years');
  end if;

  update auth.users set banned_until = p_until where id = p_user;
  if not found then
    raise exception 'That account no longer exists';
  end if;

  if p_until is not null and p_until > now() and to_regclass('auth.sessions') is not null then
    execute 'delete from auth.sessions where user_id = $1' using p_user;
  end if;
end;
$$;

-- For when confirmation emails stall (built-in mailer limits) and a member asks.
create or replace function public.admin_confirm_user(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can confirm members' using errcode = '42501';
  end if;
  update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where id = p_user;
  if not found then
    raise exception 'That account no longer exists';
  end if;
end;
$$;

-- Deletes the account. Their profile and reviews go with it (cascade); their
-- suggestions stay in the inbox, unlinked. Supabase Auth won't delete a user
-- who owns Storage objects (their suggestion photos), so ownership is cleared
-- first and the photos stay with the suggestions.
create or replace function public.admin_delete_user(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can delete members' using errcode = '42501';
  end if;
  if p_user = auth.uid() then
    raise exception 'You can''t delete your own account here';
  end if;
  if exists (select 1 from public.admins where user_id = p_user) then
    raise exception 'Remove their admin access first';
  end if;

  if to_regclass('storage.objects') is not null then
    if exists (select 1 from information_schema.columns
               where table_schema = 'storage' and table_name = 'objects' and column_name = 'owner') then
      execute 'update storage.objects set owner = null where owner = $1' using p_user;
    end if;
    if exists (select 1 from information_schema.columns
               where table_schema = 'storage' and table_name = 'objects' and column_name = 'owner_id') then
      execute 'update storage.objects set owner_id = null where owner_id = $1' using p_user::text;
    end if;
  end if;

  delete from auth.users where id = p_user;
  if not found then
    raise exception 'That account no longer exists';
  end if;
end;
$$;

revoke execute on function public.admin_list_users(text, text, int, int) from public, anon;
revoke execute on function public.admin_set_admin(uuid, boolean) from public, anon;
revoke execute on function public.admin_suspend_user(uuid, timestamptz) from public, anon;
revoke execute on function public.admin_confirm_user(uuid) from public, anon;
revoke execute on function public.admin_delete_user(uuid) from public, anon;
grant execute on function public.admin_list_users(text, text, int, int) to authenticated;
grant execute on function public.admin_set_admin(uuid, boolean) to authenticated;
grant execute on function public.admin_suspend_user(uuid, timestamptz) to authenticated;
grant execute on function public.admin_confirm_user(uuid) to authenticated;
grant execute on function public.admin_delete_user(uuid) to authenticated;

-- =============================================================================
-- Venue managers (/manage)
--
-- An admin assigns members to venues (a member can manage several, a venue
-- can have several managers). A manager can edit their venues' listing,
-- photos, drinks/food menus and events, but not: publishing, featuring, the
-- URL slug, the activity radius, deleting the venue, reviews or likes.
--
-- Write access is extra policies OR-ed with the admin ones; the admin-only
-- columns are held in place by guard triggers (so a hand-crafted request
-- can't change them either). The guards only act on API callers
-- (anon/authenticated): security-definer functions, the service role and the
-- SQL editor pass through.
-- =============================================================================

create table if not exists public.venue_managers (
  venue_id   uuid not null references public.venues (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (venue_id, user_id)
);

create index if not exists venue_managers_user_idx on public.venue_managers (user_id);

alter table public.venue_managers enable row level security;

drop policy if exists "Managers see their own assignments" on public.venue_managers;
create policy "Managers see their own assignments" on public.venue_managers
  for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists "Admins assign managers" on public.venue_managers;
create policy "Admins assign managers" on public.venue_managers
  for all using (public.is_admin()) with check (public.is_admin());

-- A suspended member loses manager rights along with everything else.
create or replace function public.is_venue_manager(p_venue uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and p_venue is not null
     and exists (select 1 from public.venue_managers m where m.venue_id = p_venue and m.user_id = auth.uid())
     and not public.is_suspended();
$$;

-- True for a request from the app (not a security-definer function, the
-- service role or the SQL editor) by someone who isn't an admin.
create or replace function public.is_restricted_writer()
returns boolean
language sql
stable
as $$
  select current_user in ('anon', 'authenticated') and not public.is_admin();
$$;

-- Venues ----------------------------------------------------------------------
drop policy if exists "Managers see their venues" on public.venues;
create policy "Managers see their venues" on public.venues
  for select using (public.is_venue_manager(id));

drop policy if exists "Managers edit their venues" on public.venues;
create policy "Managers edit their venues" on public.venues
  for update using (public.is_venue_manager(id)) with check (public.is_venue_manager(id));

-- Also guards editors (see "Editors" below): they may publish and change the
-- slug and activity radius, but featured placement stays with admins. Only
-- editors can insert as a non-admin (managers have no insert policy).
create or replace function public.venues_manager_guard()
returns trigger
language plpgsql
as $$
begin
  if public.is_restricted_writer() then
    if tg_op = 'INSERT' then
      new.is_featured     := false;
      new.featured_until  := null;
      new.google_place_id := null;
      return new;
    end if;
    new.is_featured     := old.is_featured;
    new.featured_until  := old.featured_until;
    new.google_place_id := old.google_place_id;
    if not public.is_editor() then
      new.is_published := old.is_published;
      new.slug         := old.slug;
      new.radius_m     := old.radius_m;
    end if;
  end if;
  return new;
end;
$$;

-- Named to sort before venues_slug, so the slug is restored before that runs.
drop trigger if exists venues_manager_guard on public.venues;
create trigger venues_manager_guard
  before insert or update on public.venues
  for each row execute function public.venues_manager_guard();

-- Photos and menus ---------------------------------------------------------------
drop policy if exists "Managers see their venue photos" on public.venue_photos;
create policy "Managers see their venue photos" on public.venue_photos
  for select using (public.is_venue_manager(venue_id));

drop policy if exists "Managers manage their venue photos" on public.venue_photos;
create policy "Managers manage their venue photos" on public.venue_photos
  for all using (public.is_venue_manager(venue_id)) with check (public.is_venue_manager(venue_id));

drop policy if exists "Managers see their menu items" on public.menu_items;
create policy "Managers see their menu items" on public.menu_items
  for select using (public.is_venue_manager(venue_id));

drop policy if exists "Managers manage their menu items" on public.menu_items;
create policy "Managers manage their menu items" on public.menu_items
  for all using (public.is_venue_manager(venue_id)) with check (public.is_venue_manager(venue_id));

-- Likes are the members': nobody edits like_count through the API (the likes
-- trigger is security definer, so it passes).
create or replace function public.menu_items_like_guard()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.like_count := 0;
    else
      new.like_count := old.like_count;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists menu_items_like_guard on public.menu_items;
create trigger menu_items_like_guard
  before insert or update on public.menu_items
  for each row execute function public.menu_items_like_guard();

-- Events at their venues ---------------------------------------------------------
drop policy if exists "Managers see their venue events" on public.events;
create policy "Managers see their venue events" on public.events
  for select using (public.is_venue_manager(venue_id));

drop policy if exists "Managers add events at their venues" on public.events;
create policy "Managers add events at their venues" on public.events
  for insert with check (public.is_venue_manager(venue_id));

drop policy if exists "Managers edit events at their venues" on public.events;
create policy "Managers edit events at their venues" on public.events
  for update using (public.is_venue_manager(venue_id)) with check (public.is_venue_manager(venue_id));

drop policy if exists "Managers delete events at their venues" on public.events;
create policy "Managers delete events at their venues" on public.events
  for delete using (public.is_venue_manager(venue_id));

create or replace function public.events_manager_guard()
returns trigger
language plpgsql
as $$
begin
  if public.is_restricted_writer() then
    new.is_featured := case when tg_op = 'INSERT' then false else old.is_featured end;
  end if;
  return new;
end;
$$;

drop trigger if exists events_manager_guard on public.events;
create trigger events_manager_guard
  before insert or update on public.events
  for each row execute function public.events_manager_guard();

-- Storage: <venue_id>/… for their venues, events/<event_id>/… for their events.
create or replace function public.can_manage_media(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when (storage.foldername(p_name))[1] = 'events' then exists (
      select 1 from public.events e
      where e.id::text = (storage.foldername(p_name))[2] and public.is_venue_manager(e.venue_id))
    else exists (
      select 1 from public.venues v
      where v.id::text = (storage.foldername(p_name))[1] and public.is_venue_manager(v.id))
  end;
$$;

drop policy if exists "Managers upload venue media" on storage.objects;
create policy "Managers upload venue media" on storage.objects
  for insert with check (bucket_id = 'venue-media' and public.can_manage_media(name));

drop policy if exists "Managers update venue media" on storage.objects;
create policy "Managers update venue media" on storage.objects
  for update using (bucket_id = 'venue-media' and public.can_manage_media(name));

drop policy if exists "Managers delete venue media" on storage.objects;
create policy "Managers delete venue media" on storage.objects
  for delete using (bucket_id = 'venue-media' and public.can_manage_media(name));

-- Admin: who manages a venue, with emails (auth.users isn't readable via the API).
-- Its result columns gained "role" (staff, below), so drop it before recreating it.
-- plpgsql only resolves m.role when called, so this works before the column exists.
drop function if exists public.admin_venue_managers(uuid);
create function public.admin_venue_managers(p_venue uuid)
returns table (user_id uuid, email text, display_name text, role text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'Only admins can list managers' using errcode = '42501';
  end if;
  return query
  select m.user_id, u.email::text, coalesce(p.display_name, 'Member'), m.role, m.created_at
  from public.venue_managers m
  join auth.users u on u.id = m.user_id
  left join public.profiles p on p.id = m.user_id
  where m.venue_id = p_venue
  order by m.role, m.created_at;
end;
$$;

revoke execute on function public.admin_venue_managers(uuid) from public, anon;
grant execute on function public.admin_venue_managers(uuid) to authenticated;

-- =============================================================================
-- Short videos and several flyers per event.
--
-- Videos (≤ 30 s) are re-encoded in the admin's browser with ffmpeg.wasm to a
-- small H.264 MP4 plus a JPEG poster frame, then uploaded to venue-media like
-- photos. Pages show the poster and only load the video when it's played.
--
--   * venue_photos.media_type 'video' (gallery only), with poster_* and
--     duration_s. The cover stays an image: "use as cover" takes the poster.
--   * event_media: an event's flyers and videos, in order. events.image_url /
--     image_path are kept equal to the first flyer (else the first video's
--     poster) by a trigger, so cards, the map drawer and the hero banner keep
--     reading one image.
-- =============================================================================
alter table public.venue_photos add column if not exists media_type text not null default 'image';
alter table public.venue_photos add column if not exists poster_url  text;
alter table public.venue_photos add column if not exists poster_path text;
alter table public.venue_photos add column if not exists duration_s  numeric(5, 1);

alter table public.venue_photos drop constraint if exists venue_photos_media_type_check;
alter table public.venue_photos add constraint venue_photos_media_type_check
  check (media_type in ('image', 'video') and (media_type = 'image' or kind = 'gallery'));

create table if not exists public.event_media (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events (id) on delete cascade,
  media_type   text not null default 'image' check (media_type in ('image', 'video')),
  url          text not null,
  storage_path text,                 -- path inside the venue-media bucket (for deletes)
  poster_url   text,                 -- videos: a still frame shown before playing
  poster_path  text,
  duration_s   numeric(5, 1),
  caption      text check (char_length(caption) <= 200),
  sort         int not null default 0,
  created_at   timestamptz not null default now()
);

create index if not exists event_media_event_idx on public.event_media (event_id, sort);

alter table public.event_media enable row level security;

drop policy if exists "Media of visible events is public" on public.event_media;
create policy "Media of visible events is public" on public.event_media
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.events e
      where e.id = event_id and (e.is_published or public.is_venue_manager(e.venue_id))
    )
  );

drop policy if exists "Admins manage event media" on public.event_media;
create policy "Admins manage event media" on public.event_media
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Managers manage their event media" on public.event_media;
create policy "Managers manage their event media" on public.event_media
  for all
  using (exists (select 1 from public.events e where e.id = event_id and public.is_venue_manager(e.venue_id)))
  with check (exists (select 1 from public.events e where e.id = event_id and public.is_venue_manager(e.venue_id)));

-- Keep events.image_url / image_path on the first flyer. Security definer, so
-- it works the same whether an admin or a venue manager changed the media.
create or replace function public.event_media_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ev uuid := coalesce(new.event_id, old.event_id);
  first_url text;
  first_path text;
begin
  select case when m.media_type = 'image' then m.url else m.poster_url end,
         case when m.media_type = 'image' then m.storage_path else m.poster_path end
    into first_url, first_path
  from public.event_media m
  where m.event_id = ev and (m.media_type = 'image' or m.poster_url is not null)
  order by (m.media_type = 'image') desc, m.sort, m.created_at
  limit 1;

  update public.events
     set image_url = first_url, image_path = first_path
   where id = ev and (image_url is distinct from first_url or image_path is distinct from first_path);

  -- A row moved to another event (not done by the app, but keep both right).
  if tg_op = 'UPDATE' and old.event_id <> new.event_id then
    update public.events e
       set image_url = null, image_path = null
     where e.id = old.event_id
       and not exists (select 1 from public.event_media m where m.event_id = old.event_id);
  end if;
  return null;
end;
$$;

drop trigger if exists event_media_sync on public.event_media;
create trigger event_media_sync
  after insert or update or delete on public.event_media
  for each row execute function public.event_media_sync();

-- One-time move of the single flyer events had before into event_media. Re-runs
-- skip events that already have media (or whose last flyer was deleted, since
-- the trigger then cleared image_url).
insert into public.event_media (event_id, media_type, url, storage_path, sort)
select e.id, 'image', e.image_url, e.image_path, 1
from public.events e
where e.image_url is not null
  and not exists (select 1 from public.event_media m where m.event_id = e.id);

-- =============================================================================
-- Favourites: members save spots to a list on their Account page.
--
-- Each member sees only their own rows. Nobody else can tell who favourited
-- what: admins (all spots) and venue managers (their own spots) get totals
-- only, from venue_favorite_counts().
-- =============================================================================
create table if not exists public.venue_favorites (
  venue_id   uuid not null references public.venues (id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (venue_id, user_id)
);

create index if not exists venue_favorites_user_idx on public.venue_favorites (user_id, created_at desc);

alter table public.venue_favorites enable row level security;

drop policy if exists "Members see their own favourites" on public.venue_favorites;
create policy "Members see their own favourites" on public.venue_favorites
  for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists "Members favourite published spots" on public.venue_favorites;
create policy "Members favourite published spots" on public.venue_favorites
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and not public.is_suspended()
    and exists (select 1 from public.venues v where v.id = venue_id and v.is_published)
  );

drop policy if exists "Members remove their own favourites" on public.venue_favorites;
create policy "Members remove their own favourites" on public.venue_favorites
  for delete using (user_id = auth.uid() or public.is_admin());

-- How many members have favourited each spot: every spot for admins, a
-- manager's own spots for managers, nothing for anyone else.
create or replace function public.venue_favorite_counts()
returns table (venue_id uuid, favorites bigint)
language sql
stable
security definer
set search_path = public
as $$
  select f.venue_id, count(*)
  from public.venue_favorites f
  where public.is_admin() or public.is_venue_manager(f.venue_id)
  group by f.venue_id;
$$;

revoke execute on function public.venue_favorite_counts() from public, anon;
grant execute on function public.venue_favorite_counts() to authenticated;

-- =============================================================================
-- Editors: members who help keep the listings up to date. In the admin console
-- they get Spots and Quick add only: they can see every spot (drafts too), add
-- spots, and edit details, photos, menus, hours, location, tags (existing
-- ones) and whether a spot is published. They can't delete spots, set
-- featured placement, assign managers, or use any other admin function
-- (events, inbox, reviews, members, tags, theme, activity).
--
-- Like managers, this is extra policies OR-ed with the admin ones, plus the
-- venues guard trigger above for featured. Suspended members lose it.
-- =============================================================================
create table if not exists public.editors (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.editors enable row level security;

drop policy if exists "Editors see their own role" on public.editors;
create policy "Editors see their own role" on public.editors
  for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists "Admins appoint editors" on public.editors;
create policy "Admins appoint editors" on public.editors
  for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.is_editor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and exists (select 1 from public.editors e where e.user_id = auth.uid())
     and not public.is_suspended();
$$;

grant execute on function public.is_editor() to anon, authenticated;

-- Venues: see all, add, edit (no delete policy, so they can't remove one).
drop policy if exists "Editors see all venues" on public.venues;
create policy "Editors see all venues" on public.venues
  for select using (public.is_editor());

drop policy if exists "Editors add venues" on public.venues;
create policy "Editors add venues" on public.venues
  for insert with check (public.is_editor());

drop policy if exists "Editors edit venues" on public.venues;
create policy "Editors edit venues" on public.venues
  for update using (public.is_editor()) with check (public.is_editor());

-- Photos, videos and menus of any spot.
drop policy if exists "Editors manage photos" on public.venue_photos;
create policy "Editors manage photos" on public.venue_photos
  for all using (public.is_editor()) with check (public.is_editor());

drop policy if exists "Editors manage menu items" on public.menu_items;
create policy "Editors manage menu items" on public.menu_items
  for all using (public.is_editor()) with check (public.is_editor());

-- Spot media in storage (<venue_id>/…), not event flyers (events/…) or
-- radio station logos (radio/…).
drop policy if exists "Editors upload venue media" on storage.objects;
create policy "Editors upload venue media" on storage.objects
  for insert with check (bucket_id = 'venue-media' and (storage.foldername(name))[1] not in ('events', 'radio') and public.is_editor());

drop policy if exists "Editors update venue media" on storage.objects;
create policy "Editors update venue media" on storage.objects
  for update using (bucket_id = 'venue-media' and (storage.foldername(name))[1] not in ('events', 'radio') and public.is_editor());

drop policy if exists "Editors delete venue media" on storage.objects;
create policy "Editors delete venue media" on storage.objects
  for delete using (bucket_id = 'venue-media' and (storage.foldername(name))[1] not in ('events', 'radio') and public.is_editor());

create or replace function public.admin_set_editor(p_user uuid, p_editor boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can change editor access' using errcode = '42501';
  end if;
  if p_editor then
    if not exists (select 1 from auth.users where id = p_user) then
      raise exception 'That account no longer exists';
    end if;
    if exists (select 1 from auth.users where id = p_user and banned_until > now()) then
      raise exception 'Lift the suspension before making them an editor';
    end if;
    insert into public.editors (user_id) values (p_user) on conflict do nothing;
  else
    delete from public.editors where user_id = p_user;
  end if;
end;
$$;

revoke execute on function public.admin_set_editor(uuid, boolean) from public, anon;
grant execute on function public.admin_set_editor(uuid, boolean) to authenticated;

-- =============================================================================
-- Live radio: a partner broadcaster's stations, played by an opt-in mini-player
-- on the public site (nothing plays or downloads until a visitor taps a
-- station). The admin switches the player on in /admin/radio, names the
-- partner ("Presented by …") and manages the stations.
--
-- Streams must be HTTPS (an http:// stream won't play on an https page). The
-- public only sees enabled stations that have a stream URL, so the seeded
-- stations stay hidden until the broadcaster's URLs are filled in.
-- =============================================================================
alter table public.site_settings add column if not exists radio_enabled boolean not null default false;
alter table public.site_settings add column if not exists radio_partner text check (radio_partner is null or char_length(radio_partner) <= 80);
alter table public.site_settings add column if not exists radio_partner_url text check (radio_partner_url is null or radio_partner_url ~ '^https?://');

create table if not exists public.radio_stations (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9-]{1,40}$'),  -- stable id for analytics + "last station"
  name        text not null check (char_length(name) between 1 and 40),
  frequency   text check (frequency is null or char_length(frequency) <= 20),   -- "100.3 FM"
  tagline     text check (tagline is null or char_length(tagline) <= 80),       -- genre line
  stream_url  text check (stream_url is null or stream_url ~ '^https://'),
  backup_url  text check (backup_url is null or backup_url ~ '^https://'),      -- tried once if the main stream fails
  meta_url    text check (meta_url is null or meta_url ~ '^https://'),          -- now-playing (Icecast/Shoutcast JSON, XML, text)
  website     text check (website is null or website ~ '^https?://'),
  logo_url    text,
  logo_path   text,                                                            -- venue-media radio/… (for deletes)
  color       text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),     -- the station's brand colour, used sparingly
  sort        int  not null default 0,
  is_enabled  boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists radio_stations_touch on public.radio_stations;
create trigger radio_stations_touch
  before update on public.radio_stations
  for each row execute function public.touch_updated_at();

alter table public.radio_stations enable row level security;

drop policy if exists "Live radio stations are public" on public.radio_stations;
create policy "Live radio stations are public" on public.radio_stations
  for select using ((is_enabled and stream_url is not null) or public.is_admin());

drop policy if exists "Admins manage radio stations" on public.radio_stations;
create policy "Admins manage radio stations" on public.radio_stations
  for all using (public.is_admin()) with check (public.is_admin());

-- The partner's four stations. Frequencies and genre lines come from public
-- listings; confirm them (and add stream URLs, logos) in /admin/radio.
insert into public.radio_stations (slug, name, frequency, tagline, color, website, sort) values
  ('100-jamz', '100 Jamz', '100.3 FM', 'R&B, hip-hop, reggae, soca & Junkanoo', '#f59e0b', 'https://www.100jamz.com', 1),
  ('joy-fm',   'Joy FM',   '101.9 FM', 'Gospel & inspiration',                  '#22c55e', null, 2),
  ('kiss-fm',  'Kiss FM',  '96.1 FM',  'Adult contemporary hits',               '#ef4444', null, 3),
  ('y98-fm',   'Y98 FM',   '98.7 FM',  'Hot adult contemporary',                '#3b82f6', null, 4)
on conflict (slug) do nothing;

-- =============================================================================
-- Points. Members earn points for checking in at a spot (once per spot per
-- night, after staying a few minutes) and for suggestions an admin applies.
-- Every change is a row in points_ledger, so a balance is a sum and future
-- reward redemptions at opted-in bars are negative rows (see docs/rewards.md).
--
-- Check-ins are separate from the anonymous live activity: a member taps
-- "Check in", the browser sends one GPS fix, and check_in() compares it with
-- the venue's geofence. Coordinates are never stored. Check-ins are linked to
-- the account (that's the point of them), and only the member and admins can
-- read them; presence and its device ids stay untouched and anonymous.
-- =============================================================================
alter table public.site_settings add column if not exists points_enabled boolean not null default true;
alter table public.site_settings add column if not exists points_check_in int not null default 1 check (points_check_in between 0 and 20);
alter table public.site_settings add column if not exists points_check_in_max int not null default 5 check (points_check_in_max between 1 and 20);  -- spots per night
alter table public.site_settings add column if not exists points_update int not null default 5 check (points_update between 0 and 50);
alter table public.site_settings add column if not exists points_new_spot int not null default 10 check (points_new_spot between 0 and 50);

-- Points the admin chose when applying a suggestion; null = the default for its kind.
alter table public.submissions add column if not exists points int check (points is null or points between 0 and 50);

-- Replaces the policy above now that points exists: members can't award themselves.
drop policy if exists "Anyone can submit suggestions" on public.submissions;
create policy "Anyone can submit suggestions" on public.submissions
  for insert to anon, authenticated
  with check (
    status = 'new' and admin_note is null and resolved_at is null and points is null
    and (user_id is null or user_id = auth.uid())
  );

-- The Nassau "night" a moment belongs to: 6 AM to 6 AM, like the activity device id.
create or replace function public.points_night(p_at timestamptz default now())
returns date
language sql
stable
as $$
  select ((p_at at time zone 'America/Nassau') - interval '6 hours')::date;
$$;

create table if not exists public.check_ins (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  venue_id     uuid not null references public.venues (id) on delete cascade,
  night        date not null,
  started_at   timestamptz not null default now(),
  confirmed_at timestamptz,             -- set once they've stayed DWELL (4 min)
  points       int not null default 0,
  unique (user_id, venue_id, night)
);

create index if not exists check_ins_user_night_idx on public.check_ins (user_id, night);

alter table public.check_ins enable row level security;

drop policy if exists "Members read their check-ins" on public.check_ins;
create policy "Members read their check-ins" on public.check_ins
  for select using (user_id = auth.uid() or public.is_admin());
-- No write policies: only check_in() (security definer) writes.

create table if not exists public.points_ledger (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  points        int not null check (points <> 0 and points between -100000 and 1000),
  reason        text not null check (reason in ('check_in', 'update', 'adjust', 'redeem')),
  venue_id      uuid references public.venues (id) on delete set null,
  -- Earned points outlive a deleted spot or suggestion, hence "set null".
  check_in_id   uuid unique references public.check_ins (id) on delete set null,
  submission_id uuid unique references public.submissions (id) on delete set null,
  note          text check (note is null or char_length(note) <= 200),
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists points_ledger_user_idx on public.points_ledger (user_id, created_at desc);

alter table public.points_ledger enable row level security;

drop policy if exists "Members read their points" on public.points_ledger;
create policy "Members read their points" on public.points_ledger
  for select using (user_id = auth.uid() or public.is_admin());
-- No write policies: rows come from check_in(), the submissions trigger and admin_adjust_points().

-- One call per tap. The first call at a spot tonight starts the check-in; a
-- call DWELL (4 min) or more later, still inside the geofence, confirms it and
-- awards the points. So a drive-by, or one spoofed fix, earns nothing.
create or replace function public.check_in(p_venue uuid, p_lat float8, p_lng float8, p_accuracy float8)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_night   date := public.points_night();
  v_set     record;
  v_venue   record;
  v_dist    float8;
  v_ci      public.check_ins%rowtype;
  v_count   int;
  v_wait    int;
  v_balance int;
begin
  if v_uid is null then
    return jsonb_build_object('status', 'signed_out');
  end if;
  if public.is_suspended() then
    return jsonb_build_object('status', 'suspended');
  end if;
  select points_enabled, points_check_in, points_check_in_max into v_set from public.site_settings where id;
  if not coalesce(v_set.points_enabled, false) then
    return jsonb_build_object('status', 'disabled');
  end if;
  select id, lat, lng, radius_m into v_venue
  from public.venues
  where id = p_venue and is_published and lat is not null and lng is not null;
  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;
  if p_lat is null or p_lng is null or p_accuracy is null or p_accuracy > 100 then
    return jsonb_build_object('status', 'inaccurate', 'accuracy_m', round(p_accuracy));
  end if;
  -- Same geofence as report_presence(): the spot's radius plus up to 30 m of GPS slack.
  v_dist := public.haversine_m(p_lat, p_lng, v_venue.lat, v_venue.lng);
  if v_dist > v_venue.radius_m + least(p_accuracy, 30) then
    return jsonb_build_object('status', 'too_far', 'distance_m', round(v_dist));
  end if;

  select * into v_ci from public.check_ins
  where user_id = v_uid and venue_id = p_venue and night = v_night
  for update;

  if not found then
    select count(*) into v_count from public.check_ins where user_id = v_uid and night = v_night;
    if v_count >= v_set.points_check_in_max then
      return jsonb_build_object('status', 'nightly_limit', 'max', v_set.points_check_in_max);
    end if;
    insert into public.check_ins (user_id, venue_id, night)
    values (v_uid, p_venue, v_night)
    on conflict (user_id, venue_id, night) do nothing;
    return jsonb_build_object('status', 'started', 'wait_s', 240, 'points', v_set.points_check_in);
  end if;

  if v_ci.confirmed_at is not null then
    return jsonb_build_object('status', 'already', 'points', v_ci.points);
  end if;
  -- Started hours ago and never finished: start the clock again.
  if v_ci.started_at < now() - interval '4 hours' then
    update public.check_ins set started_at = now() where id = v_ci.id;
    return jsonb_build_object('status', 'started', 'wait_s', 240, 'points', v_set.points_check_in);
  end if;
  v_wait := ceil(extract(epoch from (v_ci.started_at + interval '4 minutes' - now())));
  if v_wait > 0 then
    return jsonb_build_object('status', 'wait', 'wait_s', v_wait, 'points', v_set.points_check_in);
  end if;

  update public.check_ins set confirmed_at = now(), points = v_set.points_check_in where id = v_ci.id;
  if v_set.points_check_in > 0 then
    insert into public.points_ledger (user_id, points, reason, venue_id, check_in_id)
    values (v_uid, v_set.points_check_in, 'check_in', p_venue, v_ci.id)
    on conflict (check_in_id) do nothing;
  end if;
  select coalesce(sum(points), 0)::int into v_balance from public.points_ledger where user_id = v_uid;
  return jsonb_build_object('status', 'confirmed', 'points', v_set.points_check_in, 'balance', v_balance);
end;
$$;

revoke execute on function public.check_in(uuid, float8, float8, float8) from public, anon;
grant execute on function public.check_in(uuid, float8, float8, float8) to authenticated;

-- The signed-in member's totals.
create or replace function public.my_points()
returns table (balance int, earned int, check_ins int, updates int)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(sum(points), 0)::int,
    coalesce(sum(points) filter (where points > 0), 0)::int,
    count(*) filter (where reason = 'check_in')::int,
    count(*) filter (where reason = 'update')::int
  from public.points_ledger
  where user_id = auth.uid();
$$;

revoke execute on function public.my_points() from public, anon;
grant execute on function public.my_points() to authenticated;

-- Applying a member's suggestion awards points; un-applying takes them back.
-- Runs only when the status, points or member change, so editing a note never
-- re-prices an old award.
create or replace function public.submissions_points()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_set record;
  v_pts int;
begin
  if tg_op = 'UPDATE'
     and new.status is not distinct from old.status
     and new.points is not distinct from old.points
     and new.user_id is not distinct from old.user_id then
    return new;
  end if;
  if new.status <> 'done' or new.user_id is null then
    delete from public.points_ledger where submission_id = new.id;
    return new;
  end if;
  select points_enabled, points_update, points_new_spot into v_set from public.site_settings where id;
  if not coalesce(v_set.points_enabled, false) then
    return new;
  end if;
  v_pts := coalesce(new.points, case when new.kind = 'new_spot' then v_set.points_new_spot else v_set.points_update end);
  if v_pts > 0 then
    insert into public.points_ledger (user_id, points, reason, venue_id, submission_id, created_by)
    values (new.user_id, v_pts, 'update', new.venue_id, new.id, auth.uid())
    on conflict (submission_id) do update set points = excluded.points, user_id = excluded.user_id;
  else
    delete from public.points_ledger where submission_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists submissions_points on public.submissions;
create trigger submissions_points
  after insert or update on public.submissions
  for each row execute function public.submissions_points();

-- Admin corrections (positive or negative), with a note the member sees.
create or replace function public.admin_adjust_points(p_user uuid, p_points int, p_note text default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance int;
begin
  if not public.is_admin() then
    raise exception 'Only admins can adjust points' using errcode = '42501';
  end if;
  if p_points is null or p_points = 0 or abs(p_points) > 1000 then
    raise exception 'Adjust by 1 to 1000 points';
  end if;
  insert into public.points_ledger (user_id, points, reason, note, created_by)
  values (p_user, p_points, 'adjust', nullif(left(trim(coalesce(p_note, '')), 200), ''), auth.uid());
  select coalesce(sum(points), 0)::int into v_balance from public.points_ledger where user_id = p_user;
  return v_balance;
end;
$$;

revoke execute on function public.admin_adjust_points(uuid, int, text) from public, anon;
grant execute on function public.admin_adjust_points(uuid, int, text) to authenticated;

-- Admin overview: members by balance.
create or replace function public.admin_points_leaders(p_limit int default 50)
returns table (user_id uuid, display_name text, balance int, check_ins int, updates int, last_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can see points' using errcode = '42501';
  end if;
  return query
  select l.user_id, p.display_name,
         sum(l.points)::int,
         (count(*) filter (where l.reason = 'check_in'))::int,
         (count(*) filter (where l.reason = 'update'))::int,
         max(l.created_at)
  from public.points_ledger l
  join public.profiles p on p.id = l.user_id
  group by l.user_id, p.display_name
  order by sum(l.points) desc, max(l.created_at) desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

revoke execute on function public.admin_points_leaders(int) from public, anon;
grant execute on function public.admin_points_leaders(int) to authenticated;

-- =============================================================================
-- Rewards: members spend points at bars with a sponsorship deal ("reward
-- partners"). An admin makes a venue a partner; its managers set the rewards
-- and their point costs. The member shows a QR code from their account (a
-- short-lived, single-use code) and venue staff scan it in /manage → Redeem.
-- Every redemption is a negative points_ledger row, so voiding one is a refund.
-- See docs/rewards.md.
-- =============================================================================

-- Venue staff: assigned like managers but only redeem points (bartenders don't
-- get to edit the listing). Existing rows stay managers.
alter table public.venue_managers add column if not exists role text not null default 'manager';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'venue_managers_role_check') then
    alter table public.venue_managers add constraint venue_managers_role_check check (role in ('manager', 'staff'));
  end if;
end $$;

-- Managers edit; staff don't. (Replaces the definition above.)
create or replace function public.is_venue_manager(p_venue uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and p_venue is not null
     and exists (select 1 from public.venue_managers m where m.venue_id = p_venue and m.user_id = auth.uid() and m.role = 'manager')
     and not public.is_suspended();
$$;

-- Managers and staff may redeem at the venue.
create or replace function public.is_venue_staff(p_venue uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and p_venue is not null
     and exists (select 1 from public.venue_managers m where m.venue_id = p_venue and m.user_id = auth.uid())
     and not public.is_suspended();
$$;

grant execute on function public.is_venue_staff(uuid) to anon, authenticated;

-- admin_venue_managers() returns the role too (defined with the venue managers above).


-- The sponsorship: which venues take points, and for how long. Admin-only
-- (the note holds the deal); everyone else asks is_reward_partner().
create table if not exists public.reward_partners (
  venue_id   uuid primary key references public.venues (id) on delete cascade,
  is_active  boolean not null default true,
  starts_on  date,
  ends_on    date,
  note       text check (note is null or char_length(note) <= 500),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint reward_partners_dates check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

alter table public.reward_partners enable row level security;

drop policy if exists "Admins manage reward partners" on public.reward_partners;
create policy "Admins manage reward partners" on public.reward_partners
  for all using (public.is_admin()) with check (public.is_admin());

-- A published venue with an active deal covering today (Nassau date).
create or replace function public.is_reward_partner(p_venue uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.reward_partners rp
    join public.venues v on v.id = rp.venue_id
    where rp.venue_id = p_venue
      and rp.is_active
      and v.is_published
      and (rp.starts_on is null or rp.starts_on <= (now() at time zone 'America/Nassau')::date)
      and (rp.ends_on is null or rp.ends_on >= (now() at time zone 'America/Nassau')::date)
  );
$$;

grant execute on function public.is_reward_partner(uuid) to anon, authenticated;

create table if not exists public.rewards (
  id            uuid primary key default gen_random_uuid(),
  venue_id      uuid not null references public.venues (id) on delete cascade,
  title         text not null check (char_length(title) between 1 and 60),
  description   text check (description is null or char_length(description) <= 200),
  cost          int not null check (cost between 1 and 100000),
  nightly_limit int check (nightly_limit is null or nightly_limit between 1 and 20),  -- per member per night
  is_active     boolean not null default true,
  sort          int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists rewards_venue_idx on public.rewards (venue_id, sort);

drop trigger if exists rewards_touch on public.rewards;
create trigger rewards_touch
  before update on public.rewards
  for each row execute function public.touch_updated_at();

alter table public.rewards enable row level security;

drop policy if exists "Partner rewards are public" on public.rewards;
create policy "Partner rewards are public" on public.rewards
  for select using (
    (is_active and public.is_reward_partner(venue_id))
    or public.is_admin()
    or public.is_venue_staff(venue_id)
  );

drop policy if exists "Admins manage rewards" on public.rewards;
create policy "Admins manage rewards" on public.rewards
  for all using (public.is_admin()) with check (public.is_admin());

-- Managers price their own rewards, but only while the venue is a partner.
drop policy if exists "Managers manage their rewards" on public.rewards;
create policy "Managers manage their rewards" on public.rewards
  for all using (public.is_venue_manager(venue_id) and public.is_reward_partner(venue_id))
  with check (public.is_venue_manager(venue_id) and public.is_reward_partner(venue_id));

-- The member's QR: 8 characters, valid 5 minutes, used once. No policies:
-- only the functions below read or write it.
create table if not exists public.redeem_codes (
  code       text primary key check (code ~ '^[A-Z0-9]{8}$'),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz
);

create index if not exists redeem_codes_user_idx on public.redeem_codes (user_id);

alter table public.redeem_codes enable row level security;

create table if not exists public.redemptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  venue_id   uuid references public.venues (id) on delete set null,
  reward_id  uuid references public.rewards (id) on delete set null,
  title      text not null check (char_length(title) between 1 and 60),  -- the reward as it was
  points     int not null check (points > 0),
  night      date not null,
  staff_id   uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  voided_at  timestamptz,
  voided_by  uuid references auth.users (id) on delete set null
);

create index if not exists redemptions_venue_idx on public.redemptions (venue_id, created_at desc);
create index if not exists redemptions_user_idx on public.redemptions (user_id, created_at desc);

alter table public.redemptions enable row level security;

drop policy if exists "Redemptions: member, venue staff, admins" on public.redemptions;
create policy "Redemptions: member, venue staff, admins" on public.redemptions
  for select using (user_id = auth.uid() or public.is_admin() or public.is_venue_staff(venue_id));
-- No write policies: redeem_confirm() and void_redemption() only.

alter table public.points_ledger
  add column if not exists redemption_id uuid unique references public.redemptions (id) on delete set null;

-- A fresh code for the signed-in member (any older unused one stops working).
create or replace function public.create_redeem_code()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_alpha   text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- no 0/O or 1/I
  v_bytes   bytea;
  v_code    text;
  v_expires timestamptz := now() + interval '5 minutes';
  v_balance int;
begin
  if v_uid is null then
    return jsonb_build_object('status', 'signed_out');
  end if;
  if public.is_suspended() then
    return jsonb_build_object('status', 'suspended');
  end if;
  if not coalesce((select points_enabled from public.site_settings where id), false) then
    return jsonb_build_object('status', 'disabled');
  end if;
  delete from public.redeem_codes where user_id = v_uid and used_at is null;
  delete from public.redeem_codes where created_at < now() - interval '1 day';
  for attempt in 1..5 loop
    -- 8 random bytes from a v4 uuid, each mod 32 (256 is a multiple of 32, so no bias).
    v_bytes := uuid_send(gen_random_uuid());
    v_code := '';
    for i in 0..7 loop
      v_code := v_code || substr(v_alpha, 1 + get_byte(v_bytes, i) % 32, 1);
    end loop;
    begin
      insert into public.redeem_codes (code, user_id, expires_at) values (v_code, v_uid, v_expires);
      exit;
    exception when unique_violation then
      v_code := null;
    end;
  end loop;
  if v_code is null then
    raise exception 'Could not create a code, try again';
  end if;
  select coalesce(sum(points), 0)::int into v_balance from public.points_ledger where user_id = v_uid;
  return jsonb_build_object('status', 'ok', 'code', v_code, 'expires_at', v_expires, 'balance', v_balance);
end;
$$;

revoke execute on function public.create_redeem_code() from public, anon;
grant execute on function public.create_redeem_code() to authenticated;

-- The member's screen polls this to show "Redeemed!" the moment staff confirm.
create or replace function public.redeem_code_status(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row     public.redeem_codes%rowtype;
  v_red     record;
  v_balance int;
begin
  select * into v_row from public.redeem_codes where code = upper(p_code) and user_id = auth.uid();
  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;
  if v_row.used_at is not null then
    select r.title, r.points, v.name as venue into v_red
    from public.redemptions r left join public.venues v on v.id = r.venue_id
    where r.user_id = v_row.user_id and r.created_at >= v_row.used_at - interval '5 seconds'
    order by r.created_at
    limit 1;
    select coalesce(sum(points), 0)::int into v_balance from public.points_ledger where user_id = v_row.user_id;
    return jsonb_build_object('status', 'used', 'title', v_red.title, 'points', v_red.points, 'venue', v_red.venue, 'balance', v_balance);
  end if;
  if v_row.expires_at < now() then
    return jsonb_build_object('status', 'expired');
  end if;
  return jsonb_build_object('status', 'waiting', 'expires_at', v_row.expires_at);
end;
$$;

revoke execute on function public.redeem_code_status(text) from public, anon;
grant execute on function public.redeem_code_status(text) to authenticated;

-- Venues the caller can redeem at: partner venues they manage or staff (all
-- partner venues for admins).
create or replace function public.my_redeem_venues()
returns table (venue_id uuid, name text, slug text, cover_url text, role text)
language sql
stable
security definer
set search_path = public
as $$
  select v.id, v.name, v.slug, v.cover_url,
         coalesce(m.role, 'admin')
  from public.venues v
  left join public.venue_managers m on m.venue_id = v.id and m.user_id = auth.uid()
  where public.is_reward_partner(v.id)
    and not public.is_suspended()
    and (m.user_id is not null or public.is_admin())
  order by v.name;
$$;

revoke execute on function public.my_redeem_venues() from public, anon;
grant execute on function public.my_redeem_venues() to authenticated;

-- Shared checks for the staff side. Returns null when fine, else a status.
create or replace function public.redeem_guard(p_venue uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then 'signed_out'
    when not (public.is_admin() or public.is_venue_staff(p_venue)) then 'forbidden'
    when not public.is_reward_partner(p_venue) then 'not_partner'
    when not coalesce((select points_enabled from public.site_settings where id), false) then 'disabled'
  end;
$$;

revoke execute on function public.redeem_guard(uuid) from public, anon;

-- Staff scanned a code: who it is, their balance, and what they can afford here.
-- The member's id never leaves the database.
create or replace function public.redeem_lookup(p_venue uuid, p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_guard   text := public.redeem_guard(p_venue);
  v_row     public.redeem_codes%rowtype;
  v_name    text;
  v_balance int;
  v_night   date := public.points_night();
begin
  if v_guard is not null then
    return jsonb_build_object('status', v_guard);
  end if;
  select * into v_row from public.redeem_codes where code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;
  if v_row.used_at is not null then
    return jsonb_build_object('status', 'used');
  end if;
  if v_row.expires_at < now() then
    return jsonb_build_object('status', 'expired');
  end if;
  select display_name into v_name from public.profiles where id = v_row.user_id;
  select coalesce(sum(points), 0)::int into v_balance from public.points_ledger where user_id = v_row.user_id;
  return jsonb_build_object(
    'status', 'ok',
    'member', v_name,
    'balance', v_balance,
    'expires_at', v_row.expires_at,
    'rewards', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'title', r.title, 'description', r.description, 'cost', r.cost, 'nightly_limit', r.nightly_limit,
        'used_tonight', (select count(*) from public.redemptions x
                         where x.user_id = v_row.user_id and x.reward_id = r.id and x.night = v_night and x.voided_at is null)
      ) order by r.sort, r.cost)
      from public.rewards r
      where r.venue_id = p_venue and r.is_active
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.redeem_lookup(uuid, text) from public, anon;
grant execute on function public.redeem_lookup(uuid, text) to authenticated;

create or replace function public.redeem_confirm(p_venue uuid, p_code text, p_reward uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_guard   text := public.redeem_guard(p_venue);
  v_row     public.redeem_codes%rowtype;
  v_reward  public.rewards%rowtype;
  v_balance int;
  v_used    int;
  v_night   date := public.points_night();
  v_red_id  uuid;
  v_name    text;
begin
  if v_guard is not null then
    return jsonb_build_object('status', v_guard);
  end if;
  select * into v_row from public.redeem_codes
  where code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'))
  for update;
  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;
  if v_row.used_at is not null then
    return jsonb_build_object('status', 'used');
  end if;
  if v_row.expires_at < now() then
    return jsonb_build_object('status', 'expired');
  end if;
  if exists (select 1 from auth.users where id = v_row.user_id and banned_until > now()) then
    return jsonb_build_object('status', 'suspended');
  end if;
  select * into v_reward from public.rewards where id = p_reward and venue_id = p_venue and is_active;
  if not found then
    return jsonb_build_object('status', 'no_reward');
  end if;

  -- One redemption at a time per member, so two bars can't spend the same balance.
  perform pg_advisory_xact_lock(hashtext('points:' || v_row.user_id::text));
  select coalesce(sum(points), 0)::int into v_balance from public.points_ledger where user_id = v_row.user_id;
  if v_balance < v_reward.cost then
    return jsonb_build_object('status', 'insufficient', 'balance', v_balance, 'cost', v_reward.cost);
  end if;
  if v_reward.nightly_limit is not null then
    select count(*) into v_used from public.redemptions
    where user_id = v_row.user_id and reward_id = v_reward.id and night = v_night and voided_at is null;
    if v_used >= v_reward.nightly_limit then
      return jsonb_build_object('status', 'limit', 'nightly_limit', v_reward.nightly_limit);
    end if;
  end if;

  insert into public.redemptions (user_id, venue_id, reward_id, title, points, night, staff_id)
  values (v_row.user_id, p_venue, v_reward.id, v_reward.title, v_reward.cost, v_night, auth.uid())
  returning id into v_red_id;
  insert into public.points_ledger (user_id, points, reason, venue_id, redemption_id, note, created_by)
  values (v_row.user_id, -v_reward.cost, 'redeem', p_venue, v_red_id, v_reward.title, auth.uid());
  update public.redeem_codes set used_at = now() where code = v_row.code;

  select display_name into v_name from public.profiles where id = v_row.user_id;
  return jsonb_build_object(
    'status', 'redeemed', 'redemption_id', v_red_id, 'member', v_name,
    'title', v_reward.title, 'points', v_reward.cost, 'balance', v_balance - v_reward.cost
  );
end;
$$;

revoke execute on function public.redeem_confirm(uuid, text, uuid) from public, anon;
grant execute on function public.redeem_confirm(uuid, text, uuid) to authenticated;

-- Undo a redemption (refunds the points). Admins any time; the venue's staff
-- within 12 hours, for mistakes at the bar.
create or replace function public.void_redemption(p_redemption uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_red public.redemptions%rowtype;
begin
  select * into v_red from public.redemptions where id = p_redemption for update;
  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;
  if not (public.is_admin() or (public.is_venue_staff(v_red.venue_id) and v_red.created_at > now() - interval '12 hours')) then
    return jsonb_build_object('status', 'forbidden');
  end if;
  if v_red.voided_at is not null then
    return jsonb_build_object('status', 'already');
  end if;
  update public.redemptions set voided_at = now(), voided_by = auth.uid() where id = v_red.id;
  delete from public.points_ledger where redemption_id = v_red.id;
  return jsonb_build_object('status', 'voided', 'points', v_red.points);
end;
$$;

revoke execute on function public.void_redemption(uuid) from public, anon;
grant execute on function public.void_redemption(uuid) to authenticated;
