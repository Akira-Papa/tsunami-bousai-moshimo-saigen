// ─────────────────────────────────────────────────────────────
//  Local metric frame around a chosen point
//  x = east (m), z = south (m), y = up (m, T.P. ≒ height above the geoid)
//  Over ≤ 3 km an equirectangular frame is accurate to a few cm.
// ─────────────────────────────────────────────────────────────
export const M_PER_DEG_LAT = 110940;
export const mPerDegLon = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);

export function makeFrame(lat0, lon0) {
  const kx = mPerDegLon(lat0);
  return {
    lat0, lon0,
    toLocal: (lat, lon) => ({ x: (lon - lon0) * kx, z: -(lat - lat0) * M_PER_DEG_LAT }),
    toLatLon: (x, z) => ({ lat: lat0 - z / M_PER_DEG_LAT, lon: lon0 + x / kx }),
  };
}

// Web-Mercator slippy tiles
export const lon2tx = (lon, z) => ((lon + 180) / 360) * 2 ** z;
export const lat2ty = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * 2 ** z;
};
export const tx2lon = (x, z) => (x / 2 ** z) * 360 - 180;
export const ty2lat = (y, z) => {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
};

/** tiles covering a lat/lon box at zoom z */
export function tilesFor(bbox, z) {
  const x0 = Math.floor(lon2tx(bbox.west, z)), x1 = Math.floor(lon2tx(bbox.east, z));
  const y0 = Math.floor(lat2ty(bbox.north, z)), y1 = Math.floor(lat2ty(bbox.south, z));
  const out = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ x, y, z });
  return out;
}

export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// deterministic hash → [0,1)
export function hash01(a, b = 0) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
