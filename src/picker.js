// 地点選択：MapLibre（地理院 淡色地図）＋ 住所検索 ＋ プリセット
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// the published build must point MapLibre at a bundled worker (its own relative lookup breaks after bundling
// → "Worker failed to load" and no GeoJSON outline on the map)
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
maplibregl.setWorkerUrl(maplibreWorkerUrl);
import { fetchOk } from './data/tiles.js';

export const PRESETS = [
  // all within reach of open water (≤ 4 km square); 南陽町 itself is 5.4 km from open sea
  { name: '港区 善進本町', lat: 35.1008, lon: 136.8560, group: '名古屋｜海抜ゼロメートル地帯' },
  { name: '港区 辰巳町', lat: 35.1120, lon: 136.8900, group: '名古屋｜海抜ゼロメートル地帯' },
  { name: '港区 東海通', lat: 35.1134, lon: 136.8875, group: '名古屋｜海抜ゼロメートル地帯' },
  { name: '南区 柴田', lat: 35.0761, lon: 136.9111, group: '名古屋｜海抜ゼロメートル地帯' },
  { name: 'ガーデンふ頭', lat: 35.0905, lon: 136.8844, group: '名古屋｜名古屋港' },
  { name: '港区 稲永', lat: 35.0898, lon: 136.8612, group: '名古屋｜名古屋港' },
  { name: '港区 船見町', lat: 35.0720, lon: 136.8958, group: '名古屋｜名古屋港' },
  { name: '金城ふ頭', lat: 35.0541, lon: 136.8441, group: '名古屋｜名古屋港' },
  { name: '高知市 種崎', lat: 33.5061, lon: 133.5693 },
  { name: '焼津漁港', lat: 34.8730, lon: 138.3221 },
  { name: '尾鷲市街', lat: 34.0753, lon: 136.1973 },
  { name: '串本町', lat: 33.4704, lon: 135.7800 },
  { name: '徳島市 沖洲', lat: 34.0550, lon: 134.5531 },
];

// keep the point (and its square) clear of the side card
const sidePad = () => (innerWidth > 760 ? { left: Math.min(460, innerWidth * 0.4), top: 0, right: 0, bottom: 0 } : { bottom: innerHeight * 0.55, top: 0, left: 0, right: 0 });

export function createPicker({ onPick }) {
  const map = new maplibregl.Map({
    container: 'map',
    style: {
      version: 8,
      sources: {
        pale: {
          type: 'raster', tiles: ['https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 18,
          // ZL8 以下の淡色地図は海岸線に VMAP0 を使っており、その出所も明示する（地理院タイル一覧の備考）
          attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">地理院タイル</a>（縮小表示の海岸線：Shoreline data is derived from: United States. National Imagery and Mapping Agency. "Vector Map Level 0 (VMAP0)." Bethesda, MD: Denver, CO: The Agency; USGS Information Services, 1997.）',
        },
        photo: { type: 'raster', tiles: ['https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg'], tileSize: 256, maxzoom: 18 },
      },
      layers: [
        { id: 'pale', type: 'raster', source: 'pale' },
        { id: 'photo', type: 'raster', source: 'photo', minzoom: 14, paint: { 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.5, 0.75] } },
      ],
    },
    center: [136.87, 35.09], // 名古屋港から始める（本人指定：まず名古屋地域）
    zoom: 11.3,
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  let marker = null;
  let square = false;

  function setPoint(lat, lon, fly = true) {
    if (!marker) {
      const el = document.createElement('div');
      el.className = 'pin-marker';
      marker = new maplibregl.Marker({ element: el, anchor: 'bottom-left' });
    }
    marker.setLngLat([lon, lat]).addTo(map);
    if (fly) map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 13.6), speed: 1.6, padding: sidePad() });
    onPick(lat, lon);
  }

  /** outline of the square that will be simulated */
  function showSquare(ring, outerRing = null) {
    // a point picked (or deep-linked) before the style finished loading must wait, not throw
    if (!map.isStyleLoaded()) { map.once('load', () => showSquare(ring, outerRing)); return; }
    const fc = (r) => ({ type: 'FeatureCollection', features: r ? [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [r] }, properties: {} }] : [] });
    if (!square) {
      map.addSource('dom', { type: 'geojson', data: fc(ring) });
      map.addSource('dom-outer', { type: 'geojson', data: fc(outerRing) });
      map.addLayer({ id: 'dom-outer-line', type: 'line', source: 'dom-outer', paint: { 'line-color': '#4fb3d9', 'line-width': 1.5, 'line-dasharray': [4, 3] } });
      map.addLayer({ id: 'dom-fill', type: 'fill', source: 'dom', paint: { 'fill-color': '#4fb3d9', 'fill-opacity': 0.08 } });
      map.addLayer({ id: 'dom-line', type: 'line', source: 'dom', paint: { 'line-color': '#0e5d86', 'line-width': 2, 'line-dasharray': [2, 1] } });
      square = true;
    } else { map.getSource('dom').setData(fc(ring)); map.getSource('dom-outer').setData(fc(outerRing)); }
    if (outerRing) {
      const xs = outerRing.map((p) => p[0]), ys = outerRing.map((p) => p[1]);
      map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: { ...sidePad(), top: 30, right: 30, bottom: 30 }, duration: 800 });
    }
  }

  map.on('click', (e) => setPoint(e.lngLat.lat, e.lngLat.lng, false));

  // presets
  const pre = document.getElementById('presets');
  let lastGroup = null;
  for (const p of PRESETS) {
    if ((p.group ?? 'その他') !== lastGroup) {
      lastGroup = p.group ?? 'その他';
      const h = document.createElement('span');
      h.className = 'preset-group';
      h.textContent = lastGroup;
      pre.appendChild(h);
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = p.name;
    b.onclick = () => setPoint(p.lat, p.lon);
    pre.appendChild(b);
  }

  // address search (国土地理院 住所検索API)
  const form = document.getElementById('search');
  const list = document.getElementById('results');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = document.getElementById('q').value.trim();
    if (!q) return;
    list.hidden = false;
    list.innerHTML = '<li>検索中…</li>';
    try {
      const r = await fetchOk(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(q)}`, 10000);
      const js = r ? await r.json() : [];
      list.innerHTML = '';
      if (!js.length) { list.innerHTML = '<li>見つかりませんでした</li>'; return; }
      for (const f of js.slice(0, 8)) {
        const li = document.createElement('li');
        li.tabIndex = 0;
        li.textContent = f.properties.title;
        const go = () => { list.hidden = true; setPoint(f.geometry.coordinates[1], f.geometry.coordinates[0]); };
        li.onclick = go;
        li.onkeydown = (ev) => { if (ev.key === 'Enter') go(); };
        list.appendChild(li);
      }
    } catch {
      list.innerHTML = '<li>検索できませんでした（通信を確認してください）</li>';
    }
  });

  return { map, setPoint, showSquare, resize: () => map.resize() };
}
