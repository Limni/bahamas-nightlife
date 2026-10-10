import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
test('crawler HTML has route-specific escaped metadata and a public sitemap',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'nassau-meta-'));
  const server=createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url.startsWith('/rest/v1/venues') ? [{id:'v1',slug:'test-venue',name:'Test & Venue',description:'A </script> surprise',area:'Nassau',cover_url:'javascript:bad'}] : [{id:'event-1',title:'Friday party',venue_id:'v1',start_date:'2026-01-01T00:00:00Z',end_date:null,hours:{'5':{open:'21:00',close:'02:00'}}}]))});
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    await mkdir(join(dir,'dist'));
    await writeFile(join(dir,'dist/index.html'),'<html><head><title>Original</title><meta name="description" content="Original"></head><body><div id="root"></div></body></html>');
    await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,[fileURLToPath(new URL('../scripts/prerender.mjs',import.meta.url))],{cwd:dir,env:{...process.env,VITE_SUPABASE_URL:`http://127.0.0.1:${server.address().port}`,VITE_SUPABASE_ANON_KEY:'test-only',PRERENDER_SKIP_DATA:'0'},stdio:'pipe'});
      let output='';child.stderr.on('data',v=>output+=v);child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(output)));
    });
    const html=await readFile(join(dir,'dist/v/test-venue/index.html'),'utf8');
    assert.match(html,/<title>Test &amp; Venue — Nassau Nights<\/title>/);
    assert.match(html,/https:\/\/nassaunights.com\/v\/test-venue/);
    assert.doesNotMatch(html,/javascript:bad/);
    const structured=JSON.parse(html.match(/data-page-schema>(.*?)<\/script>/s)[1]);
    assert.equal(structured['@type'],'LocalBusiness');
    const event=await readFile(join(dir,'dist/events/event-1/index.html'),'utf8');
    assert.match(event,/EventSeries/);assert.match(event,/America\/Nassau/);
    const sitemap=await readFile(join(dir,'dist/sitemap.xml'),'utf8');
    assert.match(sitemap,/\/events\/event-1/);assert.doesNotMatch(sitemap,/\/account|\/night</);
    assert.match(await readFile(join(dir,'dist/night/index.html'),'utf8'),/noindex,follow/);
  } finally {await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
});
