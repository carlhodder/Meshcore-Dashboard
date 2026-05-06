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
    <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 1rem" }}>
      <div
        style={{
          display: "flex",
          gap: "0.75rem",
          alignItems: "flex-end",
          flexWrap: "wrap",
          marginBottom: "0.75rem",
          marginTop: "1rem",
        }}
      >
        <div
          style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}
        >
          <label
            style={{
              fontSize: "0.7rem",
              color: "#94a3b8",
              textTransform: "uppercase",
            }}
          >
            Show last
          </label>
          <select
            style={{
              background: "#0f172a",
              border: "1px solid #334155",
              color: "#e2e8f0",
              padding: "0.4rem 0.5rem",
              borderRadius: "6px",
            }}
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
        <div
          style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}
        >
          <label
            style={{
              fontSize: "0.7rem",
              color: "#94a3b8",
              textTransform: "uppercase",
            }}
          >
            Level
          </label>
          <select
            style={{
              background: "#0f172a",
              border: "1px solid #334155",
              color: "#e2e8f0",
              padding: "0.4rem 0.5rem",
              borderRadius: "6px",
            }}
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
        <div
          style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}
        >
          <label
            style={{
              fontSize: "0.7rem",
              color: "#94a3b8",
              textTransform: "uppercase",
            }}
          >
            Search
          </label>
          <input
            type="text"
            placeholder="Filter by message..."
            style={{
              background: "#0f172a",
              border: "1px solid #334155",
              color: "#e2e8f0",
              padding: "0.4rem 0.5rem",
              borderRadius: "6px",
              minWidth: "180px",
            }}
            value={search}
            onInput={(e) => setSearch(e.target.value)}
          />
        </div>
        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            gap: "0.5rem",
            alignItems: "flex-end",
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
              fontSize: "0.78rem",
              color: "#94a3b8",
              cursor: "pointer",
              padding: "0.4rem 0.6rem",
              border: "1px solid #334155",
              borderRadius: "6px",
            }}
          >
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              style={{ accentColor: "#38bdf8" }}
            />
            Auto-refresh
          </label>
          <button className={`btn btn-secondary`} onClick={fetchLogs}>
            Refresh
          </button>
          <button className={`btn btn-secondary`} onClick={exportCsv}>
            Export CSV
          </button>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          fontSize: "0.75rem",
          color: "#64748b",
          marginBottom: "0.75rem",
          padding: "0.5rem 0.75rem",
          background: "#0f172a",
          borderRadius: "6px",
        }}
      >
        <label style={{ color: "#94a3b8" }}>Auto-delete logs older than</label>
        <input
          type="number"
          min="1"
          max="720"
          value={retention}
          onChange={(e) => setRetention(e.target.value)}
          style={{
            background: "#1e293b",
            border: "1px solid #334155",
            color: "#e2e8f0",
            padding: "0.25rem 0.4rem",
            borderRadius: "4px",
            width: "60px",
            textAlign: "center",
          }}
        />
        <span>hours</span>
        <button
          className={`btn btn-secondary`}
          onClick={saveRetention}
          style={{ padding: "0.25rem 0.6rem", fontSize: "0.75rem" }}
        >
          Save
        </button>
        <span
          style={{
            marginLeft: "0.25rem",
            color: retentionStatus === "Saved!" ? "#22c55e" : "#ef4444",
          }}
        >
          {retentionStatus}
        </span>
      </div>

      <div
        style={{
          border: "1px solid #334155",
          borderRadius: "8px",
          overflow: "auto",
          maxHeight: "calc(100vh - 280px)",
        }}
      >
        <table
          className={`${styles["logs-table"]}`}
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "0.78rem",
          }}
        >
          <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
            <tr>
              <th
                style={{
                  background: "#334155",
                  color: "#94a3b8",
                  padding: "0.5rem 0.6rem",
                  textAlign: "left",
                }}
              >
                Time
              </th>
              <th
                style={{
                  background: "#334155",
                  color: "#94a3b8",
                  padding: "0.5rem 0.6rem",
                  textAlign: "left",
                }}
              >
                Level
              </th>
              <th
                style={{
                  background: "#334155",
                  color: "#94a3b8",
                  padding: "0.5rem 0.6rem",
                  textAlign: "left",
                }}
              >
                Source
              </th>
              <th
                style={{
                  background: "#334155",
                  color: "#94a3b8",
                  padding: "0.5rem 0.6rem",
                  textAlign: "left",
                }}
              >
                Message
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan="4"
                  style={{
                    textAlign: "center",
                    padding: "2rem",
                    color: "#475569",
                  }}
                >
                  Loading...
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td
                  colSpan="4"
                  style={{
                    textAlign: "center",
                    padding: "2rem",
                    color: "#ef4444",
                  }}
                >
                  Failed to load logs: {error}
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td
                  colSpan="4"
                  style={{
                    textAlign: "center",
                    padding: "2rem",
                    color: "#475569",
                  }}
                >
                  No log entries found.
                </td>
              </tr>
            ) : (
              logs.map((entry, idx) => (
                <tr
                  key={idx}
                  className={`${styles["log-row"]} ${styles["log-" + entry.level.toLowerCase()]}`}
                >
                  <td
                    className={`${styles["log-time"]}`}
                    style={{
                      padding: "0.3rem 0.6rem",
                      borderBottom: "1px solid #1e293b",
                      whiteSpace: "nowrap",
                      color: "#94a3b8",
                    }}
                  >
                    {new Date(entry.timestamp * 1000).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </td>
                  <td
                    className={`${styles["log-level"]}`}
                    style={{
                      padding: "0.3rem 0.6rem",
                      borderBottom: "1px solid #1e293b",
                      fontWeight: "600",
                    }}
                  >
                    {entry.level}
                  </td>
                  <td
                    className={`${styles["log-source"]}`}
                    style={{
                      padding: "0.3rem 0.6rem",
                      borderBottom: "1px solid #1e293b",
                      color: "#64748b",
                    }}
                  >
                    {entry.logger}
                  </td>
                  <td
                    className={`${styles["log-message"]}`}
                    style={{
                      padding: "0.3rem 0.6rem",
                      borderBottom: "1px solid #1e293b",
                      color: "#e2e8f0",
                    }}
                  >
                    {entry.message}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div
        style={{
          fontSize: "0.72rem",
          color: "#64748b",
          textAlign: "right",
          marginTop: "0.4rem",
        }}
      >
        {logs.length > 0 && `${logs.length} entries`}
      </div>
    </div>
  );
}
