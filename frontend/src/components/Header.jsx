import { useState, useEffect } from "preact/hooks";
import { Link } from "wouter";

export default function Header() {
  const [conn, setConn] = useState({
    connected: false,
    host: "",
    battery_mv: 0,
    polling_enabled: false,
    last_connected: 0,
  });
  const [unreadBadge, setUnreadBadge] = useState(false);
  const [ntfy, setNtfy] = useState({ show: false, enabled: true });

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((s) => {
        if (s.ntfy_topic) {
          setNtfy({ show: true, enabled: s.ntfy_enabled !== false });
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const pollConn = () => {
      fetch("/api/connection")
        .then((res) => res.json())
        .then(setConn)
        .catch(() => {});
    };
    pollConn();
    const interval = setInterval(pollConn, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const checkUnread = () => {
      const lastSeen = parseFloat(
        localStorage.getItem("meshcore_last_msg_seen") || "0",
      );
      fetch("/api/messages?hours=48&limit=1")
        .then((res) => res.json())
        .then((msgs) => {
          setUnreadBadge(msgs.length > 0 && msgs[0].timestamp > lastSeen);
        })
        .catch(() => {});
    };
    checkUnread();
    const interval = setInterval(checkUnread, 30000);
    return () => clearInterval(interval);
  }, []);

  const togglePolling = () => {
    fetch("/api/polling/toggle", { method: "POST" })
      .then((res) => res.json())
      .then((d) =>
        setConn((prev) => ({ ...prev, polling_enabled: d.polling_enabled })),
      )
      .catch(() => {});
  };

  const markMessagesSeen = () => {
    localStorage.setItem(
      "meshcore_last_msg_seen",
      (Date.now() / 1000).toString(),
    );
    setUnreadBadge(false);
  };

  const toggleNtfy = () => {
    fetch("/api/ntfy/toggle", { method: "POST" })
      .then((res) => res.json())
      .then((res) => {
        if (res.ok) {
          setNtfy((prev) => ({ ...prev, enabled: res.enabled }));
        }
      })
      .catch(() => {});
  };

  return (
    <header>
      <div className="header-title">
        <h1>MeshCore Repeater Monitor</h1>
        <div className="subtitle">LoRa Mesh Network Dashboard</div>
        <div className="header-meta">
          <div className="node-status">
            <span
              className={`status-dot ${conn.connected ? "online" : "offline"}`}
            ></span>
            <span>
              Node: {conn.connected ? conn.host || "connected" : "disconnected"}
            </span>
            {conn.connected && (
              <button
                onClick={togglePolling}
                style={{
                  marginLeft: "0.5rem",
                  background: "none",
                  border: `1px solid ${conn.polling_enabled === false ? "#f59e0b" : "#334155"}`,
                  color: conn.polling_enabled === false ? "#f59e0b" : "#94a3b8",
                  fontSize: "0.72rem",
                  padding: "0.15rem 0.5rem",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                {conn.polling_enabled === false
                  ? "▶ Resume Polling"
                  : "⏸ Pause Polling"}
              </button>
            )}
          </div>
          <span className="header-meta-sep">&mdash;</span>
          <div className="conn-status">
            <span
              className={`status-dot ${conn.connected ? "online" : "offline"}`}
            ></span>
            <span>{conn.connected ? "Connected" : "Connecting..."}</span>
          </div>
        </div>
      </div>
      <nav className="nav-group">
        <Link href="/" className="nav-btn">
          Dashboard
        </Link>
        <Link href="/map" className="nav-btn">
          Map
        </Link>
        <Link href="/messages" className="nav-btn" onClick={markMessagesSeen}>
          Messages{unreadBadge && <span className="msgs-unread-dot"></span>}
        </Link>
        <Link href="/packets" className="nav-btn">
          Packets
        </Link>
        <Link href="/logs" className="nav-btn">
          Logs
        </Link>
        {ntfy.show && (
          <button
            className={`nav-btn nav-ntfy-btn ${!ntfy.enabled ? "ntfy-disabled" : ""}`}
            onClick={toggleNtfy}
            title={
              ntfy.enabled
                ? "Notifications on — click to mute"
                : "Notifications muted — click to unmute"
            }
          >
            &#9993;
          </button>
        )}
        <Link href="/settings" className="nav-btn nav-settings">
          &#9881;
        </Link>
      </nav>
    </header>
  );
}
