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
--   venue-media     public  — gallery, menu photos, covers (admin write)
--   submission-uploads   private — photos attached to community suggestions
--                                  (anyone can upload; only admins can view)
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('venue-media', 'venue-media', true, 15728640,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'])
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
-- (invited_at, then venue_count, were added after the first version).
drop function if exists public.admin_list_users(text, text, int, int);
create function public.admin_list_users(
  p_search text default null,
  p_filter text default 'all',      -- all | admins | managers | suspended | unconfirmed | invited
  p_limit  int  default 50,
  p_offset int  default 0
)
returns table (
  id uuid, email text, display_name text, created_at timestamptz,
  last_sign_in_at timestamptz, email_confirmed_at timestamptz, banned_until timestamptz,
  invited_at timestamptz, is_admin boolean, venue_count int, review_count int, hidden_review_count int, submission_count int,
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

create or replace function public.venues_manager_guard()
returns trigger
language plpgsql
as $$
begin
  if public.is_restricted_writer() then
    new.is_published    := old.is_published;
    new.is_featured     := old.is_featured;
    new.featured_until  := old.featured_until;
    new.slug            := old.slug;
    new.radius_m        := old.radius_m;
    new.google_place_id := old.google_place_id;
  end if;
  return new;
end;
$$;

-- Named to sort before venues_slug, so the slug is restored before that runs.
drop trigger if exists venues_manager_guard on public.venues;
create trigger venues_manager_guard
  before update on public.venues
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
create or replace function public.admin_venue_managers(p_venue uuid)
returns table (user_id uuid, email text, display_name text, created_at timestamptz)
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
  select m.user_id, u.email::text, coalesce(p.display_name, 'Member'), m.created_at
  from public.venue_managers m
  join auth.users u on u.id = m.user_id
  left join public.profiles p on p.id = m.user_id
  where m.venue_id = p_venue
  order by m.created_at;
end;
$$;

revoke execute on function public.admin_venue_managers(uuid) from public, anon;
grant execute on function public.admin_venue_managers(uuid) to authenticated;

-- Review improvements: suggestions pass through a bounded, rate-limited Edge
-- Function. Apply this with the new function and frontend as one rollout.
drop policy if exists "Anyone can submit suggestions" on public.submissions;
drop policy if exists "Anyone can upload suggestion photos" on storage.objects;

create table if not exists public.suggestion_requests (
  id uuid primary key,
  rate_key text not null,
  fingerprint text not null,
  created_at timestamptz not null default now(),
  leased_at timestamptz not null default now(),
  completed boolean not null default false
);
alter table public.suggestion_requests enable row level security;
create index if not exists suggestion_requests_rate_idx on public.suggestion_requests (rate_key, created_at);
create index if not exists suggestion_requests_created_idx on public.suggestion_requests (created_at);

create or replace function public.reserve_suggestion(p_id uuid, p_key text, p_fingerprint text)
returns text language plpgsql security definer set search_path = public as $$
declare previous public.suggestion_requests;
begin
  -- Serializes concurrent reservations, so neither per-sender nor global caps race.
  perform pg_advisory_xact_lock(hashtextextended('suggestion-reservations',0));
  select * into previous from public.suggestion_requests where id = p_id for update;
  if found then
    if previous.rate_key <> p_key or previous.fingerprint <> p_fingerprint then return 'conflict'; end if;
    if previous.completed then return 'done'; end if;
    if previous.leased_at > now() - interval '2 minutes' then return 'wait'; end if;
    update public.suggestion_requests set leased_at = now() where id = p_id;
    return 'ready';
  end if;
  if (select count(*) from public.suggestion_requests where rate_key = p_key and created_at > now() - interval '1 hour') >= 6
     or (select count(*) from public.suggestion_requests where created_at > now() - interval '1 hour') >= 120 then
    return 'limit';
  end if;
  insert into public.suggestion_requests (id,rate_key,fingerprint) values (p_id,p_key,p_fingerprint);
  return 'ready';
end;
$$;

create or replace function public.finish_suggestion(p_id uuid, p_key text, p_fingerprint text, p_payload jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare previous public.suggestion_requests;
begin
  select * into previous from public.suggestion_requests where id = p_id for update;
  if not found or previous.rate_key <> p_key or previous.fingerprint <> p_fingerprint then raise exception 'Invalid reservation'; end if;
  if previous.completed then return; end if;
  insert into public.submissions (id,kind,venue_id,venue_name,fields,message,contact_name,contact_email,credit_ok,photo_paths,user_id)
  values (p_id,p_payload->>'kind',(p_payload->>'venue_id')::uuid,p_payload->>'venue_name',
    array(select jsonb_array_elements_text(p_payload->'fields')),p_payload->>'message',p_payload->>'contact_name',
    p_payload->>'contact_email',(p_payload->>'credit_ok')::boolean,array(select jsonb_array_elements_text(p_payload->'photo_paths')),
    (p_payload->>'user_id')::uuid);
  update public.suggestion_requests set completed = true where id = p_id;
end;
$$;
revoke all on public.suggestion_requests from public, anon, authenticated;
revoke execute on function public.reserve_suggestion(uuid,text,text) from public,anon,authenticated;
revoke execute on function public.finish_suggestion(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.reserve_suggestion(uuid,text,text) to service_role;
grant execute on function public.finish_suggestion(uuid,text,text,jsonb) to service_role;

-- Optional venue-confirmed practical information, editable by existing managers.
alter table public.venues add column if not exists visit_notes jsonb not null default '{}'::jsonb;
create or replace function public.valid_visit_notes(notes jsonb)
returns boolean language sql immutable as $$
  select case when jsonb_typeof(notes) <> 'object' then false else octet_length(notes::text) <= 8192
    and not exists (select 1 from jsonb_each(notes) n where n.key not in ('dress_code','age_policy','parking','accessibility','reservations','happy_hour')
      or jsonb_typeof(n.value) <> 'string' or char_length(n.value #>> '{}') > 300) end;
$$;
alter table public.venues drop constraint if exists venues_visit_notes_valid;
alter table public.venues add constraint venues_visit_notes_valid check (public.valid_visit_notes(visit_notes));
