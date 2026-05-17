import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useLayoutEffect,
} from "preact/hooks";
import styles from "./MapPage.module.css";
import { findByKey, buildPrefixMap, keysMatch } from "../utils/keyUtils";
import {
  markerColor,
  addPathToSegments,
  pathInvolvesRepeater,
  applyLinkAnim,
  perpOffset,
} from "../utils/mapUtils";
import MapLegend from "../components/map/MapLegend";
import MapControls from "../components/map/MapControls";

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

export default function MapPage() {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);

  // --- UI state ---
  const [pickingHome, setPickingHome] = useState(false);
  const [showingAllContacts, setShowingAllContacts] = useState(false);
  const [showingPaths, setShowingPaths] = useState(false);
  const [showingMsgPaths, setShowingMsgPaths] = useState(false);
  const [showingNeighbourLinks, setShowingNeighbourLinks] = useState(false);
  const [legendOpen, setLegendOpen] = useState(true);

  /**
   * highlightedPubkey: null = show all, string = scope layers to this node.
   * Clicking the same node again clears it. Clicking the map background clears it.
   * showingPaths / showingNeighbourLinks are independent — clicking a node never
   * forces them on or off.
   */
  const [highlightedPubkey, setHighlightedPubkey] = useState(null);

  // --- Map data refs (not state — don't need to trigger re-renders) ---
  const markersRef = useRef({});
  const linkLinesRef = useRef({});
  const homeMarkerRef = useRef(null);
  const lastMapDataRef = useRef(null);
  const pubkeyMapRef = useRef({});
  const didInitialFitRef = useRef(false);
  const nodeColorsRef = useRef({});
  const mapNodeNamesRef = useRef({});
  const contactMapRef = useRef({});
  const allContactsDataRef = useRef([]);
  const allNodeLatLngRef = useRef({});
  const mapPathMaxKmRef = useRef(300);

  // --- Layer refs ---
  const contactsLayerRef = useRef(null);
  const pathsLayerRef = useRef(null);
  const msgPathsLayerRef = useRef(null);
  const neighbourLinksLayerRef = useRef(null);

  // ─── Node names ────────────────────────────────────────────────────────────

  const loadNodeNames = useCallback(() => {
    fetch("/api/node-names")
      .then((r) => r.json())
      .then((d) => {
        mapNodeNamesRef.current = d || {};
      })
      .catch(() => {});
  }, []);

  // ─── Layer renderers ────────────────────────────────────────────────────────

  /**
   * Render the paths layer.
   * @param {string|null} filterPk - scope to this pubkey, or null for all.
   */
  const renderPathsLayer = useCallback((filterPk) => {
    if (!pathsLayerRef.current) return;
    pathsLayerRef.current.clearLayers();
    fetch("/api/contact-routes")
      .then((r) => r.json())
      .then((routes) => {
        const homeNode = allNodeLatLngRef.current["__home__"];
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
                  var node = findByKey(allNodeLatLngRef.current, seg);
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
          var pre2 = prefix.substring(0, 2).toLowerCase();
          if (myPrefixes[pre2]) return;
          var dest = findByKey(allNodeLatLngRef.current, prefix);
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
                var node = findByKey(allNodeLatLngRef.current, seg);
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

  /**
   * Render the message-paths layer (no filter — always shows all).
   */
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
          var sender = findByKey(
            allNodeLatLngRef.current,
            m.sender_pubkey || "",
          );
          if (!sender) return;

          var latlngs = [[sender.lat, sender.lon]];
          if (m.path) {
            m.path
              .replace(/\s/g, "")
              .split(">")
              .forEach((seg) => {
                var node = findByKey(allNodeLatLngRef.current, seg);
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

  /**
   * Render the contacts layer.
   * @param {string|null} filterPk - passed through to click handler context only.
   */
  const renderContactsLayer = useCallback(
    (filterPk) => {
      if (!contactsLayerRef.current) return;
      contactsLayerRef.current.clearLayers();
      allContactsDataRef.current.forEach((c) => {
        if (c.configured) return;
        if (!c.lat || !c.lon) return;
        var latlng = [c.lat, c.lon];
        var cpk = c.pubkey_prefix || c.pubkey || "";
        var isKnown = !!(cpk && findByKey(mapNodeNamesRef.current, cpk));

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
          (c.name || cpk.substring(0, 8)) +
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
          cpk.substring(0, 12) +
          "…</span></div>" +
          (isKnown
            ? '<div style="color:#22d3ee;font-size:0.7rem;margin-top:0.2rem">★ Known node</div>'
            : "");

        window.L.circleMarker(latlng, {
          radius: 7,
          color: "#22d3ee",
          weight: 2,
          fillColor: "#0c4a6e",
          fillOpacity: 0.75,
          opacity: 0.9,
          dashArray: "2, 2",
        })
          .bindPopup(popupContent)
          .addTo(contactsLayerRef.current)
          .on(
            "click",
            ((pk) => {
              return function (e) {
                window.L.DomEvent.stopPropagation(e);
                setHighlightedPubkey((prev) => (prev === pk ? null : pk));
              };
            })(cpk),
          )
          .bindTooltip(c.name || cpk.substring(0, 8), {
            permanent: true,
            direction: "top",
            className: "map-label",
            offset: [0, -10],
          });
      });
    },
    // filterPk is not used inside but contacts re-render when showingAllContacts changes
    [],
  );

  /**
   * Render the neighbour links layer.
   * @param {string|null} filterPk - scope to this pubkey, or null for all.
   */
  const renderNeighbourLinksLayer = useCallback((filterPk) => {
    if (!neighbourLinksLayerRef.current) return;
    neighbourLinksLayerRef.current.clearLayers();
    fetch("/api/neighbours")
      .then((r) => r.json())
      .then((neighbours) => {
        if (!neighbours || !neighbours.length) return;

        // Build a lookup of all known node positions
        var fullPkLookup = {};
        const mapData = lastMapDataRef.current;
        if (mapData) {
          for (const device_list of [
            [mapData.home],
            mapData.repeaters,
            mapData.contacts,
            mapData.advert_nodes,
          ]) {
            if (device_list) {
              device_list.forEach((c) => {
                if (c) {
                  var cpk = (c.pubkey || c.pubkey_prefix || "").toLowerCase();
                  if (cpk && c.lat && c.lon)
                    fullPkLookup[cpk] = {
                      pubkey: cpk,
                      lat: c.lat,
                      lon: c.lon,
                      name: c.name || cpk.substring(0, 8),
                    };
                }
              });
            }
          }
        }

        function resolveNode(pk) {
          if (!pk) return null;
          var pkLower = pk.toLowerCase();
          return fullPkLookup[pkLower] || findByKey(fullPkLookup, pkLower);
        }

        var pairs = {};

        neighbours.forEach((nb) => {
          if (
            filterPk &&
            !keysMatch(nb.pubkey, filterPk) &&
            !keysMatch(nb.pubkey_remote, filterPk)
          )
            return;

          var listenerNode = resolveNode(nb.pubkey);
          var transmitterNode = resolveNode(nb.pubkey_remote);
          if (!listenerNode || !transmitterNode) return;

          var pairKey = [
            nb.pubkey.slice(0, nb.pubkey_remote.length).toLowerCase(),
            nb.pubkey_remote.toLowerCase(),
          ]
            .sort()
            .join("||");

          // Values are from the perspective of the listener
          if (!(pairKey in pairs)) {
            pairs[pairKey] = {
              nodeTx: transmitterNode,
              nodeRx: listenerNode,
              snrToRx: nb.snr,
              snrFromRx: null,
            };
          } else {
            if (pairs[pairKey].nodeTx.pubkey === listenerNode.pubkey) {
              pairs[pairKey].snrFromRx = nb.snr;
            } else {
              pairs[pairKey].snrToRx = nb.snr;
            }
          }
        });

        Object.keys(pairs).forEach((key) => {
          var p = pairs[key];
          var ptTx = [p.nodeTx.lat, p.nodeTx.lon];
          var ptRx = [p.nodeRx.lat, p.nodeRx.lon];
          var nameTx = p.nodeTx.name || p.nodeTx.pubkey.substring(0, 12);
          var nameRx = p.nodeRx.name || p.nodeRx.pubkey.substring(0, 12);

          var lines = [];
          if (p.snrToRx !== null && (highlightedPubkey == null || highlightedPubkey === p.nodeRx.pubkey))
            lines.push(
              nameTx + " \u2192 " + nameRx + ": " + p.snrToRx.toFixed(1) + " dB",
            );
          if (p.snrFromRx !== null && (highlightedPubkey == null || highlightedPubkey === p.nodeTx.pubkey))
            lines.push(
              nameRx + " \u2192 " + nameTx + ": " + p.snrFromRx.toFixed(1) + " dB",
            );

          window.L.polyline([ptTx, ptRx], {
            color: "#22d3ee",
            weight: 2,
            opacity: 0.65,
            interactive: false,
          }).addTo(neighbourLinksLayerRef.current);

          window.L.tooltip({
            permanent: true,
            direction: "top",
            className: "snr-label",
            offset: [0, -6],
            interactive: false,
          })
            .setContent(lines.join("<br>"))
            .setLatLng([(ptTx[0] + ptRx[0]) / 2, (ptTx[1] + ptRx[1]) / 2])
            .addTo(neighbourLinksLayerRef.current);
        });
      })
      .catch(() => {});
  }, [highlightedPubkey]);

  // ─── Node lat/lng index ─────────────────────────────────────────────────────

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
      var pl = pubkey.toLowerCase();
      var entry = { lat: lat, lon: lon, name: name || pl.substring(0, 2) };
      for (var len of [2, 4, 6, 12]) {
        if (len <= pl.length) newLatLng[pl.substring(0, len)] = entry;
      }
      if (pl.length > 12) newLatLng[pl] = entry;
    }
    (data.repeaters || []).forEach((r) => {
      if (!r.lat || !r.lon || !r.pubkey) return;
      indexNode(r.pubkey, r.lat, r.lon, r.name);
    });
    (data.contacts || []).forEach((c) => {
      var pk = c.pubkey_prefix || c.pubkey;
      if (!c.lat || !c.lon || !pk) return;
      if (!findByKey(newLatLng, pk)) indexNode(pk, c.lat, c.lon, c.name);
    });
    (data.advert_nodes || []).forEach((n) => {
      if (!n.lat || !n.lon || !n.pubkey) return;
      if (!findByKey(newLatLng, n.pubkey))
        indexNode(n.pubkey, n.lat, n.lon, n.name);
    });
    allNodeLatLngRef.current = newLatLng;
  }, []);

  // ─── Main map render ────────────────────────────────────────────────────────

  const renderMap = useCallback(
    (data) => {
      lastMapDataRef.current = data;
      const home = data.home || {};
      const repeaters = data.repeaters || [];
      const bounds = [];

      repeaters.forEach((r, idx) => {
        if (!nodeColorsRef.current[r.pubkey])
          nodeColorsRef.current[r.pubkey] =
            NODE_PALETTE[idx % NODE_PALETTE.length];
      });
      pubkeyMapRef.current = buildPrefixMap(repeaters, "pubkey");

      allContactsDataRef.current = data.contacts || [];
      const unconfiguredContacts = allContactsDataRef.current
        .filter((c) => !c.configured)
        .map((c) => ({ ...c, pubkey: c.pubkey_prefix || c.pubkey }));
      contactMapRef.current = buildPrefixMap(unconfiguredContacts, "pubkey");

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
              // Toggle: clicking the same node clears the highlight
              setHighlightedPubkey((prev) =>
                prev === r.pubkey ? null : r.pubkey,
              );
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

      // Build animated link lines between home → intermediate → repeater
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
          r.route_path
            .replace(/\s/g, "")
            .split(">")
            .forEach((seg) => {
              var intermediate = findByKey(pubkeyMapRef.current, seg);
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
          linkLinesRef.current[key].forEach((line) =>
            mapRef.current.removeLayer(line),
          );
          delete linkLinesRef.current[key];
        }
      });

      var OFFSET = 0.00025;
      Object.keys(newLinks).forEach((key) => {
        var lkArr = newLinks[key];
        var n = lkArr.length;
        if (!linkLinesRef.current[key]) linkLinesRef.current[key] = [];
        var oldArr = linkLinesRef.current[key];
        while (oldArr.length > n) mapRef.current.removeLayer(oldArr.pop());
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
    [rebuildAllNodeLatLng],
  );

  const loadMap = useCallback(() => {
    fetch("/api/map")
      .then((r) => r.json())
      .then((data) => {
        if (JSON.stringify(lastMapDataRef.current) !== JSON.stringify(data)) {
          renderMap(data);
        }
      })
      .catch(() => {});
  }, [renderMap]);

  // ─── Effects ────────────────────────────────────────────────────────────────

  // Start legend minimised on small screens
  useLayoutEffect(() => {
    if (window.innerWidth < 768) setLegendOpen(false);
  }, []);

  // Initialise Leaflet map once
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
      pathsLayerRef.current = window.L.layerGroup().addTo(mapRef.current);
      msgPathsLayerRef.current = window.L.layerGroup().addTo(mapRef.current);
      neighbourLinksLayerRef.current = window.L.layerGroup().addTo(
        mapRef.current,
      );

      setTimeout(() => mapRef.current.invalidateSize(), 100);
    }

    const onMapClick = (e) => {
      if (!pickingHome) {
        // Clicking the map background clears any highlight
        setHighlightedPubkey(null);
        return;
      }
      fetch("/api/home", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: e.latlng.lat, lon: e.latlng.lng }),
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
      if (mapRef.current) mapRef.current.off("click", onMapClick);
    };
  }, [pickingHome, loadMap]);

  // Initial data load + polling
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((s) => {
        if (s.map_path_max_km) mapPathMaxKmRef.current = s.map_path_max_km;
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
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [loadNodeNames, loadMap]);

  // Paths layer: re-render whenever the toggle or highlight changes
  useEffect(() => {
    if (showingPaths) renderPathsLayer(highlightedPubkey);
    else if (pathsLayerRef.current) pathsLayerRef.current.clearLayers();
  }, [showingPaths, highlightedPubkey, renderPathsLayer]);

  // Msg paths layer: no filter, just on/off
  useEffect(() => {
    if (showingMsgPaths) renderMsgPathsLayer();
    else if (msgPathsLayerRef.current) msgPathsLayerRef.current.clearLayers();
  }, [showingMsgPaths, renderMsgPathsLayer]);

  // Neighbours layer: re-render whenever the toggle or highlight changes
  useEffect(() => {
    if (showingNeighbourLinks) renderNeighbourLinksLayer(highlightedPubkey);
    else if (neighbourLinksLayerRef.current)
      neighbourLinksLayerRef.current.clearLayers();
  }, [showingNeighbourLinks, highlightedPubkey, renderNeighbourLinksLayer]);

  // Contacts layer: on/off only (contacts don't filter by highlight)
  useEffect(() => {
    if (showingAllContacts) renderContactsLayer(highlightedPubkey);
    else if (contactsLayerRef.current) contactsLayerRef.current.clearLayers();
  }, [showingAllContacts, renderContactsLayer]);

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className={styles.mapWrap}>
      <div className={styles.mapBody}>
        <div
          ref={mapContainerRef}
          id="leaflet-map"
          className={`${styles.leafletMap} ${pickingHome ? "map-picking" : ""}`}
        ></div>

        <MapLegend
          open={legendOpen}
          onToggle={() => setLegendOpen((p) => !p)}
        />

        <MapControls
          legendOpen={legendOpen}
          pickingHome={pickingHome}
          showingAllContacts={showingAllContacts}
          showingPaths={showingPaths}
          showingMsgPaths={showingMsgPaths}
          showingNeighbourLinks={showingNeighbourLinks}
          onToggleHome={() => setPickingHome((p) => !p)}
          onToggleContacts={() => setShowingAllContacts((p) => !p)}
          onTogglePaths={() => {
            setHighlightedPubkey(null);
            setShowingPaths((p) => !p);
          }}
          onToggleMsgPaths={() => setShowingMsgPaths((p) => !p)}
          onToggleNeighbours={() => {
            if (!showingNeighbourLinks) {
              setShowingNeighbourLinks(!showingAllContacts ? 2 : 1);
              setShowingAllContacts(true);
            } else {
              if (showingNeighbourLinks == 2) {
                setShowingAllContacts(false);
              }
              setShowingNeighbourLinks(false);
            }
            
          }}
          onRefresh={loadMap}
        />
      </div>
    </div>
  );
}
