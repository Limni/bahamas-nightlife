import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, X } from 'lucide-react';
import { inputClass } from './ui';

// ---------------------------------------------------------------------------
// Pick countries by name: chips for the chosen ones, a search box to add more.
// Values are ISO 3166-1 alpha-2 codes, the form Cloudflare reports a visitor's
// location in (lib/radio.tsx visitorCountry).
// ---------------------------------------------------------------------------

// Every assigned ISO 3166-1 alpha-2 code. Names come from the browser (Intl), so
// they stay current without a table to maintain.
const CODES = (
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
  'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP ' +
  'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT ' +
  'MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW ' +
  'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG ' +
  'UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW'
).split(' ');

let displayNames: Intl.DisplayNames | null | undefined;

/** "BS" → "Bahamas". Falls back to the code where Intl can't name it. */
export function countryName(code: string) {
  if (displayNames === undefined) {
    try {
      displayNames = new Intl.DisplayNames(['en'], { type: 'region' });
    } catch {
      displayNames = null;
    }
  }
  try {
    return displayNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

/** Regional-indicator flag ("BS" → 🇧🇸). Windows shows the two letters instead, which still reads fine. */
export const countryFlag = (code: string) => String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

export function CountryPicker({ value, onChange, disabled }: { value: string[]; onChange: (next: string[]) => void; disabled?: boolean }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const all = useMemo(() => CODES.map((code) => ({ code, name: countryName(code) })).sort((a, b) => a.name.localeCompare(b.name)), []);

  const matches = useMemo(() => {
    const needle = fold(q.trim());
    return all.filter(
      (c) => !value.includes(c.code) && (!needle || fold(c.name).includes(needle) || c.code.toLowerCase() === needle),
    );
  }, [all, q, value]);

  // Close the list on an outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const add = (code: string) => {
    onChange([...value, code]);
    setQ('');
    setOpen(false);
  };

  return (
    <div className="space-y-2.5">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {value.map((code) => (
            <li key={code} className="inline-flex items-center gap-1.5 pl-3 pr-1 py-1 rounded-full bg-brand-50 text-brand-800 ring-1 ring-brand-200 text-sm font-bold">
              <span aria-hidden>{countryFlag(code)}</span>
              {countryName(code)}
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(value.filter((c) => c !== code))}
                className="p-1 rounded-full hover:bg-brand-100 disabled:opacity-40"
                aria-label={`Remove ${countryName(code)}`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div ref={boxRef} className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        <input
          className={`${inputClass} pl-9`}
          value={q}
          disabled={disabled}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
            if (e.key === 'Enter' && q.trim() && matches[0]) {
              e.preventDefault();
              add(matches[0].code);
            }
          }}
          placeholder="Add a country"
          aria-label="Add a country"
          role="combobox"
          aria-expanded={open}
        />
        {open && !disabled && (
          <ul role="listbox" className="absolute z-20 left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded-xl bg-white ring-1 ring-slate-200 shadow-lg py-1">
            {matches.slice(0, 60).map((c) => (
              <li key={c.code} role="option" aria-selected={false}>
                <button type="button" onClick={() => add(c.code)} className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  <span aria-hidden>{countryFlag(c.code)}</span>
                  <span className="flex-1 min-w-0 truncate">{c.name}</span>
                  <Plus className="w-4 h-4 text-slate-400 shrink-0" />
                </button>
              </li>
            ))}
            {matches.length === 0 && <li className="px-3 py-2 text-sm font-semibold text-slate-500">No country matches “{q}”.</li>}
          </ul>
        )}
      </div>
    </div>
  );
}
