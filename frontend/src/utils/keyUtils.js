/**
 * Key matching utilities for MeshCore pubkey/prefix comparisons.
 *
 * Field semantics (from API):
 *   pubkey        - Full 32-char hex key (repeaters, advert_nodes)
 *   pubkey_prefix - 12-char prefix (contacts: uniquely identifies a node)
 *   pubkey_short  - node_id_chars length (2/4/6) prefix for display/routing
 *   pubkey_remote - 12-char prefix (neighbours pubkey_remote column)
 *   sender_pubkey - 12-char prefix (messages)
 *   Route/path segments - variable length (2, 4, or 6 chars) per node_id_chars setting
 *
 * Matching rule: two keys match if either is a case-insensitive prefix of the other.
 * When multiple candidates match, prefer the longest (most specific) match.
 */

/**
 * Returns true if key `a` and key `b` refer to the same node.
 * Either key may be a prefix of the other (case-insensitive).
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function keysMatch(a, b) {
  if (!a || !b) return false;
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  return al.startsWith(bl) || bl.startsWith(al);
}

/**
 * Truncate a pubkey to the configured display length.
 * @param {string} pubkey
 * @param {number} nodeIdChars - 2, 4, or 6
 * @returns {string}
 */
export function keyPrefix(pubkey, nodeIdChars) {
  if (!pubkey) return "";
  return pubkey.substring(0, nodeIdChars).toLowerCase();
}

/**
 * Find the best (longest key match) entry in a plain object map whose key
 * matches the given pubkey prefix.
 * @param {Object} map - key → value
 * @param {string} pubkeyPrefix
 * @returns {*} value or null
 */
export function findByKey(map, pubkeyPrefix) {
  if (!pubkeyPrefix || !map) return null;
  const p = pubkeyPrefix.toLowerCase();
  let bestKey = null;
  let bestLen = -1;
  for (const k of Object.keys(map)) {
    const kl = k.toLowerCase();
    if (kl.startsWith(p) || p.startsWith(kl)) {
      if (kl.length > bestLen) {
        bestLen = kl.length;
        bestKey = k;
      }
    }
  }
  return bestKey !== null ? map[bestKey] : null;
}

/**
 * Build a lookup map from an array of objects, indexed at multiple prefix
 * lengths (2, 4, 6 chars and full key) so that lookups work regardless of
 * the current node_id_chars setting.
 * @param {Array} items - array of objects with a `pubkey` or `pubkey_prefix` field
 * @param {string} keyField - field name to use as the key (default: "pubkey")
 * @returns {Object} map of lowercase prefix → item
 */
export function buildPrefixMap(items, keyField = "pubkey") {
  const map = {};
  for (const item of items) {
    const pk = item[keyField];
    if (!pk) continue;
    const pl = pk.toLowerCase();
    // Index at every supported prefix length and full key
    for (const len of [2, 4, 6, 12, pl.length]) {
      if (len <= pl.length) {
        const prefix = pl.substring(0, len);
        // Only set if not already set by a longer (more specific) key
        if (!map[prefix]) map[prefix] = item;
      }
    }
  }
  return map;
}
