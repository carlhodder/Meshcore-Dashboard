/**
 * Pure utility functions for the map page.
 * No React/Preact dependencies — safe to import anywhere.
 */

/**
 * Haversine great-circle distance in kilometres between two [lat, lon] points.
 */
export function haversineKm(a, b) {
  var R = 6371;
  var dLat = ((b[0] - a[0]) * Math.PI) / 180;
  var dLon = ((b[1] - a[1]) * Math.PI) / 180;
  var sinLat = Math.sin(dLat / 2),
    sinLon = Math.sin(dLon / 2);
  var h =
    sinLat * sinLat +
    Math.cos((a[0] * Math.PI) / 180) *
      Math.cos((b[0] * Math.PI) / 180) *
      sinLon *
      sinLon;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Accumulate a polyline into shared segment counters.
 * Segments longer than mapPathMaxKm are skipped.
 */
export function addPathToSegments(
  latlngs,
  label,
  segCounts,
  segLatLng,
  segLabels,
  mapPathMaxKm,
) {
  if (latlngs.length < 2) return;
  for (var i = 0; i < latlngs.length - 1; i++) {
    var a = latlngs[i],
      b = latlngs[i + 1];
    if (haversineKm(a, b) > mapPathMaxKm) continue;
    var ka = a[0] + "," + a[1],
      kb = b[0] + "," + b[1];
    var key = ka < kb ? ka + "|" + kb : kb + "|" + ka;
    if (!segCounts[key]) {
      segCounts[key] = 0;
      segLatLng[key] = [a, b];
      segLabels[key] = [];
    }
    segCounts[key]++;
    if (segLabels[key].indexOf(label) === -1) segLabels[key].push(label);
  }
}

/**
 * Returns true if the given route involves the repeater identified by filterPk.
 * Uses prefix-match semantics (either key is a prefix of the other).
 */
export function pathInvolvesRepeater(destPubkey, routePath, filterPk) {
  if (!filterPk) return false;
  var fl = filterPk.toLowerCase();
  if (destPubkey) {
    var dl = destPubkey.toLowerCase();
    if (dl.startsWith(fl) || fl.startsWith(dl)) return true;
  }
  if (routePath) {
    var segs = routePath.replace(/\s/g, "").split(">");
    for (var i = 0; i < segs.length; i++) {
      var sl = segs[i].toLowerCase();
      if (sl.startsWith(fl) || fl.startsWith(sl)) return true;
    }
  }
  return false;
}

/**
 * Apply a CSS dash-flow animation to a Leaflet polyline element.
 */
export function applyLinkAnim(line) {
  var el = line.getElement ? line.getElement() : null;
  if (el) el.style.animation = "dash-flow 180s linear infinite";
}

/**
 * Offset a two-point polyline perpendicularly by offsetDeg degrees.
 * Used to separate overlapping link lines.
 */
export function perpOffset(pts, offsetDeg) {
  var lat1 = pts[0][0],
    lon1 = pts[0][1],
    lat2 = pts[1][0],
    lon2 = pts[1][1];
  var dlat = lat2 - lat1;
  var cosLat = Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
  var dlon = (lon2 - lon1) * cosLat;
  var len = Math.sqrt(dlat * dlat + dlon * dlon) || 1;
  var ox = (-dlon / len) * offsetDeg;
  var oy = ((dlat / len) * offsetDeg) / cosLat;
  return [
    [lat1 + ox, lon1 + oy],
    [lat2 + ox, lon2 + oy],
  ];
}

/**
 * Return a fill colour for a repeater marker based on its poll status.
 */
export function markerColor(r) {
  if (r.last_poll_ok === true) return "#4ade80";
  if (r.last_poll_ok === false) return "#f87171";
  const recentSec = 3600;
  if (r.last_seen_epoch && Date.now() / 1000 - r.last_seen_epoch < recentSec)
    return "#4ade80";
  return "#64748b";
}
