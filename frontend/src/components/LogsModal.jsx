import { useState, useEffect } from "preact/hooks";

export default function LogsModal({ onClose }) {
  const [hours, setHours] = useState(24);
  const [level, setLevel] = useState("");
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [retention, setRetention] = useState(24);

  useEffect(() => {
    // Load retention setting
    fetch("/api/settings")
      .then((res) => res.json())
      .then((s) => setRetention(s.log_retention_hours || 24))
      .catch(() => {});
  }, []);

  const fetchLogs = () => {
    setLoading(true);
    let url = `/api/logs?hours=${hours}&limit=500`;
    if (level) url += `&level=${encodeURIComponent(level)}`;

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
  }, [hours, level]);

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
      .catch((err) => console.error("Failed to save retention:", err));
  };

  return (
    <div
      className="modal-overlay visible"
      onClick={(e) => {
        if (e.target.className.includes("modal-overlay")) onClose();
      }}
    >
      <div className="modal-content logs-panel">
        <div className="modal-header">
          <h2>Activity Logs</h2>
          <button className="modal-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="logs-controls">
          <div className="logs-filter-group">
            <label>Show last</label>
            <select
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
            >
              <option value="1">1 hour</option>
              <option value="6">6 hours</option>
              <option value="12">12 hours</option>
              <option value="24">24 hours</option>
              <option value="48">48 hours</option>
              <option value="168">7 days</option>
            </select>
          </div>
          <div className="logs-filter-group">
            <label>Level</label>
            <select value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="">All</option>
              <option value="ERROR">Error</option>
              <option value="WARNING">Warning</option>
              <option value="INFO">Info</option>
            </select>
          </div>
          <button
            className="btn btn-secondary logs-refresh-btn"
            onClick={fetchLogs}
          >
            Refresh
          </button>
        </div>
        <div className="logs-retention-setting">
          <label>Auto-delete logs older than</label>
          <input
            type="number"
            min="1"
            max="720"
            value={retention}
            onChange={(e) => setRetention(e.target.value)}
          />
          <span>hours</span>
          <button className="btn btn-secondary" onClick={saveRetention}>
            Save
          </button>
        </div>
        <div className="logs-table-wrap">
          <table className="logs-table">
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
                  <td colSpan="4" className="logs-empty">
                    Loading...
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan="4" className="logs-empty">
                    Failed to load logs: {error}
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan="4" className="logs-empty">
                    No log entries found for this time range.
                  </td>
                </tr>
              ) : (
                logs.map((entry, idx) => (
                  <tr
                    key={idx}
                    className={`log-row log-${entry.level.toLowerCase()}`}
                  >
                    <td className="log-time">
                      {new Date(entry.timestamp * 1000).toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </td>
                    <td className="log-level">{entry.level}</td>
                    <td className="log-source">{entry.logger}</td>
                    <td className="log-message">{entry.message}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
