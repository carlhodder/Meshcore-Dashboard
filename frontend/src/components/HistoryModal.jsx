import { useState, useEffect, useRef } from "preact/hooks";

export default function HistoryModal({ pubkey, name, onClose }) {
  const [period, setPeriod] = useState("day");
  const [metricsDropdownOpen, setMetricsDropdownOpen] = useState(false);
  const [data, setData] = useState(null);
  const [items, setItems] = useState({});
  const [defaults, setDefaults] = useState([]);
  const [selectedMetrics, setSelectedMetrics] = useState([]);
  const chartRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!pubkey) return;
    let qs = "?hours=24";
    if (period === "week") qs = "?days=7";
    else if (period === "month") qs = "?months=1";
    else if (period === "year") qs = "?months=12";

    fetch("/api/history/" + encodeURIComponent(pubkey) + qs)
      .then((res) => res.json())
      .then((payload) => {
        setData(payload.data || []);
        setItems(payload.items || {});
        setDefaults(payload.defaults || []);
        setSelectedMetrics((prev) =>
          prev.length > 0 ? prev : payload.defaults || [],
        );
      })
      .catch((err) => console.error("History fetch error:", err));
  }, [pubkey, period]);

  useEffect(() => {
    if (!canvasRef.current || !data) return;

    if (chartRef.current) {
      chartRef.current.destroy();
    }

    if (data.length === 0) return;

    // Load Chart.js dynamically from CDN if not loaded, or assume it's loaded in index.html
    if (!window.Chart) return;

    const labels = data.map((d) => new Date(d.timestamp * 1000));
    const datasets = [];
    const colors = [
      "#22c55e",
      "#38bdf8",
      "#eab308",
      "#ef4444",
      "#a855f7",
      "#ec4899",
      "#f97316",
      "#14b8a6",
    ];

    selectedMetrics.forEach((key, j) => {
      const metricName = items[key] || key;
      const yData = data.map((d) => {
        if (key === "battery_mv") {
          const mv = d[key];
          if (mv <= 0) return 0;
          return Math.max(
            0,
            Math.min(100, Math.round(((mv - 3000) / (4200 - 3000)) * 100)),
          );
        }
        return d[key] != null ? d[key] : null;
      });

      let color = colors[j % colors.length];
      if (key === "battery_mv" || key === "battery_percent") color = "#22c55e";
      if (key === "rssi") color = "#38bdf8";
      if (key === "snr") color = "#eab308";

      const isSignal =
        key.includes("rssi") || key.includes("snr") || key.includes("noise");

      datasets.push({
        label: metricName,
        data: yData,
        borderColor: color,
        backgroundColor: color + "20",
        yAxisID: isSignal ? "ySignal" : "yBatt",
        tension: 0.3,
        pointRadius: 1,
        fill: key.includes("battery"),
      });
    });

    const ctx = canvasRef.current.getContext("2d");
    chartRef.current = new window.Chart(ctx, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        spanGaps: true,
        segment: {
          borderDash: (ctx) =>
            ctx.p0.skip || ctx.p1.skip ? [5, 5] : undefined,
        },
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { labels: { color: "#94a3b8" } } },
        scales: {
          x: {
            type: "time",
            ticks: { color: "#64748b" },
            grid: { color: "#1e293b" },
          },
          yBatt: {
            position: "left",
            title: { display: false },
            ticks: { color: "#94a3b8" },
            grid: { color: "#1e293b" },
          },
          ySignal: {
            position: "right",
            title: { display: false },
            ticks: { color: "#94a3b8" },
            grid: { drawOnChartArea: false },
          },
        },
      },
    });

    return () => {
      if (chartRef.current) chartRef.current.destroy();
    };
  }, [data, selectedMetrics, period, items]);

  const toggleMetric = (key) => {
    setSelectedMetrics((prev) =>
      prev.includes(key) ? prev.filter((m) => m !== key) : [...prev, key],
    );
  };

  if (!pubkey) return null;

  return (
    <div
      className="modal-overlay visible"
      onClick={(e) => {
        if (e.target.className.includes("modal-overlay")) onClose();
      }}
    >
      <div className="modal-content">
        <div className="modal-header">
          <h2>
            {name} -{" "}
            {period === "day"
              ? "24h"
              : period === "week"
                ? "1 Week"
                : period === "month"
                  ? "1 Month"
                  : "1 Year"}{" "}
            History
          </h2>
          <button className="modal-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div
          className="logs-controls"
          style={{
            marginBottom: "1rem",
            borderBottom: "none",
            paddingBottom: 0,
          }}
        >
          <div className="logs-filter-group">
            <label>Period</label>
            <select value={period} onChange={(e) => setPeriod(e.target.value)}>
              <option value="day">Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
              <option value="year">Year</option>
            </select>
          </div>
          <div className="logs-filter-group" style={{ position: "relative" }}>
            <label>Metrics</label>
            <button
              className="nav-btn"
              style={{
                padding: "0.4rem 0.5rem",
                background: "#0f172a",
                border: "1px solid #334155",
                fontSize: "0.8rem",
              }}
              onClick={() => setMetricsDropdownOpen(!metricsDropdownOpen)}
            >
              Select Metrics &darr;
            </button>
            {metricsDropdownOpen && (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  background: "#1e293b",
                  border: "1px solid #334155",
                  borderRadius: "6px",
                  padding: "0.5rem",
                  zIndex: 10,
                  width: "max-content",
                  maxHeight: "200px",
                  overflowY: "auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.4rem",
                  boxShadow: "0 4px 6px rgba(0,0,0,0.3)",
                }}
              >
                {Object.keys(items).map((key) => (
                  <label
                    key={key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      fontSize: "0.8rem",
                      color: "#e2e8f0",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedMetrics.includes(key)}
                      onChange={() => toggleMetric(key)}
                    />
                    {items[key]}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
        <div id="historyChartContainer">
          {!data || data.length === 0 ? (
            <p
              style={{ textAlign: "center", color: "#64748b", padding: "2rem" }}
            >
              No history data found for this period.
            </p>
          ) : (
            <canvas ref={canvasRef} height="250"></canvas>
          )}
        </div>
      </div>
    </div>
  );
}
