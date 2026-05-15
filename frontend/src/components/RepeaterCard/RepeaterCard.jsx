import { useState, useEffect } from "preact/hooks";
import styles from "./RepeaterCard.module.css";
import RepeaterCardHeader from "./header/RepeaterCardHeader";
import RepeaterCardFooter from "./footer/RepeaterCardFooter";
import RepeaterCardMetric from "./metric_tile/RepeaterCardMetric";

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

function clockOffsetClass(secs, limit) {
  if (secs === undefined || secs == null) return "";
  if (Math.abs(secs) >= 10) return styles["metric-mid"];
  if (Math.abs(secs) >= 30) return styles["metric-bad"];
  return styles["metric-good-white"];
}

function batteryPercent(mv) {
  if (mv <= 0) return 0;
  const pct = Math.round(((mv - 3000) / (4200 - 3000)) * 100);
  return Math.max(0, Math.min(100, pct));
}

function batteryClass(mv) {
  if (mv <= 0) return "";
  if (mv >= 3800) return styles["metric-good"];
  if (mv >= 3500) return styles["metric-mid"];
  return styles["metric-bad"];
}

function batteryColor(mv, paused) {
  if (paused) return "#94a3b8";
  if (mv == null) return "#FFFFFF";
  if (mv >= 3800) return "#22c55e";
  if (mv >= 3500) return "#eab308";
  return "#ef4444";
}

function signalClass(rssi) {
  if (rssi == null) return "";
  if (rssi > -90) return styles["metric-good-white"];
  if (rssi > -110) return styles["metric-mid"];
  return styles["metric-bad"];
}

function snrClass(snr) {
  if (snr == null) return "";
  if (snr >= 8) return styles["metric-good-white"];
  if (snr >= 0) return styles["metric-mid"];
  return styles["metric-bad"];
}

function noiseClass(noise_floor) {
  if (noise_floor == null) return "";
  if (noise_floor <= -110) return styles["metric-good-white"];
  if (noise_floor >= -105 && noise_floor < -100) return styles["metric-mid"];
  if (noise_floor >= -100) return styles["metric-bad"];
  return "";
}

function tempClass(temperature) {
  if (temperature == null) return "";
  if (temperature <= 0 || temperature >= 40) return styles["metric-bad"];
  return "";
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
  chain.push("You");
  return chain.join(" \u2192 ");
}

export default function RepeaterCard({
  r,
  index,
  prefixToName,
  dragItem,
  dragOverItem,
  handleSort,
  setHistoryNode,
  setRemoteAdminNode,
  updateRepeaterData,
}) {
  const [pingState, setPingState] = useState({
    cooldown: 0,
    cooldownEndTime: 0,
    result: null,
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [lastPolledMenuOpen, setLastPolledMenuOpen] = useState(false);

  // Ping cooldown timer
  useEffect(() => {
    if (pingState.cooldown <= 0) return;

    const interval = setInterval(() => {
      const now = Date.now() / 1000;
      const remaining = Math.max(0, Math.ceil(pingState.cooldownEndTime - now));

      if (remaining !== pingState.cooldown) {
        setPingState((prev) => ({ ...prev, cooldown: remaining }));
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [pingState.cooldown, pingState.cooldownEndTime]);

  const pingRepeater = async (e) => {
    e.stopPropagation();
    const now = Date.now() / 1000;
    setPingState({ cooldown: 30, cooldownEndTime: now + 30, result: null });

    try {
      const res = await fetch(`/api/ping/${encodeURIComponent(r.pubkey)}`, {
        method: "POST",
      });
      const data = await res.json();
      setPingState((prev) => ({ ...prev, result: data.ok ? "ok" : "fail" }));
    } catch (err) {
      console.error(err);
      setPingState((prev) => ({ ...prev, result: "fail" }));
    }
  };

  const sendAdvert = async (e) => {
    e.stopPropagation();
    setMenuOpen(false);
    try {
      await fetch(`/api/advert/${encodeURIComponent(r.pubkey)}`, {
        method: "POST",
      });
    } catch (err) {
      console.error(err);
    }
  };

  const setClock = async (e) => {
    e.stopPropagation();
    setMenuOpen(false);
    try {
      await fetch(`/api/set_clock/${encodeURIComponent(r.pubkey)}`, {
        method: "POST",
      });
    } catch (err) {
      console.error(err);
    }
  };

  const togglePauseRepeater = async (e) => {
    e.stopPropagation();
    try {
      await fetch(`/api/repeater/${r.pubkey}/pause`, { method: "POST" });
      if (updateRepeaterData) await updateRepeaterData();
    } catch (err) {
      console.log(err);
    }
  };

  const bPct = batteryPercent(r.battery_mv);
  const isLowBat = r.battery_mv > 0 && bPct <= 25;
  const isOffline = r.last_poll_ok === false;

  const statusClass = r.paused
    ? "paused"
    : r.last_poll_ok === true
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
      className={`${styles.card} ${r.paused ? styles["card-paused"] : ""}`}
      draggable
      onDragStart={(e) => {
        dragItem.current = index;
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragEnter={(e) => {
        dragOverItem.current = index;
        e.currentTarget.classList.add(styles["drag-over"]);
      }}
      onDragLeave={(e) => {
        e.currentTarget.classList.remove(styles["drag-over"]);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        e.currentTarget.classList.remove(styles["drag-over"]);
        handleSort();
      }}
    >
      <div className={styles["battery-warning-container"]}>
        {isLowBat && !r.paused && (
          <div className={styles["battery-warning"]}>LOW BATTERY - {bPct}%</div>
        )}
      </div>

      <RepeaterCardHeader
        name={r.name}
        pubkeyShort={r.pubkey_prefix || r.pubkey.substring(0, 12)}
        statusClass={statusClass}
      />

      <div
        className={styles["card-history-block"]}
        onClick={(e) => {
          if (e.target.tagName === "BUTTON" || e.target.closest(".popup-menu"))
            return;
          setHistoryNode({ pubkey: r.pubkey, name: r.name });
        }}
      >
        <div className={styles.metrics}>
          <RepeaterCardMetric
            label="Battery"
            value={r.battery_mv != null ? bPct : null}
            unit="%"
            valueClass={batteryClass(r.battery_mv)}
            subValue={
              r.battery_voltage != null
                ? r.battery_voltage.toFixed(2) + " V"
                : null
            }
            showBar={true}
            barPercent={bPct}
            barColor={batteryColor(r.battery_mv, r.paused)}
          />
          <RepeaterCardMetric
            label="RSSI"
            value={r.rssi != null ? r.rssi : null}
            unit="dBm"
            valueClass={signalClass(r.rssi)}
          />
          <RepeaterCardMetric
            label="SNR"
            value={r.snr != null ? r.snr.toFixed(1) : null}
            unit="dB"
            valueClass={snrClass(r.snr)}
          />
          <RepeaterCardMetric
            label="Noise Floor"
            value={r.noise_floor != null ? r.noise_floor : null}
            unit="dBm"
            valueClass={noiseClass(r.noise_floor)}
          />
          <RepeaterCardMetric
            label="Uptime"
            value={formatUptime(r.uptime_seconds)}
          />
          <RepeaterCardMetric label="Hops" value={hopsLabel} />

          {r.temperature != null && (
            <RepeaterCardMetric
              label="Temp"
              value={r.temperature.toFixed(1)}
              unit="°C"
              valueClass={tempClass(r.temperature)}
            />
          )}

          {r.humidity != null && (
            <RepeaterCardMetric
              label="Humidity"
              value={r.humidity.toFixed(1)}
              unit="%"
            />
          )}

          {r.time_offset_seconds != null &&
            Math.abs(r.time_offset_seconds) >= r.clock_offset_limit && (
              <RepeaterCardMetric
                label="Time Error"
                value={`${r.time_offset_seconds > 0 ? "+" : ""}${Math.max(
                  Math.min(r.time_offset_seconds, 999),
                  -999,
                )}`}
                unit="s"
                valueClass={clockOffsetClass(
                  r.time_offset_seconds,
                  r.clock_offset_limit,
                )}
              />
            )}
        </div>
      </div>

      <RepeaterCardFooter
        timeAgoString={timeAgo(r.last_seen_epoch)}
        routeChain={routeChain}
        fwVersion={r.fw_version}
        isOffline={isOffline}
        r={r}
        lastPolledMenuOpen={lastPolledMenuOpen}
        setLastPolledMenuOpen={setLastPolledMenuOpen}
        menuOpen={menuOpen}
        setMenuOpen={setMenuOpen}
        pingState={pingState}
        pingRepeater={pingRepeater}
        sendAdvert={sendAdvert}
        setClock={setClock}
        setRemoteAdminNode={setRemoteAdminNode}
        togglePauseRepeater={togglePauseRepeater}
      />
    </div>
  );
}
