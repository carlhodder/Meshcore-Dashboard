import { useEffect, useRef } from "preact/hooks";
import styles from "./MapPage.module.css";

export default function MapPage() {
  const mapRef = useRef(null);

  useEffect(() => {
    if (!window.L) return;

    const map = window.L.map(mapRef.current, { zoomControl: true }).setView(
      [-41.0, 174.0],
      6,
    );

    window.L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      {
        attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
        subdomains: "abcd",
        maxZoom: 19,
      },
    ).addTo(map);

    setTimeout(() => map.invalidateSize(), 100);

    let _markers = {};
    let _linkLines = {};
    let _homeMarker = null;
    let _lastMapData = null;
    let _pubkeyMap = {};
    let _didInitialFit = false;
    let _nodeColors = {};
    let _mapNodeNames = {};

    let _selectedPubkey = null;
    let _neighbourLayer = window.L.layerGroup().addTo(map);
    let _adjacency = {};
    let _nodeNameMap = {};
    let _contactMap = {};
    let _contactsLayer = window.L.layerGroup().addTo(map);
    let _advertLayer = window.L.layerGroup().addTo(map);
    let _pathsLayer = window.L.layerGroup().addTo(map);
    let _msgPathsLayer = window.L.layerGroup().addTo(map);
    let _showingAllContacts = false;
    let _showingPaths = false;
    let _showingMsgPaths = false;
    let _showingNeighbourLinks = false;
    let _neighbourLinksLayer = window.L.layerGroup().addTo(map);
    let _highlightedRepeater = null;
    let _pathsStateBeforeHighlight = false;
    let _allContactsData = [];
    let _allNodeLatLng = {};
    let _mapPathMaxKm = 300;
    let _nodeIdChars = 2;

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
      if (
        r.last_seen_epoch &&
        Date.now() / 1000 - r.last_seen_epoch < recentSec
      )
        return "#4ade80";
      return "#64748b";
    }

    function buildAdjacency(repeaters, home) {
      _adjacency = {};
      _nodeNameMap = {};
      const homePk = "__home__";
      if (home && home.name) _nodeNameMap[homePk] = home.name;
      repeaters.forEach((r) => {
        if (r.pubkey) _nodeNameMap[r.pubkey] = r.name;
      });
      Object.keys(_contactMap).forEach((prefix) => {
        const c = _contactMap[prefix];
        if (c.pubkey) _nodeNameMap[c.pubkey] = c.name;
      });

      function addEdge(a, b) {
        if (!_adjacency[a]) _adjacency[a] = [];
        if (!_adjacency[a].includes(b)) _adjacency[a].push(b);
        if (!_adjacency[b]) _adjacency[b] = [];
        if (!_adjacency[b].includes(a)) _adjacency[b].push(a);
      }

      function buildChain(pubkey, route_path) {
        const chain = [homePk];
        if (route_path) {
          route_path
            .replace(/\s/g, "")
            .split(">")
            .forEach((seg) => {
              const segLower = seg.toLowerCase();
              const intermediate = _pubkeyMap[segLower];
              if (intermediate && intermediate.pubkey !== pubkey) {
                chain.push(intermediate.pubkey);
              } else if (!intermediate) {
                const unk = _contactMap[segLower];
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
      Object.keys(_contactMap).forEach((prefix) => {
        const c = _contactMap[prefix];
        if (c.pubkey) buildChain(c.pubkey, c.route_path);
      });
    }

    function loadNodeNames() {
      fetch("/api/node-names")
        .then((r) => r.json())
        .then((d) => {
          _mapNodeNames = d || {};
        })
        .catch(() => {});
    }

    // --- Path helpers ---
    function _haversineKm(a, b) {
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

    function _addPathToSegments(
      latlngs,
      label,
      segCounts,
      segLatLng,
      segLabels,
    ) {
      if (latlngs.length < 2) return;
      for (var i = 0; i < latlngs.length - 1; i++) {
        var a = latlngs[i],
          b = latlngs[i + 1];
        if (_haversineKm(a, b) > _mapPathMaxKm) continue; // skip unrealistic direct hops
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

    function _pathInvolvesRepeater(destPubkey, routePath, filterPk) {
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

    function renderPathsLayer() {
      _pathsLayer.clearLayers();
      fetch("/api/contact-routes")
        .then((r) => r.json())
        .then((routes) => {
          var homeNode = _allNodeLatLng["__home__"];
          var filterPk = _highlightedRepeater; // null = show all

          var segCounts = {};
          var segLatLng = {};
          var segLabels = {};

          var myPrefixes = {};
          if (_lastMapData) {
            (_lastMapData.repeaters || []).forEach((r) => {
              if (r.pubkey && r.pubkey.length >= 2)
                myPrefixes[r.pubkey.substring(0, 2).toLowerCase()] = true;
            });
          }

          if (_lastMapData) {
            (_lastMapData.repeaters || []).forEach((r) => {
              if (!r.lat || !r.lon) return;
              var rHops = r.hops >= 0 ? r.hops : 0;
              if (rHops > 0 && !r.route_path) return;
              if (
                filterPk &&
                !_pathInvolvesRepeater(r.pubkey, r.route_path || "", filterPk)
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
                      _allNodeLatLng[
                        seg.substring(0, _nodeIdChars).toLowerCase()
                      ] || _allNodeLatLng[seg.substring(0, 2).toLowerCase()];
                    if (node) latlngs.push([node.lat, node.lon]);
                  });
              }
              latlngs.push([r.lat, r.lon]);
              if (rHops > 0 && latlngs.length < 3) return;
              _addPathToSegments(
                latlngs,
                r.name + " (" + rHops + " hop" + (rHops !== 1 ? "s" : "") + ")",
                segCounts,
                segLatLng,
                segLabels,
              );
            });
          }

          Object.keys(routes).forEach((prefix) => {
            var entry = routes[prefix];
            var preN = prefix.substring(0, _nodeIdChars).toLowerCase();
            var pre2 = prefix.substring(0, 2).toLowerCase();
            if (myPrefixes[pre2]) return;
            var dest = _allNodeLatLng[preN] || _allNodeLatLng[pre2];
            if (!dest) return;
            if (
              filterPk &&
              !_pathInvolvesRepeater(prefix, entry.path || "", filterPk)
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
                    _allNodeLatLng[
                      seg.substring(0, _nodeIdChars).toLowerCase()
                    ] || _allNodeLatLng[seg.substring(0, 2).toLowerCase()];
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
            _addPathToSegments(latlngs, label, segCounts, segLatLng, segLabels);
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
            _pathsLayer.addLayer(line);
          });
        })
        .catch(() => {});
    }

    function renderMsgPathsLayer() {
      _msgPathsLayer.clearLayers();
      fetch("/api/message-paths")
        .then((r) => r.json())
        .then((msgs) => {
          var homeNode = _allNodeLatLng["__home__"];
          var segCounts = {};
          var segLatLng = {};
          var segLabels = {};

          msgs.forEach((m) => {
            var pre2 = (m.sender_pubkey || "").substring(0, 2).toLowerCase();
            var preN = (m.sender_pubkey || "")
              .substring(0, _nodeIdChars)
              .toLowerCase();
            var sender = _allNodeLatLng[preN] || _allNodeLatLng[pre2];
            if (!sender) return;

            var latlngs = [[sender.lat, sender.lon]];
            if (m.path) {
              m.path
                .replace(/\s/g, "")
                .split(">")
                .forEach((seg) => {
                  var node =
                    _allNodeLatLng[
                      seg.substring(0, _nodeIdChars).toLowerCase()
                    ] || _allNodeLatLng[seg.substring(0, 2).toLowerCase()];
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
            _addPathToSegments(latlngs, label, segCounts, segLatLng, segLabels);
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
            _msgPathsLayer.addLayer(line);
          });
        })
        .catch(() => {});
    }

    function renderContactsLayer() {
      _contactsLayer.clearLayers();
      _allContactsData.forEach((c) => {
        if (c.configured) return;
        if (!c.lat || !c.lon) return;
        var latlng = [c.lat, c.lon];
        var linked = c.pubkey ? isLinkedToMyRepeaters(c.pubkey) : false;
        var prefix2 = c.pubkey ? c.pubkey.substring(0, 2).toUpperCase() : "";
        var isKnown = !!(prefix2 && _mapNodeNames[prefix2]);

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
            : "") +
          (linked
            ? '<div style="color:#f59e0b;font-size:0.7rem;margin-top:0.2rem">⬡ Linked to your mesh</div>'
            : "");

        var cm = window.L.circleMarker(latlng, {
          radius: 7,
          color: ringColor,
          weight: linked ? 2 : 1.5,
          fillColor: fillColor,
          fillOpacity: 0.75,
          opacity: 0.9,
          dashArray: dashArray,
        })
          .bindPopup(popupContent)
          .addTo(_contactsLayer)
          .on(
            "click",
            ((pk) => {
              return function (e) {
                window.L.DomEvent.stopPropagation(e);
                if (_highlightedRepeater === pk) {
                  _clearPathHighlight();
                } else {
                  _pathsStateBeforeHighlight = _showingPaths;
                  _highlightedRepeater = pk;
                  if (!_showingPaths) {
                    _showingPaths = true;
                    document
                      .getElementById("pathsBtn")
                      .classList.add(styles.active);
                  }
                  renderPathsLayer();
                }
              };
            })(c.pubkey),
          );

        var label = c.name || c.pubkey.substring(0, 8);
        if (linked) {
          var linkedNames = (_adjacency[c.pubkey] || [])
            .filter((nPk) => !!_markers[nPk])
            .map((nPk) => _nodeNameMap[nPk] || nPk.substring(0, 6));
          if (linkedNames.length) label += " \u2192 " + linkedNames.join(", ");
        }

        cm.bindTooltip(label, {
          permanent: true,
          direction: "top",
          className: "map-label",
          offset: [0, -10],
        });
      });
    }

    function isLinkedToMyRepeaters(pubkey) {
      var neighbours = _adjacency[pubkey] || [];
      for (var i = 0; i < neighbours.length; i++) {
        if (_markers[neighbours[i]]) return true;
      }
      return false;
    }

    function renderNeighbourLinksLayer() {
      _neighbourLinksLayer.clearLayers();
      fetch("/api/neighbours")
        .then((r) => r.json())
        .then((neighbours) => {
          if (!neighbours || !neighbours.length) return;

          var fullPkLookup = {};
          if (
            _lastMapData &&
            _lastMapData.home &&
            _lastMapData.home.lat &&
            _lastMapData.home.lon
          ) {
            var h = _lastMapData.home;
            if (h.pubkey)
              fullPkLookup[h.pubkey.toLowerCase()] = {
                lat: h.lat,
                lon: h.lon,
                name: h.name || "Gateway",
              };
          }
          if (_lastMapData) {
            (_lastMapData.repeaters || []).forEach((r) => {
              if (r.pubkey && r.lat && r.lon)
                fullPkLookup[r.pubkey.toLowerCase()] = {
                  lat: r.lat,
                  lon: r.lon,
                  name: r.name,
                };
            });
            (_lastMapData.contacts || []).forEach((c) => {
              if (c.pubkey && c.lat && c.lon)
                fullPkLookup[c.pubkey.toLowerCase()] = {
                  lat: c.lat,
                  lon: c.lon,
                  name: c.name || c.pubkey.substring(0, 8),
                };
            });
            (_lastMapData.advert_nodes || []).forEach((n) => {
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

          neighbours.forEach((nb) => {
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

            var line = window.L.polyline([ptA, ptB], {
              color: "#22d3ee",
              weight: 12,
              opacity: 0.0,
            });
            line.bindTooltip(labelHtml, {
              sticky: true,
              className: "map-label",
            });
            _neighbourLinksLayer.addLayer(line);

            window.L.polyline([ptA, ptB], {
              color: "#22d3ee",
              weight: 2,
              opacity: 0.65,
              interactive: false,
            }).addTo(_neighbourLinksLayer);

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
              .addTo(_neighbourLinksLayer);
          });
        })
        .catch(() => {});
    }

    function _rebuildAllNodeLatLng(data) {
      _allNodeLatLng = {};
      var home = data.home || {};
      if (home.lat && home.lon) {
        _allNodeLatLng["__home__"] = {
          lat: home.lat,
          lon: home.lon,
          name: home.name || "Gateway",
        };
      }
      function _indexNode(pubkey, lat, lon, name) {
        var p2 = pubkey.substring(0, 2).toLowerCase();
        var pN = pubkey.substring(0, _nodeIdChars).toLowerCase();
        var entry = { lat: lat, lon: lon, name: name || p2 };
        _allNodeLatLng[p2] = entry;
        if (pN !== p2) _allNodeLatLng[pN] = entry;
      }
      (data.repeaters || []).forEach((r) => {
        if (!r.lat || !r.lon || !r.pubkey) return;
        _indexNode(r.pubkey, r.lat, r.lon, r.name);
      });
      (data.contacts || []).forEach((c) => {
        if (!c.lat || !c.lon || !c.pubkey) return;
        var p2 = c.pubkey.substring(0, 2).toLowerCase();
        if (!_allNodeLatLng[p2]) _indexNode(c.pubkey, c.lat, c.lon, c.name);
      });
      (data.advert_nodes || []).forEach((n) => {
        if (!n.lat || !n.lon || !n.pubkey) return;
        var p2 = n.pubkey.substring(0, 2).toLowerCase();
        if (!_allNodeLatLng[p2]) _indexNode(n.pubkey, n.lat, n.lon, n.name);
      });
    }

    function _applyLinkAnim(line) {
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

    function renderMap(data) {
      _lastMapData = data;
      const home = data.home || {};
      const repeaters = data.repeaters || [];
      const bounds = [];

      _pubkeyMap = {};
      repeaters.forEach((r, idx) => {
        if (r.pubkey && r.pubkey.length >= 2)
          _pubkeyMap[r.pubkey.substring(0, 2).toLowerCase()] = r;
        if (r.pubkey && r.pubkey.length >= 4)
          _pubkeyMap[r.pubkey.substring(0, 4).toLowerCase()] = r;
        if (!_nodeColors[r.pubkey])
          _nodeColors[r.pubkey] = NODE_PALETTE[idx % NODE_PALETTE.length];
      });

      _allContactsData = data.contacts || [];

      _contactMap = {};
      _allContactsData.forEach((c) => {
        if (c.configured) return;
        if (!c.pubkey || c.pubkey.length < 2) return;
        _contactMap[c.pubkey.substring(0, 2).toLowerCase()] = c;
        if (c.pubkey.length >= 4)
          _contactMap[c.pubkey.substring(0, 4).toLowerCase()] = c;
      });

      buildAdjacency(repeaters, home);

      if (home.lat && home.lon) {
        const homeLatLng = [home.lat, home.lon];
        bounds.push(homeLatLng);
        if (!_homeMarker) {
          _homeMarker = window.L.circleMarker(homeLatLng, {
            radius: 10,
            fillColor: "#38bdf8",
            color: "#0ea5e9",
            weight: 2,
            opacity: 1,
            fillOpacity: 0.9,
          })
            .addTo(map)
            .bindTooltip(home.name || "Gateway", {
              permanent: true,
              direction: "top",
              className: "map-label",
              offset: [0, -10],
            });
        } else {
          _homeMarker.setLatLng(homeLatLng);
        }
      }

      const seenKeys = {};
      repeaters.forEach((r) => {
        if (!r.lat || !r.lon) return;
        seenKeys[r.pubkey] = true;
        const latlng = [r.lat, r.lon];
        bounds.push(latlng);
        const statusColor = markerColor(r);
        const ringColor = _nodeColors[r.pubkey] || "#94a3b8";

        if (_markers[r.pubkey]) {
          _markers[r.pubkey].setLatLng(latlng);
          _markers[r.pubkey].setStyle({
            fillColor: statusColor,
            color: ringColor,
          });
        } else {
          _markers[r.pubkey] = window.L.circleMarker(latlng, {
            radius: 9,
            fillColor: statusColor,
            color: ringColor,
            weight: 3,
            opacity: 1,
            fillOpacity: 0.9,
          })
            .addTo(map)
            .bindTooltip(r.name, {
              permanent: true,
              direction: "top",
              className: "map-label",
              offset: [0, -12],
            })
            .on("click", (e) => {
              window.L.DomEvent.stopPropagation(e);
              if (_highlightedRepeater === r.pubkey) {
                _clearPathHighlight();
              } else {
                _pathsStateBeforeHighlight = _showingPaths;
                _highlightedRepeater = r.pubkey;
                if (!_showingPaths) {
                  _showingPaths = true;
                  const btn = document.getElementById("pathsBtn");
                  if (btn) btn.classList.add(styles.active);
                }
                renderPathsLayer();
              }
            });
        }
      });

      Object.keys(_markers).forEach((pk) => {
        if (!seenKeys[pk]) {
          map.removeLayer(_markers[pk]);
          delete _markers[pk];
        }
      });

      _rebuildAllNodeLatLng(data);
      if (_showingPaths) renderPathsLayer();
      if (_showingMsgPaths) renderMsgPathsLayer();
      if (_showingNeighbourLinks) renderNeighbourLinksLayer();
      if (_showingAllContacts) renderContactsLayer();

      var nodeLatLng = {};
      if (home.lat && home.lon) nodeLatLng["__home__"] = [home.lat, home.lon];
      repeaters.forEach((r) => {
        if (r.lat && r.lon) nodeLatLng[r.pubkey] = [r.lat, r.lon];
      });

      var newLinks = {};
      repeaters.forEach((r) => {
        if (!r.lat || !r.lon) return;
        var nodeColor = _nodeColors[r.pubkey] || "#94a3b8";
        var chain = ["__home__"];
        if (r.route_path && r.hops > 0) {
          var segments = r.route_path.replace(/\s/g, "").split(">");
          segments.forEach((seg) => {
            var intermediate = _pubkeyMap[seg.toLowerCase()];
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

      Object.keys(_linkLines).forEach((key) => {
        if (!newLinks[key]) {
          _linkLines[key].forEach((line) => {
            map.removeLayer(line);
          });
          delete _linkLines[key];
        }
      });

      var OFFSET = 0.00025;
      Object.keys(newLinks).forEach((key) => {
        var lkArr = newLinks[key];
        var n = lkArr.length;
        if (!_linkLines[key]) _linkLines[key] = [];
        var oldArr = _linkLines[key];
        while (oldArr.length > n) {
          map.removeLayer(oldArr.pop());
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
            }).addTo(map);
            _applyLinkAnim(line);
            oldArr.push(line);
          }
        });
      });

      if (bounds.length > 0 && !_didInitialFit) {
        _didInitialFit = true;
        try {
          map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
        } catch (e) {}
      }
    }

    // --- Toggles ---
    function _clearPathHighlight() {
      _highlightedRepeater = null;
      _showingPaths = _pathsStateBeforeHighlight;
      const btn = document.getElementById("pathsBtn");
      if (btn) {
        if (_showingPaths) btn.classList.add(styles.active);
        else btn.classList.remove(styles.active);
      }
      if (_showingPaths) renderPathsLayer();
      else _pathsLayer.clearLayers();
    }

    let _pickingHome = false;
    window.togglePickHome = function () {
      _pickingHome = !_pickingHome;
      const btn = document.getElementById("setHomeBtn");
      const mapEl = document.getElementById("leaflet-map");
      if (btn && mapEl) {
        if (_pickingHome) {
          btn.classList.add(styles.picking);
          btn.textContent = "\u2715 Cancel";
          mapEl.classList.add("map-picking");
        } else {
          btn.classList.remove(styles.picking);
          btn.textContent = "\u8962 Set Home";
          mapEl.classList.remove("map-picking");
        }
      }
    };

    map.on("click", function (e) {
      if (!_pickingHome) {
        if (_highlightedRepeater) _clearPathHighlight();
        return;
      }
      var lat = e.latlng.lat;
      var lon = e.latlng.lng;
      fetch("/api/home", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: lat, lon: lon }),
      })
        .then(function (r) {
          return r.json();
        })
        .then(function (result) {
          if (result.ok) {
            _pickingHome = false;
            var btn = document.getElementById("setHomeBtn");
            if (btn) {
              btn.classList.remove(styles.picking);
              btn.textContent = "\u8962 Set Home";
            }
            document
              .getElementById("leaflet-map")
              .classList.remove("map-picking");
            loadMap();
          }
        })
        .catch(function () {});
    });

    window.toggleAllContacts = function () {
      _showingAllContacts = !_showingAllContacts;
      const btn = document.getElementById("contactsBtn");
      if (btn) {
        if (_showingAllContacts) btn.classList.add(styles.active);
        else btn.classList.remove(styles.active);
      }
      if (!_showingAllContacts) _contactsLayer.clearLayers();
      else renderContactsLayer();
    };

    window.togglePaths = function () {
      _highlightedRepeater = null;
      _showingPaths = !_showingPaths;
      const btn = document.getElementById("pathsBtn");
      if (btn) {
        if (_showingPaths) btn.classList.add(styles.active);
        else btn.classList.remove(styles.active);
      }
      if (!_showingPaths) _pathsLayer.clearLayers();
      else renderPathsLayer();
    };

    window.toggleMsgPaths = function () {
      _showingMsgPaths = !_showingMsgPaths;
      const btn = document.getElementById("msgPathsBtn");
      if (btn) {
        if (_showingMsgPaths) btn.classList.add(styles.active);
        else btn.classList.remove(styles.active);
      }
      if (!_showingMsgPaths) _msgPathsLayer.clearLayers();
      else renderMsgPathsLayer();
    };

    window.toggleNeighbourLinks = function () {
      _showingNeighbourLinks = !_showingNeighbourLinks;
      const btn = document.getElementById("neighboursBtn");
      if (btn) {
        if (_showingNeighbourLinks) btn.classList.add(styles.active);
        else btn.classList.remove(styles.active);
      }
      if (!_showingNeighbourLinks) _neighbourLinksLayer.clearLayers();
      else renderNeighbourLinksLayer();
    };

    function loadMap() {
      fetch("/api/map")
        .then((r) => r.json())
        .then(renderMap)
        .catch(() => {});
    }

    fetch("/api/settings")
      .then((r) => r.json())
      .then((s) => {
        if (s.map_path_max_km) _mapPathMaxKm = s.map_path_max_km;
        if (s.node_id_chars) _nodeIdChars = s.node_id_chars;
      })
      .catch(() => {})
      .finally(() => {
        loadNodeNames();
        loadMap();
      });

    const mapInterval = setInterval(loadMap, 10000);
    const nodeInterval = setInterval(loadNodeNames, 30000);

    // Expose toggles globally for buttons if needed, or bind them inside JSX
    window.loadMap = loadMap;

    return () => {
      clearInterval(mapInterval);
      clearInterval(nodeInterval);
      map.remove();
    };
  }, []);

  return (
    <div className={styles.mapWrap}>
      <div className={styles.mapBody}>
        <div ref={mapRef} id="leaflet-map" className={styles.leafletMap}></div>

        <div className={styles.mapLegend}>
          <div className={styles.legendRow}>
            <div className={`${styles.legendDot} ${styles.gateway}`}></div>{" "}
            Gateway
          </div>
          <div
            className={styles.legendRow}
            style={{
              fontSize: "0.68rem",
              color: "#64748b",
              margin: "0.25rem 0 0.1rem",
            }}
          >
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
            <div className={`${styles.legendDot} ${styles.unknown}`}></div> Not
            polled
          </div>
          <div
            className={styles.legendRow}
            style={{
              fontSize: "0.68rem",
              color: "#64748b",
              marginTop: "0.25rem",
            }}
          >
            Contacts (All mode)
          </div>
          <div className={styles.legendRow}>
            <div
              className={styles.legendDot}
              style={{ background: "#22d3ee" }}
            ></div>{" "}
            Contact
          </div>
          <div className={styles.legendRow}>
            <div
              className={styles.legendDot}
              style={{ background: "#7c3aed" }}
            ></div>{" "}
            Advert
          </div>
          <div
            className={styles.legendRow}
            style={{
              fontSize: "0.68rem",
              color: "#64748b",
              marginTop: "0.25rem",
            }}
          >
            Paths layer
          </div>
          <div className={styles.legendRow}>
            <div
              className={styles.legendDot}
              style={{ background: "#34d399", borderRadius: "2px" }}
            ></div>{" "}
            Single route
          </div>
          <div className={styles.legendRow}>
            <div
              className={styles.legendDot}
              style={{ background: "#f59e0b", borderRadius: "2px" }}
            ></div>{" "}
            Shared segment
          </div>
          <div
            className={styles.legendRow}
            style={{
              fontSize: "0.68rem",
              color: "#64748b",
              marginTop: "0.25rem",
            }}
          >
            Msg paths layer
          </div>
          <div className={styles.legendRow}>
            <div
              className={styles.legendDot}
              style={{ background: "#a78bfa", borderRadius: "2px" }}
            ></div>{" "}
            Message path
          </div>
          <div
            className={styles.legendRow}
            style={{
              fontSize: "0.68rem",
              color: "#64748b",
              marginTop: "0.25rem",
            }}
          >
            Neighbours layer
          </div>
          <div className={styles.legendRow}>
            <div
              className={styles.legendDot}
              style={{ background: "#22d3ee", borderRadius: "2px" }}
            ></div>{" "}
            Neighbour link (SNR)
          </div>
        </div>

        <div className={styles.mapBtnBar}>
          <button
            id="setHomeBtn"
            className={`${styles.mapBtn} ${styles.mapSetHomeBtn}`}
            onClick={() => window.togglePickHome?.()}
          >
            &#8962; Set Home
          </button>
          <button
            id="contactsBtn"
            className={`${styles.mapBtn} ${styles.mapContactsBtn}`}
            onClick={() => window.toggleAllContacts?.()}
          >
            &#9788; All Contacts
          </button>
          <button
            id="pathsBtn"
            className={`${styles.mapBtn} ${styles.mapPathsBtn}`}
            onClick={() => window.togglePaths?.()}
          >
            &#8627; Paths
          </button>
          <button
            id="msgPathsBtn"
            className={`${styles.mapBtn} ${styles.mapPathsBtn}`}
            onClick={() => window.toggleMsgPaths?.()}
          >
            &#9993; Msg Paths
          </button>
          <button
            id="neighboursBtn"
            className={`${styles.mapBtn} ${styles.mapNeighboursBtn}`}
            onClick={() => window.toggleNeighbourLinks?.()}
          >
            &#8767; Neighbours
          </button>
          <button
            className={`${styles.mapBtn} ${styles.mapRefreshBtn}`}
            onClick={() => window.loadMap?.()}
          >
            Refresh
          </button>
        </div>
      </div>
    </div>
  );
}
