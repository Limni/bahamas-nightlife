import { readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
// Resolve extensionless source imports without changing the browser build.
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.') && context.parentURL?.endsWith('.ts') && !/\.[a-z]+$/.test(specifier)) specifier += '.ts';
  return next(specifier, context);
} });
export function isolatedSource(path, globals = {}, suffix = '') {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  return vm.runInNewContext(stripTypeScriptTypes(source) + suffix, { Date, Intl, URLSearchParams, TextEncoder, Blob, File, ...globals });
}
