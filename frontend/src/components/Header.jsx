import { useState, useEffect } from "preact/hooks";
import { Link, useLocation } from "wouter";
import styles from "./Header.module.css";


const HidingLink = ({ href, className, children, ...props }) => {
    const [location] = useLocation();
    const isActive = location === href;
    const combinedClassName = isActive 
      ? `${className || ""} sm-hidden` 
      : className;
    return (
      <Link href={href} className={combinedClassName} {...props}>
        {children}
      </Link>
    );
  };


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
        .catch(() => {
          setConn({...conn, connected: false});
        });
    };
    pollConn();
    const interval = setInterval(pollConn, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const checkUnread = () => {
      fetch("/api/new_messages")
        .then((res) => res.json())
        .then((r) => {
          setUnreadBadge(r.new);
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
    if (unreadBadge){
      setUnreadBadge(false);
      fetch("/api/new_messages", { method: "POST" })
        .catch(() => {});
    }
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
    <header className={styles.header}>
      <div className={`${styles["header-title"]}`}>
        <h1>MeshCore Repeater Monitor</h1>
        <div className={`${styles["subtitle"]}`}>LoRa Mesh Network Dashboard</div>
        <div className={`${styles["header-meta"]}`}>
          <div className={`${styles["node-status"]}`}>
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
          <span className={`${styles["header-meta-sep"]}`}>&mdash;</span>
          <div className={`${styles["conn-status"]}`}>
            <span
              className={`status-dot ${conn.connected ? "online" : "offline"}`}
            ></span>
            <span>{conn.connected ? "Connected" : "Connecting..."}</span>
          </div>
          <Link
            href="/settings"
            className={`nav-btn ${styles["nav-settings"]} ${styles["nav-settings-mobile"]}`}
          >
            &#9881;
          </Link>
        </div>
      </div>
      <nav className={`${styles["nav-group"]}`}>
        <HidingLink href="/" className={`nav-btn`}>
          Dashboard
        </HidingLink>
        <HidingLink href="/map" className={`nav-btn`}>
          Map
        </HidingLink>
        <HidingLink href="/messages" className={`nav-btn`} onClick={markMessagesSeen}>
          Messages{unreadBadge && <span className={`${styles["msgs-unread-dot"]}`}></span>}
        </HidingLink>
        <HidingLink href="/packets" className={`nav-btn`}>
          Packets
        </HidingLink>
        <HidingLink href="/logs" className={`nav-btn`}>
          Logs
        </HidingLink>
        {ntfy.show && (
          <button
            className={`nav-btn ${styles["nav-ntfy-btn"]} ${!ntfy.enabled ? styles["ntfy-disabled"] : ""}`}
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
        <Link
          href="/settings"
          className={`nav-btn ${styles["nav-settings"]} ${styles["nav-settings-desktop"]}`}
        >
          &#9881;
        </Link>
      </nav>
    </header>
  );
}
