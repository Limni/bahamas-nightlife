import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Circle, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import { Crosshair, Maximize2, Navigation, PartyPopper } from 'lucide-react';
import { useDirectory, useUserLocation, type UserLocation } from '@/lib/directory';
import { matchesFilters, useFilters } from '@/lib/filters';
import { NASSAU, NEW_PROVIDENCE } from '@/lib/geo';
import { eventIcon, meIcon, pinIcon, pinStyleFor, TILE_ATTRIBUTION, TILE_URL } from '@/lib/markers';
import { hasLocation, isFeatured, type NightEvent, type Venue } from '@/lib/types';
import { HEAT_META, useActivity, type Heat, type HeatLevel } from '@/lib/activity';
import { compareEvents, eventPosition, isEventEnded, isEventLive } from '@/lib/events';
import { precacheNassauTiles } from '@/lib/tilePrecache';
import { useNow } from '@/lib/useNow';
import { VenueDrawer } from '@/components/VenueDrawer';
import { EventDrawer } from '@/components/EventDrawer';
import { FilterSheet, QuickFilters, SearchFilterBar } from '@/components/FilterSheet';

type Pinned = Venue & { lat: number; lng: number };

// Heat per venue marker, so a cluster bubble can glow with its busiest member.
const markerHeat = new WeakMap<L.Marker, HeatLevel>();
const HEAT_RANK: Record<HeatLevel, number> = { quiet: 0, chill: 1, lively: 2, packed: 3 };
type PinnedEvent = NightEvent & { pos: { lat: number; lng: number } };

const ISLAND = L.latLngBounds([NEW_PROVIDENCE.south, NEW_PROVIDENCE.west], [NEW_PROVIDENCE.north, NEW_PROVIDENCE.east]);
// A little slack past the island so edge pins can be panned out from under the floating search panel.
const PAN_LIMIT = ISLAND.pad(0.15);

// Keeps the map on New Providence: the furthest zoom-out is the one where the
// whole island just fits this screen, recomputed on resize. A fixed minZoom
// would crop the island on phones and show mostly ocean on wide monitors.
// Computed unsnapped (getBoundsZoom floors to whole levels, nearly double the
// area); Leaflet snaps first and clamps after, so a fractional minZoom holds.
function LockToIsland() {
  const map = useMap();
  useEffect(() => {
    const fit = () => {
      const size = map.getSize();
      if (!size.x || !size.y) return;
      const z = map.getZoom();
      const nw = map.project(ISLAND.getNorthWest(), z);
      const se = map.project(ISLAND.getSouthEast(), z);
      map.setMinZoom(map.getScaleZoom(Math.min(size.x / (se.x - nw.x), size.y / (se.y - nw.y)), z));
    };
    fit();
    map.on('resize', fit);
    return () => {
      map.off('resize', fit);
    };
  }, [map]);
  return null;
}

// Drives the camera: flies to a selected spot, opens on the user's location
// once, and — while follow mode is on — keeps the user centred. A manual pan
// releases follow so it stops snapping back.
function MapController({
  location,
  following,
  selected,
  onUserPan,
}: {
  location: UserLocation | null;
  following: boolean;
  selected: { lat: number; lng: number } | null;
  onUserPan: () => void;
}) {
  const hasCentered = useRef(false);
  const didInitialCenter = useRef(false);
  const map = useMapEvents({ dragstart: () => onUserPan() });

  useEffect(() => {
    if (didInitialCenter.current || !location) return;
    didInitialCenter.current = true;
    // Only jump to the user if they're actually on New Providence-ish.
    const nearNassau = Math.abs(location.lat - NASSAU[0]) < 0.5 && Math.abs(location.lng - NASSAU[1]) < 0.5;
    if (!selected && nearNassau) map.setView([location.lat, location.lng], Math.max(map.getZoom(), 15), { animate: true });
  }, [location, selected, map]);

  // Fly to the selection, offset so the pin clears the bottom drawer.
  useEffect(() => {
    if (!selected) return;
    const targetZoom = Math.max(map.getZoom(), 16);
    const point = map.project([selected.lat, selected.lng], targetZoom);
    const offsetY = window.innerWidth < 768 ? map.getSize().y * 0.25 : 0;
    const center = map.unproject(point.add(L.point(0, offsetY)), targetZoom);
    map.flyTo(center, targetZoom, { animate: true, duration: 1.1 });
  }, [selected, map]);

  useEffect(() => {
    if (!following) {
      hasCentered.current = false;
      return;
    }
    if (!location || selected) return;
    if (!hasCentered.current) {
      hasCentered.current = true;
      map.flyTo([location.lat, location.lng], Math.max(map.getZoom(), 16), { animate: true, duration: 1.1 });
    } else {
      map.panTo([location.lat, location.lng], { animate: true });
    }
  }, [following, location, selected, map]);

  return null;
}

// Re-frames the map around the results whenever the filters change, so
// filtering for "Beach Bar" shows you where all the beach bars are.
function FitToResults({ spots, signal }: { spots: Pinned[]; signal: string }) {
  const map = useMap();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (spots.length === 0) return;
    if (spots.length === 1) {
      map.flyTo([spots[0].lat, spots[0].lng], Math.max(map.getZoom(), 15), { duration: 0.8 });
      return;
    }
    map.flyToBounds(L.latLngBounds(spots.map((s) => [s.lat, s.lng])), { padding: [60, 60], maxZoom: 16, duration: 0.8 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signal, map]);
  return null;
}

// Clusters the venue pins (the user dot and event pins stay out of the
// cluster). At zoom >= 16 — where selected pins are flown to — clustering is
// disabled so the selected pin is never hidden inside a bubble. Each pin
// carries its venue's live-activity halo.
function ClusterLayer({
  spots,
  selectedId,
  now,
  heatOf,
  onSelect,
}: {
  spots: Pinned[];
  selectedId: string | null;
  now: number;
  heatOf: (id: string) => Heat;
  onSelect: (r: Pinned) => void;
}) {
  const map = useMap();
  const groupRef = useRef<L.MarkerClusterGroup | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const prevSelectedRef = useRef<string | null>(null);
  const heatRef = useRef(heatOf);

  useEffect(() => {
    const group = L.markerClusterGroup({
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      disableClusteringAtZoom: 16,
      maxClusterRadius: 60,
      iconCreateFunction: (cluster) => {
        let top: HeatLevel = 'quiet';
        for (const m of cluster.getAllChildMarkers()) {
          const h = markerHeat.get(m) ?? 'quiet';
          if (HEAT_RANK[h] > HEAT_RANK[top]) top = h;
        }
        const halo = top === 'quiet' ? '' : `<div class="marker-heat ${top}" style="--heat-color:${HEAT_META[top].color};--heat-size:${top === 'packed' ? 104 : 84}px"></div>`;
        return L.divIcon({
          html: `<div class="cluster-bubble" style="position:relative">${halo}${cluster.getChildCount()}</div>`,
          className: 'cluster-icon',
          iconSize: [46, 46],
        });
      },
    });
    groupRef.current = group;
    map.addLayer(group);
    return () => {
      map.removeLayer(group);
      groupRef.current = null;
      markersRef.current.clear();
    };
  }, [map]);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    group.clearLayers();
    markersRef.current.clear();
    const markers = spots.map((r) => {
      const featured = isFeatured(r, now);
      const marker = L.marker([r.lat, r.lng], {
        icon: pinIcon(pinStyleFor(r.categories), false, featured, heatRef.current(r.id).level),
        zIndexOffset: featured ? 100 : 0,
        title: r.name,
        alt: r.name,
      });
      marker.on('click', () => onSelect(r));
      markerHeat.set(marker, heatRef.current(r.id).level);
      markersRef.current.set(r.id, marker);
      return marker;
    });
    group.addLayers(markers);
    prevSelectedRef.current = null;
  }, [spots, onSelect, now]);

  // Live activity moves every minute: swap icons in place (pinIcon caches per
  // level, so an unchanged venue gets the same icon object and Leaflet skips it).
  useEffect(() => {
    heatRef.current = heatOf;
    let levelsChanged = false;
    for (const r of spots) {
      const marker = markersRef.current.get(r.id);
      if (!marker) continue;
      const featured = isFeatured(r, now);
      const level = heatOf(r.id).level;
      if (markerHeat.get(marker) !== level) {
        markerHeat.set(marker, level);
        levelsChanged = true;
      }
      const selected = r.id === prevSelectedRef.current;
      const icon = pinIcon(pinStyleFor(r.categories), selected, featured, level);
      if (!selected && marker.getIcon() === icon) continue;
      marker.setIcon(icon);
      // Busier places float above quieter neighbours.
      marker.setZIndexOffset(selected ? 300 : (featured ? 100 : 0) + HEAT_RANK[level] * 20);
    }
    // Re-draw cluster bubbles so their glow follows the new levels.
    if (levelsChanged) groupRef.current?.refreshClusters();
  }, [heatOf, spots, now]);

  useEffect(() => {
    const apply = (id: string, selected: boolean) => {
      const marker = markersRef.current.get(id);
      const r = spots.find((x) => x.id === id);
      if (!marker || !r) return;
      const featured = isFeatured(r, now);
      marker.setIcon(pinIcon(pinStyleFor(r.categories), selected, featured, heatRef.current(r.id).level));
      marker.setZIndexOffset(selected ? 300 : featured ? 100 : 0);
    };
    const prev = prevSelectedRef.current;
    if (prev && prev !== selectedId) apply(prev, false);
    if (selectedId) apply(selectedId, true);
    prevSelectedRef.current = selectedId;
  }, [selectedId, spots, now]);

  return null;
}

// Imperative handle so buttons outside <MapContainer> can drive the map.
function MapRef({ onReady }: { onReady: (m: L.Map) => void }) {
  const map = useMap();
  useEffect(() => {
    onReady(map);
  }, [map, onReady]);
  return null;
}

export default function MapPage() {
  const { venues, venueById, events } = useDirectory();
  const { filters } = useFilters();
  const { location, error: locationError, enable: enableLocation } = useUserLocation();
  const { heatOf, isBusy, activity } = useActivity();
  const now = useNow();
  const [selected, setSelected] = useState<{ kind: 'venue' | 'event'; id: string } | null>(null);
  const [following, setFollowing] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    enableLocation();
  }, [enableLocation]);

  // Seed the Nassau tile cache once, after the visible tiles have loaded.
  useEffect(() => {
    const id = window.setTimeout(() => precacheNassauTiles().catch(() => {}), 4000);
    return () => window.clearTimeout(id);
  }, []);

  const spots = useMemo(
    () => venues.filter((r): r is Pinned => hasLocation(r) && matchesFilters(r, filters, now, isBusy)),
    [venues, filters, now, isBusy],
  );
  // Events aren't filtered by venue filters (a search for "rooftop" shouldn't
  // hide tonight's beach party), but they do follow the search text.
  const mapEvents = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return events
      .filter((e) => !isEventEnded(e, now) && (!q || `${e.title} ${e.description ?? ''}`.toLowerCase().includes(q)))
      .map((e) => ({ ...e, pos: eventPosition(e, e.venue_id ? venueById.get(e.venue_id) : undefined) }))
      .filter((e): e is PinnedEvent => e.pos !== null);
  }, [events, venueById, filters.q, now]);

  const selectedVenue = selected?.kind === 'venue' ? (spots.find((s) => s.id === selected.id) ?? null) : null;
  const selectedEvent = selected?.kind === 'event' ? (mapEvents.find((e) => e.id === selected.id) ?? null) : null;
  // Stable per selection, so the minute tick (which rebuilds the event list) doesn't re-fly the camera.
  const tLat = selectedVenue?.lat ?? selectedEvent?.pos.lat;
  const tLng = selectedVenue?.lng ?? selectedEvent?.pos.lng;
  const target = useMemo(() => (tLat != null && tLng != null ? { lat: tLat, lng: tLng } : null), [selected?.id, tLat, tLng]); // eslint-disable-line react-hooks/exhaustive-deps

  const venueEvents = useMemo(
    () => (selectedVenue ? events.filter((e) => e.venue_id === selectedVenue.id && !isEventEnded(e, now)).sort(compareEvents(now)) : []),
    [selectedVenue, events, now],
  );

  const select = useCallback((r: Pinned) => setSelected({ kind: 'venue', id: r.id }), []);
  const selectEvent = useCallback((e: NightEvent) => setSelected({ kind: 'event', id: e.id }), []);
  const stopFollow = useCallback(() => setFollowing(false), []);
  const onMapReady = useCallback((m: L.Map) => {
    mapRef.current = m;
  }, []);

  // "On map" links → /map?focus=<venue id> or /map?event=<event id>
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const focus = params.get('focus');
    const event = params.get('event');
    if (focus && venues.some((r) => r.id === focus)) setSelected({ kind: 'venue', id: focus });
    else if (event && events.some((e) => e.id === event)) setSelected({ kind: 'event', id: event });
    else if (!(focus || event) || venues.length === 0) return;
    setParams({}, { replace: true });
  }, [params, venues, events, setParams]);

  const fitAll = () => {
    const map = mapRef.current;
    const points = [...spots.map((s) => [s.lat, s.lng] as [number, number]), ...mapEvents.map((e) => [e.pos.lat, e.pos.lng] as [number, number])];
    if (!map || points.length === 0) return;
    setSelected(null);
    setFollowing(false);
    map.flyToBounds(L.latLngBounds(points), { padding: [60, 60], maxZoom: 16, duration: 0.8 });
  };

  const filterSignal = JSON.stringify(filters);
  const unpinned = venues.filter((r) => !hasLocation(r)).length;
  const buzzing = spots.filter((s) => (activity[s.id]?.live_count ?? 0) > 0).length;
  const liveEvents = mapEvents.filter((e) => isEventLive(e, now)).length;

  return (
    <div className="map-full fixed inset-x-0 top-0 md:top-16 bottom-[calc(64px+env(safe-area-inset-bottom))] md:bottom-0 bg-night-900">
      {/* Search + filters, floating over the map */}
      <div className="absolute top-0 inset-x-0 z-[1000] p-4 pointer-events-none">
        <div className="max-w-md mx-auto md:mx-0 md:ml-4 space-y-2 pointer-events-auto">
          <SearchFilterBar glass onOpenFilters={() => setFiltersOpen(true)} />
          <QuickFilters glass />
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-night-900/90 backdrop-blur ring-1 ring-white/10 text-xs font-extrabold text-night-100 shadow">
              {spots.length} {spots.length === 1 ? 'spot' : 'spots'}
              {buzzing > 0 && <span className="text-heat-lively">· {buzzing} buzzing</span>}
              {unpinned > 0 && <span className="text-night-400 font-bold">· {unpinned} without a pin</span>}
            </span>
            {liveEvents > 0 && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-500/90 backdrop-blur text-xs font-extrabold text-white glow-brand">
                <PartyPopper className="w-3.5 h-3.5" /> {liveEvents} live {liveEvents === 1 ? 'event' : 'events'}
              </span>
            )}
          </div>
          {locationError && (
            <div className="bg-rose-950/90 backdrop-blur-md text-rose-200 px-4 py-3 rounded-2xl flex items-start gap-3 border border-rose-400/30 shadow-lg">
              <Navigation className="w-5 h-5 mt-0.5 shrink-0" />
              <p className="text-sm font-bold">{locationError}</p>
            </div>
          )}
        </div>
      </div>

      {/* Heat legend */}
      <div className="absolute z-[900] left-4 bottom-6 hidden sm:flex items-center gap-3 px-3 py-1.5 rounded-full bg-night-900/90 backdrop-blur ring-1 ring-white/10 text-[11px] font-extrabold text-night-200">
        {(['chill', 'lively', 'packed'] as const).map((l) => (
          <span key={l} className="inline-flex items-center gap-1.5">
            <span className="heat-dot" style={{ color: HEAT_META[l].color }} /> {HEAT_META[l].label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5 text-brand-200">
          <PartyPopper className="w-3.5 h-3.5" /> Event
        </span>
      </div>

      {/* Map controls */}
      <div className="absolute bottom-6 right-4 md:right-6 z-[1000] flex flex-col gap-3">
        <button
          onClick={fitAll}
          title="Show all results"
          aria-label="Show all results"
          className="w-14 h-14 rounded-2xl bg-night-900/95 border border-white/10 text-brand-300 hover:bg-night-800 shadow-[0_8px_30px_rgb(0,0,0,0.5)] flex items-center justify-center active:scale-95 transition-all"
        >
          <Maximize2 className="w-6 h-6" />
        </button>
        <button
          onClick={() => setFollowing((f) => !f)}
          disabled={!location}
          aria-pressed={following}
          title={following ? 'Stop following my location' : 'Follow my location'}
          className={`w-14 h-14 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.5)] border flex items-center justify-center transition-all disabled:opacity-50 active:scale-95 ${
            following
              ? 'bg-brand-500 border-brand-400 text-white glow-brand'
              : 'bg-night-900/95 border-white/10 text-brand-300 hover:bg-night-800'
          }`}
        >
          <Crosshair className="w-7 h-7" />
        </button>
      </div>

      <VenueDrawer
        venue={selectedVenue}
        events={venueEvents}
        location={location}
        now={now}
        onClose={() => setSelected(null)}
        onEvent={selectEvent}
      />
      <EventDrawer
        event={selectedEvent}
        venue={selectedEvent?.venue_id ? venueById.get(selectedEvent.venue_id) : undefined}
        location={location}
        now={now}
        onClose={() => setSelected(null)}
      />

      <MapContainer
        center={NASSAU}
        zoom={13}
        maxZoom={22}
        maxBounds={PAN_LIMIT}
        maxBoundsViscosity={1}
        zoomControl={false}
        className="w-full h-full"
        style={{ height: '100%', width: '100%' }}
      >
        {/* maxNativeZoom 20 is the deepest the basemap renders; Leaflet
            upscales beyond that so dense pins can be pulled apart. crossOrigin
            makes tiles cacheable by the service worker (public/sw.js). */}
        <TileLayer attribution={TILE_ATTRIBUTION} url={TILE_URL} maxNativeZoom={20} maxZoom={22} crossOrigin keepBuffer={6} />
        <LockToIsland />
        <MapRef onReady={onMapReady} />
        <MapController location={location} following={following} selected={target} onUserPan={stopFollow} />
        <FitToResults spots={spots} signal={filterSignal} />

        {location && Number.isFinite(location.accuracy) && location.accuracy > 0 && (
          <Circle
            center={[location.lat, location.lng]}
            radius={location.accuracy}
            pathOptions={{ color: '#0ea5e9', weight: 1, opacity: 0.4, fillColor: '#0ea5e9', fillOpacity: 0.12 }}
            interactive={false}
          />
        )}
        {location && <Marker position={[location.lat, location.lng]} icon={meIcon} zIndexOffset={200} interactive={false} />}

        <ClusterLayer spots={spots} selectedId={selectedVenue?.id ?? null} now={now} heatOf={heatOf} onSelect={select} />

        {/* Highlighted events (Island GO): live ones flash above everything. */}
        {mapEvents.map((e) => {
          const live = isEventLive(e, now);
          return (
            <Marker
              key={e.id}
              position={[e.pos.lat, e.pos.lng]}
              icon={eventIcon(live, selectedEvent?.id === e.id, !!e.venue_id && e.lat == null)}
              zIndexOffset={selectedEvent?.id === e.id ? 600 : live ? 500 : 50}
              eventHandlers={{ click: () => selectEvent(e) }}
              title={e.title}
            />
          );
        })}
      </MapContainer>

      <FilterSheet open={filtersOpen} onClose={() => setFiltersOpen(false)} resultCount={spots.length} />
    </div>
  );
}
