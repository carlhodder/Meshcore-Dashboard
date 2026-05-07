import { useState, useEffect } from "preact/hooks";
import styles from "./Logs.module.css";

export default function Logs() {
  const [hours, setHours] = useState(24);
  const [level, setLevel] = useState("");
  const [search, setSearch] = useState("");
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [retention, setRetention] = useState(24);
  const [retentionStatus, setRetentionStatus] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((s) => setRetention(s.log_retention_hours || 24))
      .catch(() => {});
  }, []);

  const fetchLogs = () => {
    setLoading(true);
    let url = `/api/logs?hours=${hours}&limit=1000`;
    if (level) url += `&level=${encodeURIComponent(level)}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;

    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        setLogs(data || []);
        setLoading(false);
        setError(null);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchLogs();
  }, [hours, level, search]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchLogs, 10000);
    return () => clearInterval(interval);
  }, [autoRefresh, hours, level, search]);

  const saveRetention = () => {
    let retVal = parseInt(retention) || 24;
    if (retVal < 1) retVal = 1;
    if (retVal > 720) retVal = 720;

    fetch("/api/settings")
      .then((r) => r.json())
      .then((s) => {
        s.log_retention_hours = retVal;
        return fetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(s),
        });
      })
      .then((r) => r.json())
      .then((res) => {
        if (res.ok) {
          setRetentionStatus("Saved!");
          setTimeout(() => setRetentionStatus(""), 2000);
        } else {
          setRetentionStatus(res.error || "Save failed");
        }
      })
      .catch(() => setRetentionStatus("Error saving"));
  };

  const exportCsv = () => {
    if (!logs || logs.length === 0) {
      alert("No logs to export.");
      return;
    }
    const rows = [["Time", "Level", "Source", "Message"]];
    logs.forEach((e) => {
      const ts = new Date(e.timestamp * 1000).toISOString();
      rows.push([ts, e.level, e.logger, e.message]);
    });
    const csv = rows
      .map((r) =>
        r
          .map(
            (cell) => '"' + (cell || "").toString().replace(/"/g, '""') + '"',
          )
          .join(","),
      )
      .join("\r\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `meshcore-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={styles.container}>
      <div className={styles.controls}>
        <div className={styles["control-group"]}>
          <label className={styles["control-label"]}>Show last</label>
          <select
            className={styles["control-input"]}
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
          >
            <option value="1">1 hour</option>
            <option value="6">6 hours</option>
            <option value="12">12 hours</option>
            <option value="24">24 hours</option>
            <option value="48">48 hours</option>
            <option value="168">7 days</option>
            <option value="720">30 days</option>
          </select>
        </div>
        <div className={styles["control-group"]}>
          <label className={styles["control-label"]}>Level</label>
          <select
            className={styles["control-input"]}
            value={level}
            onChange={(e) => setLevel(e.target.value)}
          >
            <option value="">All</option>
            <option value="ERROR">Error</option>
            <option value="WARNING">Warning</option>
            <option value="INFO">Info</option>
            <option value="DEBUG">Debug</option>
          </select>
        </div>
        <div className={styles["control-group"]}>
          <label className={styles["control-label"]}>Search</label>
          <input
            type="text"
            placeholder="Filter by message..."
            className={`${styles["control-input"]} ${styles.search}`}
            value={search}
            onInput={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className={styles.actions}>
          <label className={styles["auto-refresh"]}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Auto-refresh
          </label>
          <button className="btn btn-secondary" onClick={fetchLogs}>
            Refresh
          </button>
          <button className="btn btn-secondary" onClick={exportCsv}>
            Export CSV
          </button>
        </div>
      </div>

      <div className={styles["retention-setting"]}>
        <label>Auto-delete logs older than</label>
        <input
          type="number"
          min="1"
          max="720"
          value={retention}
          onChange={(e) => setRetention(e.target.value)}
          className={styles["retention-input"]}
        />
        <span>hours</span>
        <button
          className={`btn btn-secondary ${styles["retention-btn"]}`}
          onClick={saveRetention}
        >
          Save
        </button>
        <span
          className={
            retentionStatus === "Saved!"
              ? styles["status-success"]
              : styles["status-error"]
          }
        >
          {retentionStatus}
        </span>
      </div>

      <div className={styles["table-wrap"]}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Time</th>
              <th>Level</th>
              <th>Source</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="4" className={styles["empty-cell"]}>
                  Loading...
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan="4" className={styles["error-cell"]}>
                  Failed to load logs: {error}
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan="4" className={styles["empty-cell"]}>
                  No log entries found.
                </td>
              </tr>
            ) : (
              logs.map((entry, idx) => (
                <tr
                  key={idx}
                  className={`${styles["log-row"]} ${styles["log-" + entry.level.toLowerCase()]}`}
                >
                  <td className={styles["log-time"]}>
                    {new Date(entry.timestamp * 1000).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </td>
                  <td className={styles["log-level"]}>{entry.level}</td>
                  <td className={styles["log-source"]}>{entry.logger}</td>
                  <td className={styles["log-message"]}>{entry.message}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className={styles.footer}>
        {logs.length > 0 && `${logs.length} entries`}
      </div>
    </div>
  );
}
