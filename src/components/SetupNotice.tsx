import { Database } from 'lucide-react';

/** Shown instead of empty pages until .env.local points at a Supabase project. */
export function SetupNotice() {
  return (
    <div className="max-w-xl my-8 mx-4 md:mx-auto bg-night-900 rounded-3xl border border-amber-400/25 shadow-sm p-6">
      <div className="flex items-center gap-3 mb-3">
        <span className="w-10 h-10 rounded-2xl bg-amber-400/15 text-amber-300 flex items-center justify-center">
          <Database className="w-5 h-5" />
        </span>
        <h2 className="text-lg font-extrabold text-white">Connect Supabase to get started</h2>
      </div>
      <ol className="list-decimal pl-5 space-y-1.5 text-sm text-night-200">
        <li>Create a project at supabase.com.</li>
        <li>
          Open <b>SQL Editor</b>, paste <code className="px-1 bg-white/10 rounded">supabase/schema.sql</code> and run it.
        </li>
        <li>
          Copy <code className="px-1 bg-white/10 rounded">.env.example</code> to{' '}
          <code className="px-1 bg-white/10 rounded">.env.local</code> and fill in the URL + anon key from{' '}
          <b>Project Settings → API</b>.
        </li>
        <li>Restart the dev server.</li>
      </ol>
    </div>
  );
}
