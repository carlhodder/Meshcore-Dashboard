import { useState, useEffect } from "preact/hooks";
import HistoryModal from "../components/HistoryModal";

function formatUptime(seconds) {
  if (!seconds || seconds <= 0) return "--";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function timeAgo(epoch) {
  if (!epoch || epoch === 0) return "Never";
  const diff = Math.floor(Date.now() / 1000 - epoch);
  if (diff < 0) return "Just now";
  if (diff < 60) return diff + "s ago";
  if (diff < 3600) return Math.floor(diff / 60) + "m ago";
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
  return Math.floor(diff / 86400) + "d ago";
}

function batteryPercent(mv) {
  if (mv <= 0) return 0;
  const pct = Math.round(((mv - 3000) / (4200 - 3000)) * 100);
  return Math.max(0, Math.min(100, pct));
}

function batteryClass(mv) {
  if (mv <= 0) return "";
  if (mv >= 3800) return "battery-good";
  if (mv >= 3500) return "battery-mid";
  return "battery-low";
}

function batteryColor(mv) {
  if (mv == null) return "#FFFFFF";
  if (mv >= 3800) return "#22c55e";
  if (mv >= 3500) return "#eab308";
  return "#ef4444";
}

function signalClass(rssi) {
  if (rssi == null) return "";
  if (rssi > -90) return "signal-good";
  if (rssi > -110) return "signal-mid";
  return "signal-bad";
}

function buildRouteChain(r, prefixToName) {
  if (r.last_seen_epoch === 0) return null;
  const chain = [r.name];
  if (r.route_path) {
    const segs = r.route_path.replace(/\s/g, "").split(">");
    segs.forEach((seg) => {
      chain.push(prefixToName[seg] || seg);
    });
  } else if (r.hops > 0) {
    for (let i = 0; i < r.hops; i++) chain.push("?");
  }
  chain.push("GW");
  return chain.join(" \u2192 ");
}

export default function Dashboard() {
  const [repeaters, setRepeaters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [historyNode, setHistoryNode] = useState(null);
  const [menuOpen, setMenuOpen] = useState(null);
  const [cardOrder, setCardOrder] = useState([]);
  const [pingStates, setPingStates] = useState({});

  useEffect(() => {
    const handleClick = (e) => {
      if (!e.target.closest(".menu-container")) {
        setMenuOpen(null);
      }
    };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((s) => {
        if (s.repeaters && s.repeaters.length > 0) {
          setCardOrder(s.repeaters.map((r) => r.pubkey));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now() / 1000;
      setPingStates((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const pk in next) {
          if (next[pk].cooldown > 0) {
            const remaining = Math.max(
              0,
              Math.ceil(next[pk].cooldownEndTime - now),
            );
            if (remaining !== next[pk].cooldown) {
              next[pk] = { ...next[pk], cooldown: remaining };
              changed = true;
            }
          }
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Poll repeaters initially, then use SSE
  useEffect(() => {
    fetch("/api/repeaters")
      .then((res) => res.json())
      .then((data) => {
        setRepeaters(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });

    const evtSource = new EventSource("/api/stream");
    evtSource.addEventListener("update", (e) => {
      try {
        const data = JSON.parse(e.data);
        setRepeaters(data);
      } catch (err) {
        console.error("SSE parse error:", err);
      }
    });

    return () => {
      evtSource.close();
    };
  }, []);

  const pingRepeater = async (pubkey, e) => {
    e.stopPropagation();
    const now = Date.now() / 1000;
    setPingStates((prev) => ({
      ...prev,
      [pubkey]: { cooldown: 30, cooldownEndTime: now + 30, result: null },
    }));

    try {
      const res = await fetch(`/api/ping/${encodeURIComponent(pubkey)}`, {
        method: "POST",
      });
      const data = await res.json();
      setPingStates((prev) => ({
        ...prev,
        [pubkey]: { ...prev[pubkey], result: data.ok ? "ok" : "fail" },
      }));
    } catch (err) {
      console.error(err);
      setPingStates((prev) => ({
        ...prev,
        [pubkey]: { ...prev[pubkey], result: "fail" },
      }));
    }
  };

  const sendAdvert = async (pubkey, e) => {
    e.stopPropagation();
    setMenuOpen(null);
    try {
      await fetch(`/api/advert/${encodeURIComponent(pubkey)}`, {
        method: "POST",
      });
    } catch (err) {
      console.error(err);
    }
  };

  const setClock = async (pubkey, e) => {
    e.stopPropagation();
    setMenuOpen(null);
    try {
      await fetch(`/api/set_clock/${encodeURIComponent(pubkey)}`, {
        method: "POST",
      });
    } catch (err) {
      console.error(err);
    }
  };

  if (loading)
    return (
      <div className="no-data">
        <h2>Connecting...</h2>
      </div>
    );

  const prefixToName = {};
  repeaters.forEach((rep) => {
    if (rep.pubkey) prefixToName[rep.pubkey.substring(0, 2)] = rep.name;
  });

  const sortedRepeaters = [...repeaters].sort((a, b) => {
    if (!cardOrder.length) return 0;
    const ai = cardOrder.indexOf(a.pubkey);
    const bi = cardOrder.indexOf(b.pubkey);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  return (
    <>
      <div className="grid" id="repeaterGrid">
        {sortedRepeaters.map((r) => {
          const bPct = batteryPercent(r.battery_mv);
          const bClass = batteryClass(r.battery_mv);
          const sClass = signalClass(r.rssi);
          const isLowBat = r.battery_mv > 0 && bPct <= 25; // 25% low bat threshold
          const isOffline = r.last_poll_ok === false;

          const statusClass =
            r.last_poll_ok === true
              ? "online"
              : r.last_poll_ok === false
                ? "offline"
                : "unknown";
          const hopsLabel =
            r.last_seen_epoch > 0
              ? r.hops === 0
                ? "Direct"
                : `${r.hops} hop(s)`
              : "--";

          const routeChain = buildRouteChain(r, prefixToName);

          return (
            <div
              className="card"
              key={r.pubkey}
              onClick={(e) => {
                if (
                  e.target.tagName === "BUTTON" ||
                  e.target.closest(".popup-menu")
                )
                  return;
                setHistoryNode({ pubkey: r.pubkey, name: r.name });
              }}
            >
              <div className="battery-warning-container">
                {isLowBat && (
                  <div className="battery-warning">LOW BATTERY - {bPct}%</div>
                )}
              </div>
              <div className="card-header">
                <div>
                  <div className="card-name">{r.name}</div>
                  <div className="card-id">
                    {r.pubkey_short || r.pubkey.substring(0, 12)}
                  </div>
                </div>
                <span className={`status-dot ${statusClass}`}></span>
              </div>
              <div className="metrics">
                <div className="metric">
                  <div className="metric-label">Battery</div>
                  <div className={`metric-value val-battery ${bClass}`}>
                    {r.battery_mv != null ? bPct : "--"}
                    <span className="metric-unit"> %</span>
                  </div>
                  <div className="metric-sub sub-battery">
                    {r.battery_voltage != null
                      ? r.battery_voltage.toFixed(2) + " V"
                      : "--"}
                  </div>
                  <div className="bar-bg">
                    <div
                      className="bar-fill"
                      style={{
                        width: `${bPct}%`,
                        background: batteryColor(r.battery_mv),
                      }}
                    ></div>
                  </div>
                </div>
                <div className="metric">
                  <div className="metric-label">RSSI</div>
                  <div className={`metric-value val-rssi ${sClass}`}>
                    {r.rssi != null ? r.rssi : "--"}
                    <span className="metric-unit"> dBm</span>
                  </div>
                </div>
                <div className="metric">
                  <div className="metric-label">SNR</div>
                  <div className="metric-value val-snr">
                    {r.snr != null ? r.snr.toFixed(1) : "--"}
                    <span className="metric-unit"> dB</span>
                  </div>
                </div>
                <div className="metric">
                  <div className="metric-label">Noise Floor</div>
                  <div className="metric-value val-noise">
                    {r.noise_floor != null ? r.noise_floor : "--"}
                    <span className="metric-unit"> dBm</span>
                  </div>
                </div>
                <div className="metric">
                  <div className="metric-label">Uptime</div>
                  <div className="metric-value val-uptime">
                    {formatUptime(r.uptime_seconds)}
                  </div>
                </div>
                <div className="metric">
                  <div className="metric-label">Hops</div>
                  <div className="metric-value val-hops">{hopsLabel}</div>
                </div>
                {r.temperature != null && (
                  <div className="metric">
                    <div className="metric-label">Temp</div>
                    <div className="metric-value val-temp">
                      {r.temperature.toFixed(1)}
                      <span className="metric-unit"> °C</span>
                    </div>
                  </div>
                )}
                {r.humidity != null && (
                  <div className="metric">
                    <div className="metric-label">Humidity</div>
                    <div className="metric-value val-humidity">
                      {r.humidity.toFixed(1)}
                      <span className="metric-unit"> %</span>
                    </div>
                  </div>
                )}
                {r.time_offset_seconds != null &&
                  Math.abs(r.time_offset_seconds) >= 30 && (
                    <div className="metric">
                      <div className="metric-label">Time Error</div>
                      <div
                        className="metric-value val-time-error"
                        style={{ color: "#ef4444" }}
                      >
                        {r.time_offset_seconds > 0 ? "+" : ""}
                        {r.time_offset_seconds}
                        <span className="metric-unit"> s</span>
                      </div>
                    </div>
                  )}
              </div>
              <div className="card-footer">
                <div className="card-footer-left">
                  <div className="card-footer-seen">
                    Last seen: {timeAgo(r.last_seen_epoch)}
                  </div>
                  <div className="card-footer-route-container">
                    {routeChain && (
                      <div className="card-footer-route">{routeChain}</div>
                    )}
                  </div>
                  <div className="card-footer-fw-container">
                    {r.fw_version && (
                      <div
                        className="card-footer-fw"
                        style={{
                          color: "#64748b",
                          fontSize: "0.75rem",
                          marginTop: "0.15rem",
                        }}
                      >
                        {r.fw_version}
                      </div>
                    )}
                  </div>
                  <div className="card-offline-text-container">
                    {isOffline && (
                      <div className="card-offline-text">
                        No response to last poll
                      </div>
                    )}
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: "0.5rem",
                    alignItems: "center",
                  }}
                >
                  {(() => {
                    const pingState = pingStates[r.pubkey];
                    const cooldown = pingState ? pingState.cooldown : 0;
                    const result = pingState ? pingState.result : null;
                    const pingDisabled = cooldown > 0;
                    let pingClass = "card-ping-btn";
                    if (cooldown > 0 && result) {
                      pingClass += result === "ok" ? " ping-ok" : " ping-fail";
                    }
                    const pingLabel = cooldown > 0 ? `${cooldown}s` : "Poll";

                    return (
                      <button
                        className={pingClass}
                        disabled={pingDisabled}
                        onClick={(e) => pingRepeater(r.pubkey, e)}
                      >
                        {pingLabel}
                      </button>
                    );
                  })()}
                  <div
                    className="menu-container"
                    style={{ position: "relative" }}
                  >
                    <button
                      className="hamburger-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpen(menuOpen === r.pubkey ? null : r.pubkey);
                      }}
                    >
                      &#8942;
                    </button>
                    {menuOpen === r.pubkey && (
                      <div
                        className="popup-menu"
                        style={{
                          display: "block",
                          position: "absolute",
                          right: 0,
                          bottom: "100%",
                          zIndex: 10,
                        }}
                      >
                        <button onClick={(e) => sendAdvert(r.pubkey, e)}>
                          Advert
                        </button>
                        <button onClick={(e) => setClock(r.pubkey, e)}>
                          Set clock
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {historyNode && (
        <HistoryModal
          pubkey={historyNode.pubkey}
          name={historyNode.name}
          onClose={() => setHistoryNode(null)}
        />
      )}
    </>
  );
}
