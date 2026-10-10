import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';
test('suggestion migration, quotas, retries, permissions and note constraints', async () => {
const db = new PGlite();
const schema = await readFile(new URL('../supabase/schema.sql', import.meta.url),'utf8');
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
create schema storage; create table storage.objects(id uuid, name text, bucket_id text);
create table public.venues(id uuid primary key);`);
const base = schema.slice(schema.indexOf('create table if not exists public.submissions ('), schema.indexOf('create index if not exists submissions_status_idx'));
await db.exec(base + 'alter table public.submissions add column user_id uuid; alter table public.submissions enable row level security;');
await db.exec(`create policy "Anyone can submit suggestions" on public.submissions for insert with check (true);
create policy "Anyone can upload suggestion photos" on storage.objects for insert with check (true);`);
const migration = schema.slice(schema.indexOf('-- Review improvements:'));
await db.exec(migration); await db.exec(migration);
assert.equal((await db.query("select count(*)::int n from pg_policies where policyname in ('Anyone can submit suggestions','Anyone can upload suggestion photos')")).rows[0].n,0);
const call = async(id,key='guest',fp='body')=>(await db.query('select reserve_suggestion($1,$2,$3) result',[id,key,fp])).rows[0].result;
const id = i=>`00000000-0000-0000-0000-${String(i).padStart(12,'0')}`;
assert.equal(await call(id(1)),'ready'); assert.equal(await call(id(1)),'wait'); assert.equal(await call(id(1),'other'),'conflict');
const payload = JSON.stringify({kind:'other',message:'Test only',fields:[],credit_ok:false,photo_paths:[]});
await db.query('select finish_suggestion($1,$2,$3,$4)',[id(1),'guest','body',payload]);
await db.query('select finish_suggestion($1,$2,$3,$4)',[id(1),'guest','body',payload]);
assert.equal(await call(id(1)),'done');
assert.equal((await db.query('select count(*)::int n from submissions')).rows[0].n,1);
for(let i=2;i<=6;i++) assert.equal(await call(id(i)),'ready');
assert.equal(await call(id(7)),'limit');
await db.exec("update suggestion_requests set leased_at=now()-interval '3 minutes' where not completed");
assert.equal(await call(id(2)),'ready');
for(let i=7;i<=120;i++) assert.equal(await call(id(i),`guest${i}`),'ready');
assert.equal(await call(id(121),'newguest'),'limit');
for(const value of [[],1,'x',{unknown:'x'},{parking:3},{parking:'x'.repeat(301)}]) assert.equal((await db.query('select valid_visit_notes($1) ok',[JSON.stringify(value)])).rows[0].ok,false);
assert.equal((await db.query('select valid_visit_notes($1) ok',[JSON.stringify({parking:'Street parking'})])).rows[0].ok,true);
for(const role of ['anon','authenticated']) {
  assert.equal((await db.query("select has_function_privilege($1,'reserve_suggestion(uuid,text,text)','EXECUTE') ok",[role])).rows[0].ok,false);
  assert.equal((await db.query("select has_function_privilege($1,'finish_suggestion(uuid,text,text,jsonb)','EXECUTE') ok",[role])).rows[0].ok,false);
}

await db.close();

});
