import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useLayoutEffect,
} from "preact/hooks";
import styles from "./MapPage.module.css";

const NODE_PALETTE = [
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#84cc16",
  "#f97316",
  "#a78bfa",
  "#34d399",
  "#fb923c",
  "#60a5fa",
];

function markerColor(r) {
  if (r.last_poll_ok === true) return "#4ade80";
  if (r.last_poll_ok === false) return "#f87171";
  const recentSec = 3600;
  if (r.last_seen_epoch && Date.now() / 1000 - r.last_seen_epoch < recentSec)
    return "#4ade80";
  return "#64748b";
}

function haversineKm(a, b) {
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

function addPathToSegments(
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

function pathInvolvesRepeater(destPubkey, routePath, filterPk) {
  var fp = filterPk.substring(0, 2).toLowerCase();
  if (destPubkey && destPubkey.substring(0, 2).toLowerCase() === fp)
    return true;
  if (routePath) {
    var segs = routePath.replace(/\s/g, "").split(">");
    for (var i = 0; i < segs.length; i++) {
      if (segs[i].toLowerCase() === fp) return true;
    }
  }
  return false;
}

function applyLinkAnim(line) {
  var el = line.getElement ? line.getElement() : null;
  if (el) el.style.animation = "dash-flow 180s linear infinite";
}

function perpOffset(pts, offsetDeg) {
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

export default function MapPage() {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);

  const [pickingHome, setPickingHome] = useState(false);
  const [showingAllContacts, setShowingAllContacts] = useState(false);
  const [showingPaths, setShowingPaths] = useState(false);
  const [showingMsgPaths, setShowingMsgPaths] = useState(false);
  const [showingNeighbourLinks, setShowingNeighbourLinks] = useState(false);
  const [neighbourRenderTrigger, setNeighbourRenderTrigger] = useState(0);
  const [legendOpen, setLegendOpen] = useState(true);

  const markersRef = useRef({});
  const linkLinesRef = useRef({});
  const homeMarkerRef = useRef(null);
  const lastMapDataRef = useRef(null);
  const pubkeyMapRef = useRef({});
  const didInitialFitRef = useRef(false);
  const nodeColorsRef = useRef({});
  const mapNodeNamesRef = useRef({});

  const adjacencyRef = useRef({});
  const nodeNameMapRef = useRef({});
  const contactMapRef = useRef({});
  const allContactsDataRef = useRef([]);
  const allNodeLatLngRef = useRef({});

  const mapPathMaxKmRef = useRef(300);
  const nodeIdCharsRef = useRef(2);
  const highlightedRepeaterRef = useRef(null);
  const pathsStateBeforeHighlightRef = useRef(false);

  const contactsLayerRef = useRef(null);
  const advertLayerRef = useRef(null);
  const pathsLayerRef = useRef(null);
  const msgPathsLayerRef = useRef(null);
  const neighbourLinksLayerRef = useRef(null);

  const loadNodeNames = useCallback(() => {
    fetch("/api/node-names")
      .then((r) => r.json())
      .then((d) => {
        mapNodeNamesRef.current = d || {};
      })
      .catch(() => {});
  }, []);

  const buildAdjacency = useCallback((repeaters, home) => {
    const adjacency = {};
    const nodeNameMap = {};
    const homePk = "__home__";
    if (home && home.name) nodeNameMap[homePk] = home.name;
    repeaters.forEach((r) => {
      if (r.pubkey) nodeNameMap[r.pubkey] = r.name;
    });
    Object.keys(contactMapRef.current).forEach((prefix) => {
      const c = contactMapRef.current[prefix];
      if (c.pubkey) nodeNameMap[c.pubkey] = c.name;
    });

    function addEdge(a, b) {
      if (!adjacency[a]) adjacency[a] = [];
      if (!adjacency[a].includes(b)) adjacency[a].push(b);
      if (!adjacency[b]) adjacency[b] = [];
      if (!adjacency[b].includes(a)) adjacency[b].push(a);
    }

    function buildChain(pubkey, route_path) {
      const chain = [homePk];
      if (route_path) {
        route_path
          .replace(/\s/g, "")
          .split(">")
          .forEach((seg) => {
            const segLower = seg.toLowerCase();
            const intermediate = pubkeyMapRef.current[segLower];
            if (intermediate && intermediate.pubkey !== pubkey) {
              chain.push(intermediate.pubkey);
            } else if (!intermediate) {
              const unk = contactMapRef.current[segLower];
              if (unk && unk.pubkey && unk.pubkey !== pubkey)
                chain.push(unk.pubkey);
            }
          });
      }
      chain.push(pubkey);
      for (let i = 0; i < chain.length - 1; i++)
        addEdge(chain[i], chain[i + 1]);
    }

    repeaters.forEach((r) => {
      if (r.pubkey) buildChain(r.pubkey, r.route_path);
    });
    Object.keys(contactMapRef.current).forEach((prefix) => {
      const c = contactMapRef.current[prefix];
      if (c.pubkey) buildChain(c.pubkey, c.route_path);
    });

    adjacencyRef.current = adjacency;
    nodeNameMapRef.current = nodeNameMap;
  }, []);

  const renderPathsLayer = useCallback(() => {
    if (!pathsLayerRef.current) return;
    pathsLayerRef.current.clearLayers();
    fetch("/api/contact-routes")
      .then((r) => r.json())
      .then((routes) => {
        const homeNode = allNodeLatLngRef.current["__home__"];
        const filterPk = highlightedRepeaterRef.current;
        const segCounts = {};
        const segLatLng = {};
        const segLabels = {};
        const myPrefixes = {};

        const mapData = lastMapDataRef.current;
        if (mapData) {
          (mapData.repeaters || []).forEach((r) => {
            if (r.pubkey && r.pubkey.length >= 2)
              myPrefixes[r.pubkey.substring(0, 2).toLowerCase()] = true;
          });

          (mapData.repeaters || []).forEach((r) => {
            if (!r.lat || !r.lon) return;
            var rHops = r.hops >= 0 ? r.hops : 0;
            if (rHops > 0 && !r.route_path) return;
            if (
              filterPk &&
              !pathInvolvesRepeater(r.pubkey, r.route_path || "", filterPk)
            )
              return;
            var latlngs = [];
            if (homeNode) latlngs.push([homeNode.lat, homeNode.lon]);
            if (r.route_path) {
              r.route_path
                .replace(/\s/g, "")
                .split(">")
                .forEach((seg) => {
                  var node =
                    allNodeLatLngRef.current[
                      seg.substring(0, nodeIdCharsRef.current).toLowerCase()
                    ] ||
                    allNodeLatLngRef.current[seg.substring(0, 2).toLowerCase()];
                  if (node) latlngs.push([node.lat, node.lon]);
                });
            }
            latlngs.push([r.lat, r.lon]);
            if (rHops > 0 && latlngs.length < 3) return;
            addPathToSegments(
              latlngs,
              r.name + " (" + rHops + " hop" + (rHops !== 1 ? "s" : "") + ")",
              segCounts,
              segLatLng,
              segLabels,
              mapPathMaxKmRef.current,
            );
          });
        }

        Object.keys(routes).forEach((prefix) => {
          var entry = routes[prefix];
          var preN = prefix.substring(0, nodeIdCharsRef.current).toLowerCase();
          var pre2 = prefix.substring(0, 2).toLowerCase();
          if (myPrefixes[pre2]) return;
          var dest =
            allNodeLatLngRef.current[preN] || allNodeLatLngRef.current[pre2];
          if (!dest) return;
          if (
            filterPk &&
            !pathInvolvesRepeater(prefix, entry.path || "", filterPk)
          )
            return;

          var latlngs = [];
          if (homeNode) latlngs.push([homeNode.lat, homeNode.lon]);

          var pathStr = entry.path || "";
          if (pathStr) {
            pathStr
              .replace(/\s/g, "")
              .split(">")
              .forEach((seg) => {
                var node =
                  allNodeLatLngRef.current[
                    seg.substring(0, nodeIdCharsRef.current).toLowerCase()
                  ] ||
                  allNodeLatLngRef.current[seg.substring(0, 2).toLowerCase()];
                if (node) latlngs.push([node.lat, node.lon]);
              });
          }
          latlngs.push([dest.lat, dest.lon]);
          var hops = entry.hops >= 0 ? entry.hops : 0;
          if (hops > 0 && latlngs.length < 3) return;
          if (latlngs.length < 2) return;

          var nodeName = dest.name || prefix.substring(0, 2).toUpperCase();
          var label =
            nodeName + " (" + hops + " hop" + (hops !== 1 ? "s" : "") + ")";
          addPathToSegments(
            latlngs,
            label,
            segCounts,
            segLatLng,
            segLabels,
            mapPathMaxKmRef.current,
          );
        });

        Object.keys(segCounts).forEach((key) => {
          var count = segCounts[key];
          var latlngs = segLatLng[key];
          var color = count > 1 ? "#f59e0b" : "#34d399";
          var tip = segLabels[key].join(", ");
          var line = window.L.polyline(latlngs, {
            color: color,
            weight: 2,
            opacity: 0.75,
            dashArray: count > 1 ? null : "6 4",
          });
          line.bindTooltip(
            count + " path" + (count !== 1 ? "s" : "") + ": " + tip,
            { sticky: true, className: "map-label" },
          );
          pathsLayerRef.current.addLayer(line);
        });
      })
      .catch(() => {});
  }, []);

  const renderMsgPathsLayer = useCallback(() => {
    if (!msgPathsLayerRef.current) return;
    msgPathsLayerRef.current.clearLayers();
    fetch("/api/message-paths")
      .then((r) => r.json())
      .then((msgs) => {
        var homeNode = allNodeLatLngRef.current["__home__"];
        var segCounts = {};
        var segLatLng = {};
        var segLabels = {};

        msgs.forEach((m) => {
          var pre2 = (m.sender_pubkey || "").substring(0, 2).toLowerCase();
          var preN = (m.sender_pubkey || "")
            .substring(0, nodeIdCharsRef.current)
            .toLowerCase();
          var sender =
            allNodeLatLngRef.current[preN] || allNodeLatLngRef.current[pre2];
          if (!sender) return;

          var latlngs = [[sender.lat, sender.lon]];
          if (m.path) {
            m.path
              .replace(/\s/g, "")
              .split(">")
              .forEach((seg) => {
                var node =
                  allNodeLatLngRef.current[
                    seg.substring(0, nodeIdCharsRef.current).toLowerCase()
                  ] ||
                  allNodeLatLngRef.current[seg.substring(0, 2).toLowerCase()];
                if (node) latlngs.push([node.lat, node.lon]);
              });
          }
          if (homeNode) latlngs.push([homeNode.lat, homeNode.lon]);
          if (latlngs.length < 2) return;

          var hops = m.hops >= 0 ? m.hops : "?";
          var label =
            (m.sender_name || pre2) +
            " (" +
            hops +
            (hops !== "?" ? " hop" + (hops !== 1 ? "s" : "") : "") +
            ")";
          addPathToSegments(
            latlngs,
            label,
            segCounts,
            segLatLng,
            segLabels,
            mapPathMaxKmRef.current,
          );
        });

        Object.keys(segCounts).forEach((key) => {
          var count = segCounts[key];
          var tip = segLabels[key].join(", ");
          var line = window.L.polyline(segLatLng[key], {
            color: "#a78bfa",
            weight: 2,
            opacity: 0.75,
            dashArray: count > 1 ? null : "6 4",
          });
          line.bindTooltip(
            count + " message" + (count !== 1 ? "s" : "") + ": " + tip,
            { sticky: true, className: "map-label" },
          );
          msgPathsLayerRef.current.addLayer(line);
        });
      })
      .catch(() => {});
  }, []);

  const isLinkedToMyRepeaters = useCallback((pubkey) => {
    var neighbours = adjacencyRef.current[pubkey] || [];
    for (var i = 0; i < neighbours.length; i++) {
      if (markersRef.current[neighbours[i]]) return true;
    }
    return false;
  }, []);

  const clearPathHighlight = useCallback(() => {
    highlightedRepeaterRef.current = null;
    setShowingPaths(pathsStateBeforeHighlightRef.current);
    if (pathsStateBeforeHighlightRef.current) {
      renderPathsLayer();
    } else {
      if (pathsLayerRef.current) pathsLayerRef.current.clearLayers();
    }
    setNeighbourRenderTrigger((prev) => prev + 1);
  }, [renderPathsLayer]);

  const renderContactsLayer = useCallback(() => {
    if (!contactsLayerRef.current) return;
    contactsLayerRef.current.clearLayers();
    allContactsDataRef.current.forEach((c) => {
      if (c.configured) return;
      if (!c.lat || !c.lon) return;
      var latlng = [c.lat, c.lon];
      var prefix2 = c.pubkey ? c.pubkey.substring(0, 2).toUpperCase() : "";
      var isKnown = !!(prefix2 && mapNodeNamesRef.current[prefix2]);

      var ringColor = "#22d3ee";
      var fillColor = "#0c4a6e";
      var dashArray = "2, 2";

      var lastHeardStr = "—";
      if (c.last_seen) {
        var ageSec = Date.now() / 1000 - c.last_seen;
        if (ageSec < 60) lastHeardStr = Math.round(ageSec) + "s ago";
        else if (ageSec < 3600)
          lastHeardStr = Math.round(ageSec / 60) + "m ago";
        else if (ageSec < 86400)
          lastHeardStr = Math.round(ageSec / 3600) + "h ago";
        else lastHeardStr = new Date(c.last_seen * 1000).toLocaleDateString();
      }
      var hopsStr =
        c.hops < 0
          ? "—"
          : c.hops === 0
            ? "Direct"
            : c.hops + " hop" + (c.hops !== 1 ? "s" : "");
      var routeStr = c.route_path || "";
      var popupContent =
        '<div class="popup-name">' +
        (c.name || c.pubkey.substring(0, 8)) +
        "</div>" +
        '<div class="popup-row"><span class="popup-label">Last heard</span><span class="popup-val">' +
        lastHeardStr +
        "</span></div>" +
        '<div class="popup-row"><span class="popup-label">Hops</span><span class="popup-val">' +
        hopsStr +
        "</span></div>" +
        (routeStr
          ? '<div class="popup-row"><span class="popup-label">Path</span><span class="popup-val" style="font-size:0.78rem;font-family:monospace">' +
            routeStr +
            "</span></div>"
          : "") +
        '<div class="popup-row"><span class="popup-label">ID</span><span class="popup-val" style="font-family:monospace;font-size:0.72rem">' +
        c.pubkey.substring(0, 12) +
        "…</span></div>" +
        (isKnown
          ? '<div style="color:#22d3ee;font-size:0.7rem;margin-top:0.2rem">★ Known node</div>'
          : "");

      var cm = window.L.circleMarker(latlng, {
        radius: 7,
        color: ringColor,
        weight: 2,
        fillColor: fillColor,
        fillOpacity: 0.75,
        opacity: 0.9,
        dashArray: dashArray,
      })
        .bindPopup(popupContent)
        .addTo(contactsLayerRef.current)
        .on(
          "click",
          ((pk) => {
            return function (e) {
              window.L.DomEvent.stopPropagation(e);
              if (highlightedRepeaterRef.current === pk) {
                clearPathHighlight();
              } else {
                setShowingPaths((prev) => {
                  pathsStateBeforeHighlightRef.current = prev;
                  return true;
                });
                highlightedRepeaterRef.current = pk;
                renderPathsLayer();
                setNeighbourRenderTrigger((prev) => prev + 1);
              }
            };
          })(c.pubkey),
        );

      cm.bindTooltip(c.name || c.pubkey.substring(0, 8), {
        permanent: true,
        direction: "top",
        className: "map-label",
        offset: [0, -10],
      });
    });
  }, [isLinkedToMyRepeaters, clearPathHighlight, renderPathsLayer]);

  const renderNeighbourLinksLayer = useCallback(() => {
    if (!neighbourLinksLayerRef.current) return;
    neighbourLinksLayerRef.current.clearLayers();
    fetch("/api/neighbours")
      .then((r) => r.json())
      .then((neighbours) => {
        if (!neighbours || !neighbours.length) return;
        var fullPkLookup = {};
        const mapData = lastMapDataRef.current;
        if (mapData && mapData.home && mapData.home.lat && mapData.home.lon) {
          var h = mapData.home;
          if (h.pubkey)
            fullPkLookup[h.pubkey.toLowerCase()] = {
              lat: h.lat,
              lon: h.lon,
              name: h.name || "Gateway",
            };
        }
        if (mapData) {
          (mapData.repeaters || []).forEach((r) => {
            if (r.pubkey && r.lat && r.lon)
              fullPkLookup[r.pubkey.toLowerCase()] = {
                lat: r.lat,
                lon: r.lon,
                name: r.name,
              };
          });
          (mapData.contacts || []).forEach((c) => {
            if (c.pubkey && c.lat && c.lon)
              fullPkLookup[c.pubkey.toLowerCase()] = {
                lat: c.lat,
                lon: c.lon,
                name: c.name || c.pubkey.substring(0, 8),
              };
          });
          (mapData.advert_nodes || []).forEach((n) => {
            if (n.pubkey && n.lat && n.lon)
              fullPkLookup[n.pubkey.toLowerCase()] = {
                lat: n.lat,
                lon: n.lon,
                name: n.name,
              };
          });
        }

        function resolveNode(pk) {
          if (!pk) return null;
          var pkLower = pk.toLowerCase();
          if (fullPkLookup[pkLower]) return fullPkLookup[pkLower];
          var keys = Object.keys(fullPkLookup);
          for (var i = 0; i < keys.length; i++) {
            if (keys[i].startsWith(pkLower) || pkLower.startsWith(keys[i])) {
              return fullPkLookup[keys[i]];
            }
          }
          return null;
        }

        var pairs = {};

        var filterPk = highlightedRepeaterRef.current;

        neighbours.forEach((nb) => {
          if (filterPk) {
            var fp = filterPk.toLowerCase();
            var p1 = nb.pubkey.toLowerCase();
            var p2 = nb.pubkey_remote.toLowerCase();
            if (
              !p1.startsWith(fp) &&
              !fp.startsWith(p1) &&
              !p2.startsWith(fp) &&
              !fp.startsWith(p2)
            ) {
              return;
            }
          }

          var listenerNode = resolveNode(nb.pubkey);
          var transmitterNode = resolveNode(nb.pubkey_remote);
          if (!listenerNode || !transmitterNode) return;

          var pkListenerShort = nb.pubkey.toLowerCase().substring(0, 8);
          var pkTransmitterShort = nb.pubkey_remote
            .toLowerCase()
            .substring(0, 8);
          var pkA =
            pkListenerShort < pkTransmitterShort
              ? pkListenerShort
              : pkTransmitterShort;
          var pkB =
            pkListenerShort < pkTransmitterShort
              ? pkTransmitterShort
              : pkListenerShort;
          var pairKey = pkA + "||" + pkB;

          if (!pairs[pairKey]) {
            var nodeA =
              pkListenerShort < pkTransmitterShort
                ? listenerNode
                : transmitterNode;
            var nodeB =
              pkListenerShort < pkTransmitterShort
                ? transmitterNode
                : listenerNode;
            pairs[pairKey] = {
              nodeA: nodeA,
              nodeB: nodeB,
              pkA: pkA,
              pkB: pkB,
              snrListener_pkA: null,
              snrListener_pkB: null,
            };
          }

          if (pkListenerShort === pkA) {
            pairs[pairKey].snrListener_pkA = nb.snr;
          } else {
            pairs[pairKey].snrListener_pkB = nb.snr;
          }
        });

        Object.keys(pairs).forEach((key) => {
          var p = pairs[key];
          var ptA = [p.nodeA.lat, p.nodeA.lon];
          var ptB = [p.nodeB.lat, p.nodeB.lon];
          var nameA = p.nodeA.name || p.pkA;
          var nameB = p.nodeB.name || p.pkB;

          var lines = [];
          if (p.snrListener_pkA !== null)
            lines.push(
              nameB +
                " \u2192 " +
                nameA +
                ": " +
                p.snrListener_pkA.toFixed(1) +
                " dB",
            );
          if (p.snrListener_pkB !== null)
            lines.push(
              nameA +
                " \u2192 " +
                nameB +
                ": " +
                p.snrListener_pkB.toFixed(1) +
                " dB",
            );
          var labelHtml = lines.join("<br>");

          window.L.polyline([ptA, ptB], {
            color: "#22d3ee",
            weight: 2,
            opacity: 0.65,
            interactive: false,
          }).addTo(neighbourLinksLayerRef.current);

          var midLat = (ptA[0] + ptB[0]) / 2;
          var midLon = (ptA[1] + ptB[1]) / 2;
          window.L.tooltip({
            permanent: true,
            direction: "top",
            className: "snr-label",
            offset: [0, -6],
            interactive: false,
          })
            .setContent(labelHtml)
            .setLatLng([midLat, midLon])
            .addTo(neighbourLinksLayerRef.current);
        });
      })
      .catch(() => {});
  }, []);

  const rebuildAllNodeLatLng = useCallback((data) => {
    const newLatLng = {};
    var home = data.home || {};
    if (home.lat && home.lon) {
      newLatLng["__home__"] = {
        lat: home.lat,
        lon: home.lon,
        name: home.name || "Gateway",
      };
    }
    function indexNode(pubkey, lat, lon, name) {
      var p2 = pubkey.substring(0, 2).toLowerCase();
      var pN = pubkey.substring(0, nodeIdCharsRef.current).toLowerCase();
      var entry = { lat: lat, lon: lon, name: name || p2 };
      newLatLng[p2] = entry;
      if (pN !== p2) newLatLng[pN] = entry;
    }
    (data.repeaters || []).forEach((r) => {
      if (!r.lat || !r.lon || !r.pubkey) return;
      indexNode(r.pubkey, r.lat, r.lon, r.name);
    });
    (data.contacts || []).forEach((c) => {
      if (!c.lat || !c.lon || !c.pubkey) return;
      var p2 = c.pubkey.substring(0, 2).toLowerCase();
      if (!newLatLng[p2]) indexNode(c.pubkey, c.lat, c.lon, c.name);
    });
    (data.advert_nodes || []).forEach((n) => {
      if (!n.lat || !n.lon || !n.pubkey) return;
      var p2 = n.pubkey.substring(0, 2).toLowerCase();
      if (!newLatLng[p2]) indexNode(n.pubkey, n.lat, n.lon, n.name);
    });
    allNodeLatLngRef.current = newLatLng;
  }, []);

  const renderMap = useCallback(
    (data) => {
      lastMapDataRef.current = data;
      const home = data.home || {};
      const repeaters = data.repeaters || [];
      const bounds = [];

      pubkeyMapRef.current = {};
      repeaters.forEach((r, idx) => {
        if (r.pubkey && r.pubkey.length >= 2)
          pubkeyMapRef.current[r.pubkey.substring(0, 2).toLowerCase()] = r;
        if (r.pubkey && r.pubkey.length >= 4)
          pubkeyMapRef.current[r.pubkey.substring(0, 4).toLowerCase()] = r;
        if (!nodeColorsRef.current[r.pubkey])
          nodeColorsRef.current[r.pubkey] =
            NODE_PALETTE[idx % NODE_PALETTE.length];
      });

      allContactsDataRef.current = data.contacts || [];

      contactMapRef.current = {};
      allContactsDataRef.current.forEach((c) => {
        if (c.configured) return;
        if (!c.pubkey || c.pubkey.length < 2) return;
        contactMapRef.current[c.pubkey.substring(0, 2).toLowerCase()] = c;
        if (c.pubkey.length >= 4)
          contactMapRef.current[c.pubkey.substring(0, 4).toLowerCase()] = c;
      });

      buildAdjacency(repeaters, home);

      if (home.lat && home.lon) {
        const homeLatLng = [home.lat, home.lon];
        bounds.push(homeLatLng);
        if (!homeMarkerRef.current) {
          homeMarkerRef.current = window.L.circleMarker(homeLatLng, {
            radius: 10,
            fillColor: "#38bdf8",
            color: "#0ea5e9",
            weight: 2,
            opacity: 1,
            fillOpacity: 0.9,
          })
            .addTo(mapRef.current)
            .bindTooltip(home.name || "Gateway", {
              permanent: true,
              direction: "top",
              className: "map-label",
              offset: [0, -10],
            });
        } else {
          homeMarkerRef.current.setLatLng(homeLatLng);
        }
      }

      const seenKeys = {};
      repeaters.forEach((r) => {
        if (!r.lat || !r.lon) return;
        seenKeys[r.pubkey] = true;
        const latlng = [r.lat, r.lon];
        bounds.push(latlng);
        const statusColor = markerColor(r);
        const ringColor = nodeColorsRef.current[r.pubkey] || "#94a3b8";

        if (markersRef.current[r.pubkey]) {
          markersRef.current[r.pubkey].setLatLng(latlng);
          markersRef.current[r.pubkey].setStyle({
            fillColor: statusColor,
            color: ringColor,
          });
        } else {
          markersRef.current[r.pubkey] = window.L.circleMarker(latlng, {
            radius: 9,
            fillColor: statusColor,
            color: ringColor,
            weight: 3,
            opacity: 1,
            fillOpacity: 0.9,
          })
            .addTo(mapRef.current)
            .bindTooltip(r.name, {
              permanent: true,
              direction: "top",
              className: "map-label",
              offset: [0, -12],
            })
            .on("click", (e) => {
              window.L.DomEvent.stopPropagation(e);
              if (highlightedRepeaterRef.current === r.pubkey) {
                clearPathHighlight();
              } else {
                setShowingPaths((prev) => {
                  pathsStateBeforeHighlightRef.current = prev;
                  return true;
                });
                highlightedRepeaterRef.current = r.pubkey;
                renderPathsLayer();
                setNeighbourRenderTrigger((prev) => prev + 1);
              }
            });
        }
      });

      Object.keys(markersRef.current).forEach((pk) => {
        if (!seenKeys[pk]) {
          mapRef.current.removeLayer(markersRef.current[pk]);
          delete markersRef.current[pk];
        }
      });

      rebuildAllNodeLatLng(data);

      // We rely on effects or manual calls to update layers.
      // It's safer to re-render these via state effects, but since data updated we can just force render if active.
      setShowingPaths((prev) => {
        if (prev) setTimeout(renderPathsLayer, 0);
        return prev;
      });
      setShowingMsgPaths((prev) => {
        if (prev) setTimeout(renderMsgPathsLayer, 0);
        return prev;
      });
      setShowingNeighbourLinks((prev) => {
        if (prev) setTimeout(renderNeighbourLinksLayer, 0);
        return prev;
      });
      setShowingAllContacts((prev) => {
        if (prev) setTimeout(renderContactsLayer, 0);
        return prev;
      });

      var nodeLatLng = {};
      if (home.lat && home.lon) nodeLatLng["__home__"] = [home.lat, home.lon];
      repeaters.forEach((r) => {
        if (r.lat && r.lon) nodeLatLng[r.pubkey] = [r.lat, r.lon];
      });

      var newLinks = {};
      repeaters.forEach((r) => {
        if (!r.lat || !r.lon) return;
        var nodeColor = nodeColorsRef.current[r.pubkey] || "#94a3b8";
        var chain = ["__home__"];
        if (r.route_path && r.hops > 0) {
          var segments = r.route_path.replace(/\s/g, "").split(">");
          segments.forEach((seg) => {
            var intermediate = pubkeyMapRef.current[seg.toLowerCase()];
            if (intermediate && intermediate.pubkey !== r.pubkey) {
              chain.push(intermediate.pubkey);
            }
          });
        }
        chain.push(r.pubkey);
        for (var i = 0; i < chain.length - 1; i++) {
          var a = chain[i],
            b = chain[i + 1];
          var key = a < b ? a + "|" + b : b + "|" + a;
          if (nodeLatLng[a] && nodeLatLng[b]) {
            if (!newLinks[key]) newLinks[key] = [];
            newLinks[key].push({
              pts: [nodeLatLng[b], nodeLatLng[a]],
              color: nodeColor,
            });
          }
        }
      });

      Object.keys(linkLinesRef.current).forEach((key) => {
        if (!newLinks[key]) {
          linkLinesRef.current[key].forEach((line) => {
            mapRef.current.removeLayer(line);
          });
          delete linkLinesRef.current[key];
        }
      });

      var OFFSET = 0.00025;
      Object.keys(newLinks).forEach((key) => {
        var lkArr = newLinks[key];
        var n = lkArr.length;
        if (!linkLinesRef.current[key]) linkLinesRef.current[key] = [];
        var oldArr = linkLinesRef.current[key];
        while (oldArr.length > n) {
          mapRef.current.removeLayer(oldArr.pop());
        }
        lkArr.forEach((lk, i) => {
          var offset = (i - (n - 1) / 2) * OFFSET;
          var pts = n > 1 ? perpOffset(lk.pts, offset) : lk.pts;
          if (oldArr[i]) {
            oldArr[i].setLatLngs(pts);
            oldArr[i].setStyle({ color: lk.color });
          } else {
            var line = window.L.polyline(pts, {
              color: lk.color,
              weight: 2,
              opacity: 0.7,
              dashArray: "10, 8",
            }).addTo(mapRef.current);
            applyLinkAnim(line);
            oldArr.push(line);
          }
        });
      });

      if (bounds.length > 0 && !didInitialFitRef.current) {
        didInitialFitRef.current = true;
        try {
          mapRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
        } catch (e) {}
      }
    },
    [
      buildAdjacency,
      rebuildAllNodeLatLng,
      clearPathHighlight,
      renderPathsLayer,
      renderMsgPathsLayer,
      renderNeighbourLinksLayer,
      renderContactsLayer,
    ],
  );

  const loadMap = useCallback(() => {
    fetch("/api/map")
      .then((r) => r.json())
      .then((data) => {
        if (JSON.stringify(lastMapDataRef.current) != JSON.stringify(data)) {
          renderMap(data);
        }
      })
      .catch(() => {});
  }, [renderMap]);

  // Start legend minimised on small screens
  useLayoutEffect(() => {
    if (window.innerWidth < 768) {
      setLegendOpen(false);
    }
  }, []);

  useEffect(() => {
    if (!window.L || !mapContainerRef.current) return;

    if (!mapRef.current) {
      mapRef.current = window.L.map(mapContainerRef.current, {
        zoomControl: false,
      }).setView([-41.0, 174.0], 6);

      window.L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        {
          attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
          subdomains: "abcd",
          maxZoom: 19,
        },
      ).addTo(mapRef.current);

      contactsLayerRef.current = window.L.layerGroup().addTo(mapRef.current);
      advertLayerRef.current = window.L.layerGroup().addTo(mapRef.current);
      pathsLayerRef.current = window.L.layerGroup().addTo(mapRef.current);
      msgPathsLayerRef.current = window.L.layerGroup().addTo(mapRef.current);
      neighbourLinksLayerRef.current = window.L.layerGroup().addTo(
        mapRef.current,
      );

      setTimeout(() => mapRef.current.invalidateSize(), 100);
    }

    const onMapClick = (e) => {
      if (!pickingHome) {
        if (highlightedRepeaterRef.current) clearPathHighlight();
        return;
      }
      var lat = e.latlng.lat;
      var lon = e.latlng.lng;
      fetch("/api/home", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: lat, lon: lon }),
      })
        .then((r) => r.json())
        .then((result) => {
          if (result.ok) {
            setPickingHome(false);
            loadMap();
          }
        })
        .catch(() => {});
    };

    mapRef.current.on("click", onMapClick);

    return () => {
      if (mapRef.current) {
        mapRef.current.off("click", onMapClick);
      }
    };
  }, [pickingHome, clearPathHighlight, loadMap]);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((s) => {
        if (s.map_path_max_km) mapPathMaxKmRef.current = s.map_path_max_km;
        if (s.node_id_chars) nodeIdCharsRef.current = s.node_id_chars;
      })
      .catch(() => {})
      .finally(() => {
        loadNodeNames();
        loadMap();
      });

    const mapInterval = setInterval(loadMap, 10000);
    const nodeInterval = setInterval(loadNodeNames, 30000);

    return () => {
      clearInterval(mapInterval);
      clearInterval(nodeInterval);
      // We do not destroy the map here because it's persistent until unmount,
      // but if the component completely unmounts, mapRef.current might be handled separately or here.
      // Usually better to let Leaflet destroy it on full unmount:
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [loadNodeNames, loadMap]);

  useEffect(() => {
    if (showingPaths) renderPathsLayer();
    else if (pathsLayerRef.current) pathsLayerRef.current.clearLayers();
  }, [showingPaths, renderPathsLayer]);

  useEffect(() => {
    if (showingMsgPaths) renderMsgPathsLayer();
    else if (msgPathsLayerRef.current) msgPathsLayerRef.current.clearLayers();
  }, [showingMsgPaths, renderMsgPathsLayer]);

  useEffect(() => {
    if (showingNeighbourLinks) renderNeighbourLinksLayer();
    else if (neighbourLinksLayerRef.current)
      neighbourLinksLayerRef.current.clearLayers();
  }, [
    showingNeighbourLinks,
    neighbourRenderTrigger,
    renderNeighbourLinksLayer,
  ]);

  useEffect(() => {
    if (showingAllContacts) renderContactsLayer();
    else if (contactsLayerRef.current) contactsLayerRef.current.clearLayers();
  }, [showingAllContacts, renderContactsLayer]);

  const togglePaths = () => {
    highlightedRepeaterRef.current = null;
    setShowingPaths((prev) => !prev);
  };

  return (
    <div className={styles.mapWrap}>
      <div className={styles.mapBody}>
        <div
          ref={mapContainerRef}
          id="leaflet-map"
          className={`${styles.leafletMap} ${pickingHome ? "map-picking" : ""}`}
        ></div>

        <div className={styles.mapLegend}>
          <div
            className={styles.legendHeader}
            onClick={() => setLegendOpen((p) => !p)}
          >
            <span>Legend</span>
            <span className={styles.legendToggle}>
              {legendOpen ? "▼" : "▲"}
            </span>
          </div>
          {legendOpen && (
            <div className={styles.legendContent}>
              <div className={styles.legendRow}>
                <div className={`${styles.legendDot} ${styles.gateway}`}></div>{" "}
                Gateway
              </div>
              <div className={`${styles.legendRow} ${styles.legendSubtitle}`}>
                Node fill = status
              </div>
              <div className={styles.legendRow}>
                <div className={`${styles.legendDot} ${styles.online}`}></div>{" "}
                Online
              </div>
              <div className={styles.legendRow}>
                <div className={`${styles.legendDot} ${styles.offline}`}></div>{" "}
                Offline
              </div>
              <div className={styles.legendRow}>
                <div className={`${styles.legendDot} ${styles.unknown}`}></div>{" "}
                Not polled
              </div>
              <div className={`${styles.legendRow} ${styles.legendSubtitle}`}>
                Contacts (All mode)
              </div>
              <div className={styles.legendRow}>
                <div
                  className={`${styles.legendDot} ${styles.dotContact}`}
                ></div>{" "}
                Contact
              </div>
              <div className={styles.legendRow}>
                <div
                  className={`${styles.legendDot} ${styles.dotAdvert}`}
                ></div>{" "}
                Advert
              </div>
              <div className={`${styles.legendRow} ${styles.legendSubtitle}`}>
                Paths layer
              </div>
              <div className={styles.legendRow}>
                <div
                  className={`${styles.legendDot} ${styles.pathSingle}`}
                ></div>{" "}
                Single route
              </div>
              <div className={styles.legendRow}>
                <div
                  className={`${styles.legendDot} ${styles.pathShared}`}
                ></div>{" "}
                Shared segment
              </div>
              <div className={`${styles.legendRow} ${styles.legendSubtitle}`}>
                Msg paths layer
              </div>
              <div className={styles.legendRow}>
                <div className={`${styles.legendDot} ${styles.pathMsg}`}></div>{" "}
                Message path
              </div>
              <div className={`${styles.legendRow} ${styles.legendSubtitle}`}>
                Neighbours layer
              </div>
              <div className={styles.legendRow}>
                <div
                  className={`${styles.legendDot} ${styles.pathNeighbour}`}
                ></div>{" "}
                Neighbour link (SNR)
              </div>
            </div>
          )}
        </div>

        <div
          className={`${styles.mapBtnBar} ${!legendOpen ? styles.mapBtnBarSmallLegend : ""}`}
        >
          <button
            className={`${styles.mapBtn} ${styles.mapSetHomeBtn} ${pickingHome ? styles.picking : ""}`}
            onClick={() => setPickingHome((p) => !p)}
          >
            {pickingHome ? "\u2715 Cancel" : "\u8962 Set Home"}
          </button>
          <button
            className={`${styles.mapBtn} ${styles.mapContactsBtn} ${showingAllContacts ? styles.active : ""}`}
            onClick={() => setShowingAllContacts((p) => !p)}
          >
            &#9788; All Contacts
          </button>
          <button
            className={`${styles.mapBtn} ${styles.mapPathsBtn} ${showingPaths ? styles.active : ""}`}
            onClick={togglePaths}
          >
            &#8627; Paths
          </button>
          <button
            className={`${styles.mapBtn} ${styles.mapPathsBtn} ${showingMsgPaths ? styles.active : ""}`}
            onClick={() => setShowingMsgPaths((p) => !p)}
          >
            &#9993; Msg Paths
          </button>
          <button
            className={`${styles.mapBtn} ${styles.mapNeighboursBtn} ${showingNeighbourLinks ? styles.active : ""}`}
            onClick={() => {
              if (!showingNeighbourLinks && !showingAllContacts) {
                // Show contacts with neighbours so the lines have a destination.
                setShowingAllContacts(true);
              }
              setShowingNeighbourLinks((p) => !p);
            }}
          >
            &#8767; Neighbours
          </button>
          <button
            className={`${styles.mapBtn} ${styles.mapRefreshBtn}`}
            onClick={loadMap}
          >
            Refresh
          </button>
        </div>
      </div>
    </div>
  );
}
