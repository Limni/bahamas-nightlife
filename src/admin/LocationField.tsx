import { useEffect, useState } from 'react';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { ClipboardPaste, Crosshair, Loader2 } from 'lucide-react';
import { NASSAU } from '@/lib/geo';
import { pinIcon, DEFAULT_PIN, TILE_ATTRIBUTION, TILE_URL } from '@/lib/markers';
import { inputClass } from './ui';

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Pull coordinates out of whatever gets pasted: a Google Maps URL
 * (".../@25.07,-77.34,17z", "!3d25.07!4d-77.34", "?q=25.07,-77.34") or a
 * plain "25.07, -77.34". Short maps.app.goo.gl links can't be expanded from
 * the browser, so open those and copy the full URL instead.
 */
export function parseCoordinates(text: string): LatLng | null {
  const patterns = [/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/, /@(-?\d+\.\d+),(-?\d+\.\d+)/, /(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const lat = parseFloat(m[1]);
      const lng = parseFloat(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
    }
  }
  return null;
}

export function getDeviceLocation(): Promise<LatLng & { accuracy: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Location isn’t supported on this device.'));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) =>
        reject(new Error(err.code === err.PERMISSION_DENIED ? 'Location permission was denied.' : 'Couldn’t get a GPS fix — try again outside.')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}

function ClickToPlace({ onPick }: { onPick: (p: LatLng) => void }) {
  useMapEvents({ click: (e) => onPick({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

function Recenter({ value }: { value: LatLng | null }) {
  const map = useMap();
  useEffect(() => {
    if (value) map.setView([value.lat, value.lng], Math.max(map.getZoom(), 17));
  }, [value?.lat, value?.lng]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Tap the map, drag the pin, use the phone's GPS, or paste a Google Maps link. */
export function LocationField({ value, onChange }: { value: LatLng | null; onChange: (v: LatLng | null) => void }) {
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [paste, setPaste] = useState('');

  const useGps = async () => {
    setLocating(true);
    setMessage(null);
    try {
      const pos = await getDeviceLocation();
      onChange({ lat: pos.lat, lng: pos.lng });
      setMessage({ text: `Pinned to your location (±${Math.round(pos.accuracy)} m).` });
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true });
    } finally {
      setLocating(false);
    }
  };

  const applyPaste = (text: string) => {
    setPaste(text);
    if (!text.trim()) return;
    const coords = parseCoordinates(text);
    if (coords) {
      onChange(coords);
      setMessage({ text: 'Coordinates found in the link.' });
      setPaste('');
    } else if (/goo\.gl|maps\.app/.test(text)) {
      setMessage({ text: 'Short links can’t be read — open it, then copy the full URL from the address bar.', error: true });
    }
  };

  return (
    <div className="space-y-3">
      <div className="h-64 rounded-xl overflow-hidden border border-slate-200 relative z-0">
        <MapContainer center={value ? [value.lat, value.lng] : NASSAU} zoom={value ? 17 : 12} maxZoom={20} style={{ height: '100%', width: '100%' }}>
          <TileLayer attribution={TILE_ATTRIBUTION} url={TILE_URL} maxNativeZoom={20} crossOrigin />
          <ClickToPlace onPick={onChange} />
          <Recenter value={value} />
          {value && (
            <Marker
              position={[value.lat, value.lng]}
              icon={pinIcon(DEFAULT_PIN, true)}
              draggable
              eventHandlers={{
                dragend: (e) => {
                  const ll = e.target.getLatLng();
                  onChange({ lat: ll.lat, lng: ll.lng });
                },
              }}
            />
          )}
        </MapContainer>
        {!value && (
          <div className="absolute inset-x-0 bottom-3 z-[500] flex justify-center pointer-events-none">
            <span className="px-3 py-1.5 rounded-full bg-white/95 text-xs font-extrabold text-slate-700 shadow">Tap the map to drop a pin</span>
          </div>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <button
          type="button"
          onClick={useGps}
          disabled={locating}
          className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-brand-600 text-white text-sm font-extrabold hover:bg-brand-700 disabled:opacity-60"
        >
          {locating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Crosshair className="w-4 h-4" />}
          I’m here — use my GPS
        </button>
        <label className="relative flex-1">
          <ClipboardPaste className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input className={`${inputClass} pl-9`} placeholder="…or paste a Google Maps link / coordinates" value={paste} onChange={(e) => applyPaste(e.target.value)} />
        </label>
      </div>

      {message && <p className={`text-xs font-bold ${message.error ? 'text-rose-600' : 'text-emerald-700'}`}>{message.text}</p>}

      <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
        <label>
          <span className="block text-[11px] font-extrabold uppercase text-slate-400 mb-1">Latitude</span>
          <input
            className={inputClass}
            inputMode="decimal"
            value={value?.lat.toFixed(6) ?? ''}
            placeholder="25.0443"
            onChange={(e) => {
              const lat = parseFloat(e.target.value);
              if (!Number.isNaN(lat)) onChange({ lat, lng: value?.lng ?? NASSAU[1] });
            }}
          />
        </label>
        <label>
          <span className="block text-[11px] font-extrabold uppercase text-slate-400 mb-1">Longitude</span>
          <input
            className={inputClass}
            inputMode="decimal"
            value={value?.lng.toFixed(6) ?? ''}
            placeholder="-77.3504"
            onChange={(e) => {
              const lng = parseFloat(e.target.value);
              if (!Number.isNaN(lng)) onChange({ lat: value?.lat ?? NASSAU[0], lng });
            }}
          />
        </label>
        {value && (
          <button type="button" onClick={() => onChange(null)} className="px-3 py-2.5 rounded-xl text-xs font-extrabold text-rose-600 hover:bg-rose-50">
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
