// 国土地理院「指定緊急避難場所データ」（津波）— 全国。GPU を使わない。
//   タイル: https://cyberjapandata.gsi.go.jp/xyz/skhb05/10/{x}/{y}.geojson （ズーム10のみ・点データ）
//   properties: name（施設・場所名）, address（住所）, remarks（備考）, disaster5 = 1（津波）
// 市町村長が指定した施設・場所を、市町村からの情報をもとに国土地理院が整理したもの。
// 最新の状況（指定の変更・開設の可否）は市町村に確認する必要がある — 画面にも必ずそう書く。
import { haversine, tilesFor } from './geo.js';
import { fetchOk } from './tiles.js';

const URL = (t) => `https://cyberjapandata.gsi.go.jp/xyz/skhb05/${t.z}/${t.x}/${t.y}.geojson`;
const cache = new Map(); // url → Promise<features[] | null>   (null = no tile there)

function loadTile(t) {
  const url = URL(t);
  if (!cache.has(url)) {
    const p = fetchOk(url, 12000)
      .then((r) => (r ? r.json() : null))
      .then((j) => (j && Array.isArray(j.features) ? j.features : null));
    p.catch(() => cache.delete(url)); // a failed tile may be retried later
    cache.set(url, p);
  }
  return cache.get(url);
}

/**
 * designated tsunami evacuation sites within `radius` metres of (lat, lon), nearest first.
 * status: 'ok' (the list is complete for this radius, possibly empty) | 'failed' (network — never read as "none")
 */
export async function loadEvacSites(lat, lon, radius = 1000, limit = 5) {
  const dLat = radius / 110940, dLon = radius / (111320 * Math.cos((lat * Math.PI) / 180));
  const tiles = tilesFor({ west: lon - dLon, east: lon + dLon, north: lat + dLat, south: lat - dLat }, 10);
  let feats;
  try { feats = (await Promise.all(tiles.map(loadTile))).flatMap((f) => f ?? []); }
  catch { return { status: 'failed', sites: [], total: 0, radius }; }
  const seen = new Set();
  const all = [];
  for (const f of feats) {
    const c = f?.geometry?.coordinates;
    if (f?.geometry?.type !== 'Point' || !Array.isArray(c)) continue;
    const d = haversine(lat, lon, c[1], c[0]);
    if (d > radius) continue;
    const p = f.properties ?? {};
    const name = String(p.name ?? '').trim();
    if (!name) continue;
    const key = `${name}|${c[0].toFixed(5)}|${c[1].toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    all.push({ name, address: String(p.address ?? '').trim(), remarks: String(p.remarks ?? '').trim(), lat: c[1], lon: c[0], d, bearing: bearingJa(lat, lon, c[1], c[0]) });
  }
  all.sort((a, b) => a.d - b.d);
  return { status: 'ok', sites: all.slice(0, limit), total: all.length, radius };
}

/** 8-point compass direction (日本語) from point 1 to point 2 */
export function bearingJa(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
  const deg = (Math.atan2(y, x) / r + 360) % 360;
  return ['北', '北東', '東', '南東', '南', '南西', '西', '北西'][Math.round(deg / 45) % 8];
}

/** "約190m" / "約1.2km" — straight-line distance, rounded to 10 m */
export const distJa = (d) => (d < 1000 ? `約${Math.max(10, Math.round(d / 10) * 10)}m` : `約${(d / 1000).toFixed(1)}km`);

export const EVAC_SOURCE = '国土地理院「指定緊急避難場所データ」（津波）';
export const EVAC_SOURCE_URL = 'https://www.gsi.go.jp/bousaichiri/hinanbasho.html';
