import './helpers.mjs';
import { isolatedSource } from './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
const { nextSession, eventWhen } = await import('../src/lib/events.ts');
const { nassauInstant } = await import('../src/lib/nassauTime.ts');
const { eventCalendar } = await import('../src/lib/calendar.ts');
const { phoneHref } = await import('../src/lib/phone.ts');
const event = { id:'sample', title:'Night out', description:'A party', start_date:'2026-01-01T00:00:00Z', end_date:null, hours:{'1':{open:'00:30',close:'02:00'}} };

test('weekly openings cross the fall DST boundary in Nassau wall time', () => {
  const result = nextSession(event, Date.parse('2026-10-31T16:00:00Z'));
  assert.equal(new Date(result.at).toISOString(), '2026-11-02T05:30:00.000Z');
  assert.match(eventWhen(event, Date.parse('2026-11-01T04:30:00Z')), /^Tomorrow · 12:30 AM/);
});
test('weekly openings cross spring DST and skip nonexistent wall times', () => {
  assert.equal(nassauInstant('2026-03-08','02:30'), null);
  assert.equal(new Date(nassauInstant('2026-11-01','01:30')).toISOString(),'2026-11-01T05:30:00.000Z');
  const spring = nextSession(event,Date.parse('2026-03-07T17:00:00Z'));
  assert.equal(new Date(spring.at).toISOString(),'2026-03-09T04:30:00.000Z');
  assert.equal(nassauInstant('2026-02-30','12:00'),null);
});
test('calendar export preserves an active overnight session across DST', () => {
  const ics = eventCalendar({...event,hours:{'6':{open:'22:00',close:'03:00'}}},undefined,Date.parse('2026-11-01T06:30:00Z'));
  assert.match(ics,/DTSTART:20261101T020000Z/);
  assert.match(ics,/DTEND:20261101T080000Z/);
});
test('calendar escapes text, folds UTF-8 lines, and keeps original one-off start', () => {
  const e = {...event,title:'🎉'.repeat(30)+', fun;\nBEGIN:VEVENT',hours:null,start_date:'2026-10-10T22:00:00Z',end_date:'2026-10-11T02:00:00Z'};
  const ics = eventCalendar(e,undefined,Date.parse('2026-10-10T23:00:00Z'));
  assert.match(ics,/DTSTART:20261010T220000Z/);
  assert.match(ics.replace(/\r\n /g,''),/\\, fun\\;\\nBEGIN:VEVENT/);
  assert.ok(ics.split('\r\n').every(line=>Buffer.byteLength(line)<=75));
  assert.equal(eventCalendar(e,undefined,Date.parse('2026-10-12T00:00:00Z')),null);
});
test('saved and shared nights discard invalid IDs, duplicates and excess entries', () => {
  const {parseNight, sharedNight,nightUrl} = isolatedSource('src/lib/night.ts',{},';({parseNight,sharedNight,nightUrl})');
  assert.equal(JSON.stringify(parseNight('bad json')), '{"venues":[],"events":[]}');
  const parsed = sharedNight('?venues=abc,abc,%3Cscript%3E&events=event-1');
  assert.equal(JSON.stringify(parsed),'{"venues":["abc"],"events":["event-1"]}');
  assert.equal(parseNight(JSON.stringify({venues:Array.from({length:30},(_,i)=>`venue-${i}`)})).venues.length,20);
  assert.equal(JSON.stringify(sharedNight(new URL(nightUrl(parsed)).search)),JSON.stringify(parsed));
});
test('Bahamas call links include the international country code',()=>{
  assert.equal(phoneHref('(242) 555-1234'),'tel:+12425551234');
  assert.equal(phoneHref('555-1234'),'tel:+12425551234');
  assert.equal(phoneHref('+44 20 1234 5678'),'tel:+442012345678');
});
test('photo sanitization never falls back to the smaller original',async()=>{
  const encoded = new Blob(['sanitized image larger than original'],{type:'image/webp'});
  let closed = false;
  const compressImage = isolatedSource('src/lib/images.ts',{
    createImageBitmap:async()=>({width:10,height:10,close(){closed=true;}}),
    document:{createElement:()=>({getContext:()=>({drawImage(){}}),toBlob:cb=>cb(encoded)})},
  },';compressImage');
  const original = new File(['gps'], 'photo.jpg',{type:'image/jpeg'});
  assert.equal(await compressImage(original),encoded);
  assert.ok(closed);
  await assert.rejects(compressImage(new File(['svg'],'a.svg',{type:'image/svg+xml'})));
});
test('undecodable photos fail closed',async()=>{
  const compressImage = isolatedSource('src/lib/images.ts',{createImageBitmap:async()=>{throw Error('unsupported');}},';compressImage');
  await assert.rejects(compressImage(new File(['gps'],'photo.heic',{type:'image/heic'})),/cannot be processed safely/);
});
test('a confirmed suggestion stays successful when browser storage is full',async()=>{
  // Exercise the actual form handler with its API and browser boundaries stubbed.
  const source = readFileSync(new URL('../src/pages/Community.tsx',import.meta.url),'utf8');
  const handler = source.slice(source.indexOf('  const submit = async'),source.indexOf('\n  return (',source.indexOf('  const submit = async')));
  let status,error,calls=0;
  const globals = {FormData,Response,Date,Error,crypto,honeypot:'',needsVenue:false,venueId:null,kind:'other',message:'A useful tip',photos:[],session:null,profile:null,contactName:'',contactEmail:'',creditOk:false,request:{current:null},recentlySent:()=>[],RATE_KEY:'sent',localStorage:{setItem(){throw Error('QuotaExceeded');}},setStatus:v=>status=v,setError:v=>error=v,supabase:{functions:{invoke:async()=>{calls++;return {data:{id:'saved'}};}}}};
  await vm.runInNewContext(stripTypeScriptTypes(handler)+';submit({preventDefault(){}})',globals);
  assert.equal(status,'sent'); assert.equal(error,null); assert.equal(calls,1);
});
test('live activity expires while a page stays open and on any failed refresh',async()=>{
  const {activityIsFresh} = await import('../src/lib/activityFreshness.ts');
  assert.equal(activityIsFresh(1000,false,600999),true);
  assert.equal(activityIsFresh(1000,false,601000),false);
  assert.equal(activityIsFresh(1000,true,2000),false);
  assert.equal(activityIsFresh(null,false,2000),false);
  assert.equal(activityIsFresh(NaN,false,2000),false);
});
test('an unchanged suggestion keeps the same request ID after a network failure',async()=>{
  const source = readFileSync(new URL('../src/pages/Community.tsx',import.meta.url),'utf8');
  const handler = source.slice(source.indexOf('  const submit = async'),source.indexOf('\n  return (',source.indexOf('  const submit = async')));
  let status;const ids=[];
  const globals={FormData,Response,Date,Error,crypto,honeypot:'',needsVenue:false,venueId:null,kind:'other',message:'A useful tip',photos:[],session:null,profile:null,contactName:'',contactEmail:'',creditOk:false,request:{current:null},recentlySent:()=>[],RATE_KEY:'sent',localStorage:{setItem(){}},setStatus:v=>status=v,setError(){},supabase:{functions:{invoke:async(_, {body})=>{ids.push(body.get('request_id'));return ids.length===1 ? {error:new Error('network')} : {data:{id:'saved'}};}}}};
  const submit=vm.runInNewContext(stripTypeScriptTypes(handler)+';submit',globals);
  await submit({preventDefault(){}});assert.equal(status,'idle');
  await submit({preventDefault(){}});assert.equal(status,'sent');
  assert.equal(ids[0],ids[1]);
});
