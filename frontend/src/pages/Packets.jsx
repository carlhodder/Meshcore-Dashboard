import { useState, useEffect } from "preact/hooks";
import styles from "./Packets.module.css";

const _RX_BADGE = {
  Request: { cls: styles.badgeRxRequest, label: "Request" },
  Advert: { cls: styles.badgeRxAdvert, label: "Advert" },
  "Group Text": { cls: styles.badgeRxGrouptext, label: "Group Text" },
  Response: { cls: styles.badgeRxResponse, label: "Response" },
  "Path Update": { cls: styles.badgeRxPath, label: "Path" },
  "Anon Request": { cls: styles.badgeRxAnon, label: "Anon" },
  "Text Msg": { cls: styles.badgeRxTextmsg, label: "Text Msg" },
};

function badgeLabel(type) {
  switch (type) {
    case "contact_msg":
      return "Direct";
    case "channel_msg":
      return "Channel";
    case "ack":
      return "ACK";
    case "path":
      return "Path";
    case "rx":
      return "RF";
    case "advert_sent":
      return "Advert \u2191";
    default:
      return type;
  }
}

function badgeClass(type) {
  switch (type) {
    case "contact_msg":
      return styles.badgeContactMsg;
    case "channel_msg":
      return styles.badgeChannelMsg;
    case "ack":
      return styles.badgeAck;
    case "path":
      return styles.badgePath;
    case "rx":
      return styles.badgeRx;
    case "advert_sent":
      return styles.badgeAdvertSent;
    default:
      return "";
  }
}

function fmtTime(ts) {
  const d = new Date(ts * 1000);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

export default function Packets() {
  const [events, setEvents] = useState([]);
  const [filter, setFilter] = useState("all");
  const [rawMode, setRawMode] = useState(false);
  const [timeWindow, setTimeWindow] = useState("0");
  const [search, setSearch] = useState("");
  const [nodeIdChars, setNodeIdChars] = useState(2);
  const [decodedLabels, setDecodedLabels] = useState({});

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((s) => {
        if (s.node_id_chars) setNodeIdChars(s.node_id_chars);
      })
      .catch(() => {});

    const fetchPackets = async () => {
      try {
        const resp = await fetch("/api/packets?limit=200");
        if (!resp.ok) return;
        const data = await resp.json();
        setEvents((prev) => {
          const knownIds = new Set(
            prev.map(
              (evt) =>
                `${evt.ts}_${evt.type}_${evt.text || evt.ack_code || evt.route || ""}`,
            ),
          );
          const newEvts = [];
          [...data].reverse().forEach((evt) => {
            const id = `${evt.ts}_${evt.type}_${evt.text || evt.ack_code || evt.route || ""}`;
            if (!knownIds.has(id)) {
              newEvts.unshift(evt);
            }
          });
          const combined = [...newEvts, ...prev];
          if (combined.length > 200) return combined.slice(0, 200);
          return combined;
        });
      } catch (e) {}
    };

    fetchPackets();
    const interval = setInterval(fetchPackets, 3000);
    return () => clearInterval(interval);
  }, []);

  const matchesFilter = (evt) => {
    const windowMins = parseInt(timeWindow);
    if (windowMins > 0) {
      const cutoff = Date.now() / 1000 - windowMins * 60;
      if (evt.ts < cutoff) return false;
    }

    let typeOk = false;
    if (filter === "all") typeOk = true;
    else if (filter === "advert")
      typeOk =
        (evt.type === "rx" && evt.pkt_type === "Advert") ||
        evt.type === "advert_sent";
    else if (filter === "request_rx")
      typeOk = evt.type === "rx" && evt.pkt_type === "Request";
    else if (filter === "textmsg_rx")
      typeOk = evt.type === "rx" && evt.pkt_type === "Text Msg";
    else if (filter === "direct_rx")
      typeOk = evt.type === "rx" && evt.direct === true;
    else typeOk = evt.type === filter;

    if (!typeOk) return false;

    const term = search.trim().toLowerCase();
    if (term) {
      const haystack = [
        evt.type,
        evt.pkt_type,
        evt.sender,
        evt.text,
        evt.channel,
        evt.name,
        evt.node,
        evt.route,
        evt.raw,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(term)) return false;
    }

    return true;
  };

  const filteredEvents = events.filter(matchesFilter);

  const toggleDecodedLabel = (id) => {
    setDecodedLabels((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const renderHexSegments = (evt) => {
    const raw = evt.raw || "";
    if (raw.length < 4) return <div className={styles.pktHexSeg}>{raw}</div>;

    const header = parseInt(raw.slice(0, 2), 16);
    const routeType = header & 0x03;
    const payloadType = (header >> 2) & 0x0f;
    const routeNames = ["Direct", "Flood", "Routed", "Reply"];
    const pathLen = parseInt(raw.slice(2, 4), 16) & 0x1F;
    const pathChars = ((parseInt(raw.slice(2, 4), 16) >> 6)  + 1) * 2;
    const pathArr = evt.path || [];

    const segments = [];
    segments.push({
      key: "header",
      hex: raw.slice(0, 2),
      cls: styles.hexHeader,
      tip: `Header • ${routeNames[routeType]} route • payload type ${payloadType}`,
    });
    segments.push({
      key: "pathlen",
      hex: raw.slice(2, 4),
      cls: styles.hexPathlen,
      tip: `Path length: ${pathLen} hop${pathLen !== 1 ? "s" : ""}`,
    });

    for (let i = 0; i < pathLen; i++) {
      const hp = 4 + i * pathChars;
      if (hp + 2 > raw.length) break;
      const hopHex = raw.slice(hp, hp + pathChars);
      const hopInfo = pathArr[i];
      const hopName =
        hopInfo && hopInfo.name !== hopInfo.id ? hopInfo.name : "";
      segments.push({
        key: `hop_${i}`,
        hex: hopHex,
        cls: hopName ? `${styles.hexHop} ${styles.hexHopNamed}` : styles.hexHop,
        tip: hopName ? `${hopHex} → ${hopName}` : `Hop ${i + 1}: ${hopHex}`,
      });
    }

    const plStart = 4 + pathLen * pathChars;
    const pl = raw.slice(plStart);

    if (payloadType === 4 && pl.length >= 218) {
      segments.push({
        key: "p1",
        hex: pl.slice(0, 64),
        cls: styles.hexPayloadKey,
        tip: "Public key (32 bytes)",
      });
      segments.push({
        key: "p2",
        hex: pl.slice(64, 72),
        cls: styles.hexPayloadTs,
        tip: "Timestamp (4 bytes)",
      });
      segments.push({
        key: "p3",
        hex: pl.slice(72, 200),
        cls: styles.hexPayloadSig,
        tip: "Signature (64 bytes)",
      });
      segments.push({
        key: "p4",
        hex: pl.slice(200, 202),
        cls: styles.hexPayloadFlags,
        tip: "App flags",
      });
      segments.push({
        key: "p5",
        hex: pl.slice(202, 210),
        cls: styles.hexPayloadCoord,
        tip: "Latitude",
      });
      segments.push({
        key: "p6",
        hex: pl.slice(210, 218),
        cls: styles.hexPayloadCoord,
        tip: "Longitude",
      });
      const nameHex = pl.slice(218);
      if (nameHex) {
        segments.push({
          key: "p7",
          hex: nameHex,
          cls: styles.hexPayloadName,
          tip: "Node name • click to reveal",
          decoded: evt.node || "?",
        });
      }
    } else {
      segments.push({
        key: "payload",
        hex: pl,
        cls: styles.hexPayload,
        tip: `Payload (${Math.floor(pl.length / 2)} bytes)`,
      });
    }

    return (
      <div className={styles.pktHexSeg}>
        {segments.map((seg) => (
          <span key={seg.key}>
            <span
              className={`${styles.hexSeg} ${seg.cls}`}
              title={seg.tip}
              onClick={() =>
                seg.decoded && toggleDecodedLabel(`${evt.ts}_${seg.key}`)
              }
            >
              {seg.hex}
            </span>
            {seg.decoded && decodedLabels[`${evt.ts}_${seg.key}`] && (
              <span className={styles.hexDecodedLabel}>{seg.decoded}</span>
            )}
            {"\u202f"}
          </span>
        ))}
      </div>
    );
  };

  return (
    <div className={styles.packetsBody}>
      <div className={styles.packetsToolbar}>
        {[
          "all",
          "contact_msg",
          "channel_msg",
          "ack",
          "path",
          "rx",
          "request_rx",
          "textmsg_rx",
          "advert",
          "direct_rx",
        ].map((type) => {
          const labels = {
            all: "All",
            contact_msg: "Direct Msgs",
            channel_msg: "Channel Msgs",
            ack: "ACKs",
            path: "Path Updates",
            rx: "RF Packets",
            request_rx: "Requests",
            textmsg_rx: "Text Msgs",
            advert: "Adverts",
            direct_rx: "Direct",
          };
          return (
            <button
              key={type}
              className={`${styles.filterPill} ${filter === type ? styles.active : ""}`}
              onClick={() => setFilter(type)}
            >
              {labels[type]}
            </button>
          );
        })}
        <select
          className={styles.timeSelect}
          value={timeWindow}
          onChange={(e) => setTimeWindow(e.target.value)}
        >
          <option value="0">All time</option>
          <option value="15">Last 15 min</option>
          <option value="60">Last 1 hour</option>
          <option value="360">Last 6 hours</option>
        </select>
        <input
          className={styles.pktSearch}
          type="search"
          placeholder="Search…"
          value={search}
          onInput={(e) => setSearch(e.target.value)}
        />
        <button
          className={`${styles.rawToggleBtn} ${rawMode ? styles.active : ""}`}
          onClick={() => setRawMode(!rawMode)}
        >
          RAW
        </button>
        <span className={styles.liveBadge}>
          <span className={styles.liveDot}></span> Live
        </span>
      </div>

      <div className={styles.packetsList}>
        <div
          style={{
            fontSize: "0.75rem",
            color: "#64748b",
            margin: "0.2rem 0",
            textAlign: "right",
          }}
        >
          {filteredEvents.length} event{filteredEvents.length !== 1 ? "s" : ""}
        </div>

        {filteredEvents.length === 0 ? (
          <div className={styles.emptyState}>
            {filter === "all"
              ? "Waiting for mesh activity…"
              : `No ${filter === "advert" ? "Advert" : badgeLabel(filter)} events yet`}
          </div>
        ) : (
          filteredEvents.map((evt) => {
            const rxBadge =
              evt.type === "rx" && evt.pkt_type && _RX_BADGE[evt.pkt_type];
            return (
              <div
                key={`${evt.ts}_${evt.type}_${evt.raw}`}
                className={styles.packetRow}
              >
                <div className={styles.pktTime}>{fmtTime(evt.ts)}</div>
                {rxBadge ? (
                  <span className={`${styles.pktBadge} ${rxBadge.cls}`}>
                    {rxBadge.label}
                  </span>
                ) : (
                  <span
                    className={`${styles.pktBadge} ${badgeClass(evt.type)}`}
                  >
                    {badgeLabel(evt.type)}
                  </span>
                )}

                <div className={styles.pktBody}>
                  {evt.type === "contact_msg" && (
                    <>
                      <div className={styles.pktText}>
                        → {evt.sender || "Unknown"}
                      </div>
                      {evt.text && (
                        <div style={{ color: "#94a3b8" }}>{evt.text}</div>
                      )}
                      <div className={styles.pktMeta}>
                        {evt.hops >= 0
                          ? `${evt.hops} hop${evt.hops !== 1 ? "s" : ""}`
                          : "? hops"}
                      </div>
                    </>
                  )}
                  {evt.type === "channel_msg" && (
                    <>
                      <div className={styles.pktText}>
                        {evt.channel || "Ch?"} • {evt.sender || "Unknown"}
                      </div>
                      {evt.text && (
                        <div style={{ color: "#94a3b8" }}>{evt.text}</div>
                      )}
                      <div className={styles.pktMeta}>
                        {evt.hops >= 0
                          ? `${evt.hops} hop${evt.hops !== 1 ? "s" : ""}`
                          : "? hops"}
                      </div>
                    </>
                  )}
                  {evt.type === "ack" && (
                    <>
                      <div className={styles.pktText}>
                        Message confirmed seen by {evt.seen_by || 1} node
                        {evt.seen_by !== 1 ? "s" : ""}
                      </div>
                      {evt.ack_code && (
                        <div className={styles.pktMeta}>
                          code: {evt.ack_code}
                        </div>
                      )}
                    </>
                  )}
                  {evt.type === "path" && (
                    <>
                      <div className={styles.pktText}>
                        {evt.name || evt.pubkey || "?"} —{" "}
                        {evt.hops >= 0
                          ? `${evt.hops} hop${evt.hops !== 1 ? "s" : ""}`
                          : "? hops"}
                      </div>
                      {evt.route && (
                        <div className={styles.pktMeta}>{evt.route}</div>
                      )}
                    </>
                  )}
                  {evt.type === "advert_sent" && (
                    <>
                      <div className={styles.pktText}>
                        Sent floodadv → {evt.name || evt.pubkey || "?"}
                      </div>
                      <div className={styles.pktMeta}>
                        Repeater commanded to broadcast flood advertisement
                      </div>
                    </>
                  )}
                  {evt.type === "rx" && (
                    <>
                      <div className={styles.pktText}>
                        {evt.pkt_type || "RF Packet"}
                        {evt.node ? ` • ${evt.node}` : ""}
                      </div>
                      {evt.path && evt.path.length > 0 && (
                        <div className={styles.pktPath}>
                          {evt.path.map((hop, i) => (
                            <span
                              key={i}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                              }}
                            >
                              {i > 0 && (
                                <span className={styles.pathArrow}>
                                  {"\u2192"}
                                </span>
                              )}
                              <span
                                className={`${styles.pathChip} ${hop.name && hop.name !== hop.id ? styles.pathChipNamed : ""}`}
                                title={
                                  hop.name && hop.name !== hop.id
                                    ? hop.name
                                    : ""
                                }
                              >
                                {hop.id.slice(0, nodeIdChars)}
                              </span>
                            </span>
                          ))}
                          <span className={styles.pathArrow}>
                            {"\u2192"} [You]
                          </span>
                        </div>
                      )}
                      <div className={styles.pktMeta}>
                        {[
                          evt.snr != null && `SNR ${evt.snr} dB`,
                          evt.rssi != null && `RSSI ${evt.rssi} dBm`,
                        ]
                          .filter(Boolean)
                          .join(" • ")}
                      </div>

                      {evt.pkt_type === "Advert" && evt.advert && (
                        <div className={styles.advertDecoded}>
                          {evt.advert.name && (
                            <>
                              <span className={styles.advertDecodedKey}>
                                Name
                              </span>
                              <span className={styles.advertDecodedVal}>
                                {evt.advert.name}
                              </span>
                            </>
                          )}
                          {evt.advert.pubkey && (
                            <>
                              <span className={styles.advertDecodedKey}>
                                Pubkey
                              </span>
                              <span className={styles.advertDecodedVal}>
                                {evt.advert.pubkey.slice(0, 16)}…
                              </span>
                            </>
                          )}
                          {evt.advert.ts && (
                            <>
                              <span className={styles.advertDecodedKey}>
                                Timestamp
                              </span>
                              <span className={styles.advertDecodedVal}>
                                {new Date(
                                  evt.advert.ts * 1000,
                                ).toLocaleString()}
                              </span>
                            </>
                          )}
                          {evt.advert.flags != null && (
                            <>
                              <span className={styles.advertDecodedKey}>
                                App flags
                              </span>
                              <span className={styles.advertDecodedVal}>
                                0x
                                {evt.advert.flags
                                  .toString(16)
                                  .toUpperCase()
                                  .padStart(2, "0")}
                              </span>
                            </>
                          )}
                          {evt.advert.lat != null &&
                            evt.advert.lon != null &&
                            (evt.advert.lat !== 0 || evt.advert.lon !== 0) && (
                              <>
                                <span className={styles.advertDecodedKey}>
                                  Latitude
                                </span>
                                <span className={styles.advertDecodedVal}>
                                  {evt.advert.lat.toFixed(6)}°
                                </span>
                                <span className={styles.advertDecodedKey}>
                                  Longitude
                                </span>
                                <span className={styles.advertDecodedVal}>
                                  {evt.advert.lon.toFixed(6)}°
                                </span>
                              </>
                            )}
                        </div>
                      )}

                      {evt.raw &&
                        (rawMode ? (
                          <div
                            className={styles.pktHexSeg}
                            style={{ color: "#64748b" }}
                          >
                            {evt.raw}
                          </div>
                        ) : (
                          renderHexSegments(evt)
                        ))}
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
