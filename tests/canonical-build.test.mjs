import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = pathToFileURL(resolve('scripts/sitemap.mjs')).href;
function build(site = 'https://nassaunights.com') {
  const dir = mkdtempSync(join(tmpdir(), 'nassau-canonical-'));
  mkdirSync(join(dir, 'dist'));
  writeFileSync(join(dir, 'dist/index.html'), '<html><head><title>Nassau Nights</title></head><body><div id="root"></div></body></html>');
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', `
    globalThis.fetch = async url => ({ ok: true, json: async () => url.includes('/venues?')
      ? [{slug:'bon-vivants',updated_at:'2026-10-18'}]
      : [{id:'f41cbf5d-39e5-4935-8b4c-f9f090c71287',updated_at:'2026-10-18'}] });
    await import(${JSON.stringify(script)});
  `], {cwd:dir, encoding:'utf8', env:{...process.env, SITE_URL:site, VITE_SUPABASE_URL:'https://fixture.invalid', VITE_SUPABASE_ANON_KEY:'fixture-only'}});
  return {dir, run};
}

test('each sitemap page has one matching initial-HTML canonical; fallback is untagged', () => {
  const {dir,run} = build();
  try {
    assert.equal(run.status, 0, run.stderr);
    const xml = readFileSync(join(dir,'dist/sitemap.xml'),'utf8');
    const urls = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map(m => m[1]);
    assert.equal(urls.length, 7);
    for (const url of urls) {
      const path = new URL(url).pathname;
      const html = readFileSync(join(dir, 'dist', path === '/' ? '' : path.slice(1), 'index.html'),'utf8');
      assert.deepEqual([...html.matchAll(/<link rel="canonical" href="([^"]+)"/g)].map(m=>m[1]), [url]);
    }
    assert.doesNotMatch(readFileSync(join(dir,'dist/spa.html'),'utf8'), /rel="canonical"/);
    assert.match(readFileSync(join(dir,'dist/robots.txt'),'utf8'), /Sitemap: https:\/\/nassaunights.com\/sitemap.xml/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('conflicting SITE_URL fails before publishing mismatched canonicals', () => {
  const {dir,run} = build('https://www.nassaunights.com');
  try { assert.notEqual(run.status,0); assert.match(run.stderr,/official canonical origin/); }
  finally { rmSync(dir,{recursive:true,force:true}); }
});
