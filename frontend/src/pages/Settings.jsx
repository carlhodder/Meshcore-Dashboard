import { useState, useEffect } from "preact/hooks";
import styles from "./Settings.module.css";

export default function Settings() {
  const [settings, setSettings] = useState(null);

  const [statusMsg, setStatusMsg] = useState({ text: "", error: false });
  const [updateFile, setUpdateFile] = useState(null);
  const [updateResult, setUpdateResult] = useState({ text: "", ok: false });

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((s) => {
        setSettings(s);
      })
      .catch(() => {});
  }, []);

  const handleChange = (e) => {
    const { id, value, type, checked } = e.target;
    setSettings((prev) => ({
      ...prev,
      [id]: type === "checkbox" ? checked : value,
    }));
  };

  const handleCompanionType = (e) => {
    const type = e.target.value;
    setSettings((prev) => ({
      ...prev,
      companion_type: type,
    }));
  };

  const addChannel = () => {
    setSettings((prev) => ({
      ...prev,
      channels: [...prev.channels, { name: "", idx: "" }],
    }));
  };

  const updateChannel = (i, key, val) => {
    setSettings((prev) => {
      const chs = [...prev.channels];
      chs[i][key] = val;
      return { ...prev, channels: chs };
    });
  };

  const removeChannel = (i) => {
    setSettings((prev) => ({
      ...prev,
      channels: prev.channels.filter((_, idx) => idx !== i),
    }));
  };

  const addRepeater = () => {
    setSettings((prev) => ({
      ...prev,
      repeaters: [
        ...prev.repeaters,
        { name: "", pubkey: "", admin_pass: "", path: "", lat: "", lon: "" },
      ],
    }));
  };

  const updateRepeater = (i, key, val) => {
    setSettings((prev) => {
      const rpts = [...prev.repeaters];
      rpts[i][key] = val;
      return { ...prev, repeaters: rpts };
    });
  };

  const removeRepeater = (i) => {
    setSettings((prev) => ({
      ...prev,
      repeaters: prev.repeaters.filter((_, idx) => idx !== i),
    }));
  };

  const moveRepeater = (i, dir) => {
    setSettings((prev) => {
      if (i + dir < 0 || i + dir >= prev.repeaters.length) return prev;
      const rpts = [...prev.repeaters];
      const temp = rpts[i];
      rpts[i] = rpts[i + dir];
      rpts[i + dir] = temp;
      return { ...prev, repeaters: rpts };
    });
  };

  const saveSettings = async () => {
    if (!settings.companion_host) {
      setStatusMsg({ text: "Companion IP is required", error: true });
      return;
    }
    const cleanChannels = settings.channels
      .map((c) => ({ name: c.name, idx: parseInt(c.idx) || 0 }))
      .filter((c) => c.name !== "" && c.idx !== "");
    const cleanRepeaters = [];
    for (let r of settings.repeaters) {
      if (r.name && r.pubkey) {
        const nr = { name: r.name, pubkey: r.pubkey, path: r.path };
        if (r.admin_pass) nr.admin_pass = r.admin_pass;
        if (r.lat) nr.lat = r.lat;
        if (r.lon) nr.lon = r.lon;
        cleanRepeaters.push(nr);
      } else if (r.name || r.pubkey) {
        setStatusMsg({
          text: "Each repeater needs both a name and public key",
          error: true,
        });
        return;
      }
    }

    const payload = {
      ...settings,
      channels: cleanChannels,
      repeaters: cleanRepeaters,
    };

    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.ok) {
        setStatusMsg({
          text: "Saved! Returning to dashboard...",
          error: false,
        });
        setTimeout(() => (window.location.href = "/"), 1200);
      } else {
        setStatusMsg({ text: data.error || "Save failed", error: true });
      }
    } catch (e) {
      setStatusMsg({ text: `Network error: ${e.message}`, error: true });
    }
  };

  const handleUpdateZip = (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    setUpdateFile(f);
    setUpdateResult({ text: "", ok: false });
  };

  const doUpdate = async () => {
    if (!updateFile) return;
    setUpdateResult({ text: "Uploading...", ok: false });
    const fd = new FormData();
    fd.append("file", updateFile);
    try {
      const res = await fetch("/api/update", { method: "POST", body: fd });
      const data = await res.json();
      if (data.ok) {
        setUpdateFile(null);
        setUpdateResult({
          text: `\u2713 ${data.files.length} files applied.`,
          ok: true,
        });
      } else {
        setUpdateResult({
          text: `Error: ${data.error}`,
          ok: false,
          isErr: true,
        });
      }
    } catch (e) {
      setUpdateResult({
        text: `Network error: ${e.message}`,
        ok: false,
        isErr: true,
      });
    }
  };

  const doRestart = () => {
    setUpdateResult({
      text: "Restarting \u2014 page will reload when server is back\u2026",
      ok: true,
    });
    fetch("/api/restart", { method: "POST" }).catch(() => {});
    const poll = () => {
      fetch("/")
        .then((r) => {
          if (r.ok) window.location.href = "/";
          else setTimeout(poll, 2000);
        })
        .catch(() => setTimeout(poll, 2000));
    };
    setTimeout(poll, 2000);
  };

  return (
    settings && (
      <div className={styles.settingsPageBody}>
        <div className={styles.settingsSection}>
          <h3>Companion Device</h3>
          <div className={styles.settingsRow}>
            <div className={styles.settingsField}>
              <div className={styles.settingsLabel}>Companion Type</div>
              <fieldset style={{ border: "none", margin: 0, padding: 0 }}>
                <input
                  type="radio"
                  id="type1"
                  value={1}
                  checked={settings.companion_type == 1}
                  onChange={handleCompanionType}
                  style={{ marginRight: "0.25rem" }}
                />
                <label htmlFor="type1" style={{ marginRight: "1rem" }}>
                  Serial/USB
                </label>
                <input
                  type="radio"
                  id="type2"
                  value={2}
                  checked={settings.companion_type == 2}
                  onChange={handleCompanionType}
                  style={{ marginRight: "0.25rem" }}
                />
                <label htmlFor="type2">TCP</label>
              </fieldset>
            </div>
          </div>
          <div className={styles.settingsRow}>
            <div className={styles.settingsField}>
              <label>
                {settings.companion_type == 1 ? "Serial/USB" : "IP Address"}
              </label>
              <input
                type="text"
                id="companion_host"
                value={settings.companion_host}
                onChange={handleChange}
                placeholder={
                  settings.companion_type == 1
                    ? "/dev/ttyACMX or COMX"
                    : "192.168.0.100"
                }
              />
            </div>
            {settings.companion_type === "2" && (
              <div
                className={`${styles.settingsField} ${styles.settingsFieldSmall}`}
              >
                <label>Port</label>
                <input
                  type="number"
                  id="companion_port"
                  value={settings.companion_port}
                  onChange={handleChange}
                />
              </div>
            )}
          </div>
        </div>

        <div className={styles.settingsSection}>
          <h3>Polling Timing</h3>
          <div className={styles.settingsRow}>
            <div className={styles.settingsField}>
              <label>Poll Cycle (hours)</label>
              <input
                type="number"
                id="poll_interval_hours"
                value={settings.poll_interval_hours}
                onChange={handleChange}
              />
            </div>
            <div className={styles.settingsField}>
              <label>Stagger Delay (seconds)</label>
              <input
                type="number"
                id="stagger_delay_seconds"
                value={settings.stagger_delay_seconds}
                onChange={handleChange}
              />
            </div>
            <div
              className={`${styles.settingsField} ${styles.settingsFieldSmall}`}
            >
              <label>Low Batt %</label>
              <input
                type="number"
                id="low_battery_percent"
                value={settings.low_battery_percent}
                onChange={handleChange}
              />
            </div>
          </div>
        </div>

        <div className={styles.settingsSection}>
          <h3>Neighbours</h3>
          <div className={styles.settingsRow}>
            <div
              className={styles.settingsField}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: "0.5rem",
              }}
            >
              <input
                type="checkbox"
                id="neighbours_enabled"
                checked={settings.neighbours_enabled}
                onChange={handleChange}
              />
              <label style={{ margin: 0, padding: 0 }}>Enable</label>
            </div>
            <div className={styles.settingsField}>
              <label>Interval (hours)</label>
              <input
                type="number"
                id="neighbours_check_hours"
                value={settings.neighbours_check_hours}
                onChange={handleChange}
              />
            </div>
          </div>
        </div>

        <div className={styles.settingsSection}>
          <h3>Device Clock/time</h3>
          <div className={styles.settingsRow}>
            <div
              className={styles.settingsField}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: "0.5rem",
              }}
            >
              <input
                type="checkbox"
                id="clock_check_enabled"
                checked={settings.clock_check_enabled}
                onChange={handleChange}
              />
              <label style={{ margin: 0, padding: 0 }}>Enable</label>
            </div>
            <div className={styles.settingsField}>
              <label>Interval (days)</label>
              <input
                type="number"
                id="clock_check_days"
                value={settings.clock_check_days}
                onChange={handleChange}
              />
            </div>
          </div>
        </div>

        <div className={styles.settingsSection}>
          <h3>Device Firmware Version</h3>
          <div className={styles.settingsRow}>
            <div
              className={styles.settingsField}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: "0.5rem",
              }}
            >
              <input
                type="checkbox"
                id="firmware_get_enabled"
                checked={settings.firmware_get_enabled}
                onChange={handleChange}
              />
              <label style={{ margin: 0, padding: 0 }}>Enable</label>
            </div>
            <div className={styles.settingsField}>
              <label>Interval (days)</label>
              <input
                type="number"
                id="firmware_get_days"
                value={settings.firmware_get_days}
                onChange={handleChange}
              />
            </div>
          </div>
        </div>

        <div className={styles.settingsSection}>
          <h3>Map</h3>
          <div className={styles.settingsRow}>
            <div className={styles.settingsField}>
              <label>Max path segment distance (km)</label>
              <input
                type="number"
                id="map_path_max_km"
                value={settings.map_path_max_km}
                onChange={handleChange}
              />
            </div>
            <div
              className={`${styles.settingsField} ${styles.settingsFieldSmall}`}
            >
              <label>Node ID depth</label>
              <select
                id="node_id_chars"
                value={settings.node_id_chars}
                onChange={handleChange}
              >
                <option value={2}>1 byte (2 chars)</option>
                <option value={4}>2 bytes (4 chars)</option>
                <option value={6}>3 bytes (6 chars)</option>
              </select>
            </div>
          </div>
        </div>

        <div className={styles.settingsSection}>
          <h3>Channels</h3>
          <div>
            {settings.channels.map((ch, i) => (
              <div className={styles.repeaterRow} key={`ch_${i}`}>
                <div className={styles.settingsField}>
                  <label>Name</label>
                  <input
                    type="text"
                    value={ch.name}
                    onInput={(e) => updateChannel(i, "name", e.target.value)}
                  />
                </div>
                <div
                  className={`${styles.settingsField} ${styles.settingsFieldSmall}`}
                >
                  <label>Channel #</label>
                  <input
                    type="number"
                    value={ch.idx}
                    onInput={(e) => updateChannel(i, "idx", e.target.value)}
                  />
                </div>
                <button
                  className={styles.btnRemove}
                  onClick={() => removeChannel(i)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <button className={styles.btnAdd} onClick={addChannel}>
            + Add Channel
          </button>
        </div>

        <div className={styles.settingsSection}>
          <h3>Repeaters</h3>
          <div>
            {settings.repeaters.map((r, i) => {
              return (
                <div className={styles.repeaterRow} key={`rpt_${i}`}>
                  <div className={styles.rptMoveBtns}>
                    <button
                      className={styles.cardMoveBtn}
                      onClick={() => moveRepeater(i, -1)}
                    >
                      ↑
                    </button>
                    <button
                      className={styles.cardMoveBtn}
                      onClick={() => moveRepeater(i, 1)}
                    >
                      ↓
                    </button>
                  </div>
                  <div
                    style={{
                      flex: 1,
                      display: "grid",
                      gridTemplateColumns: "repeat(4, 1fr)",
                      gap: "0.5rem",
                      alignItems: "flex-end",
                    }}
                  >
                    <div
                      className={styles.settingsField}
                      style={{ gridColumn: "span 1" }}
                    >
                      <label>Name</label>
                      <input
                        type="text"
                        value={r.name}
                        onInput={(e) =>
                          updateRepeater(i, "name", e.target.value)
                        }
                      />
                    </div>
                    <div
                      className={styles.settingsField}
                      style={{ gridColumn: "span 3" }}
                    >
                      <label>Public Key</label>
                      <input
                        type="text"
                        value={r.pubkey}
                        onInput={(e) =>
                          updateRepeater(i, "pubkey", e.target.value)
                        }
                      />
                    </div>
                    <div className={styles.settingsField}>
                      <label>Admin Pass</label>
                      <input
                        type="text"
                        value={r.admin_pass || ""}
                        onInput={(e) =>
                          updateRepeater(i, "admin_pass", e.target.value)
                        }
                      />
                    </div>
                    <div className={styles.settingsField}>
                      <label>Path</label>
                      <input
                        type="text"
                        value={r.path || ""}
                        onInput={(e) =>
                          updateRepeater(i, "path", e.target.value)
                        }
                      />
                    </div>
                    <div className={styles.settingsField}>
                      <label>Default lat</label>
                      <input
                        type="text"
                        value={r.lat || ""}
                        onInput={(e) =>
                          updateRepeater(i, "lat", e.target.value)
                        }
                      />
                    </div>
                    <div className={styles.settingsField}>
                      <label>Default lon</label>
                      <input
                        type="text"
                        value={r.lon || ""}
                        onInput={(e) =>
                          updateRepeater(i, "lon", e.target.value)
                        }
                      />
                    </div>
                  </div>
                  <button
                    className={styles.btnRemove}
                    style={{ alignSelf: "flex-start", marginTop: "3.25rem" }}
                    onClick={() => removeRepeater(i)}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
          <button className={styles.btnAdd} onClick={addRepeater}>
            + Add Repeater
          </button>
        </div>

        <div className={styles.settingsSection}>
          <h3>Push Notifications (ntfy)</h3>
          <div className={styles.settingsField}>
            <div className={styles.settingsLabel}>ntfy Topic</div>
            <input
              type="text"
              id="ntfy_topic"
              value={settings.ntfy_topic}
              onChange={handleChange}
            />
          </div>
          <div className={styles.settingsField} style={{ marginTop: "0.6rem" }}>
            <div className={styles.settingsLabel}>ntfy Server</div>
            <input
              type="text"
              id="ntfy_server"
              value={settings.ntfy_server}
              onChange={handleChange}
            />
          </div>
          <div className={styles.settingsField} style={{ marginTop: "0.6rem" }}>
            <div className={styles.settingsLabel}>Dashboard URL</div>
            <input
              type="text"
              id="dashboard_url"
              value={settings.dashboard_url}
              onChange={handleChange}
            />
          </div>
        </div>

        <div className={styles.settingsSection}>
          <h3>Software Update</h3>
          <div className={styles.updateRow}>
            <input
              type="file"
              id="updateZipInput"
              accept=".zip"
              style={{ display: "none" }}
              onChange={handleUpdateZip}
            />
            <button
              className="btn btn-secondary"
              onClick={() => document.getElementById("updateZipInput").click()}
            >
              Choose .zip…
            </button>
            <span className={styles.updateZipName}>
              {updateFile
                ? `${updateFile.name} (${Math.round(updateFile.size / 1024)} KB)`
                : "No file chosen"}
            </span>
            <button
              className="btn btn-secondary"
              disabled={!updateFile}
              onClick={doUpdate}
            >
              Upload & Apply
            </button>
          </div>
          {updateResult.text && (
            <div
              className={`${styles.updateResult} ${updateResult.isErr ? styles.err : ""}`}
            >
              {updateResult.text}
              {updateResult.ok && (
                <button
                  className="btn btn-primary"
                  style={{
                    padding: "0.2rem 0.7rem",
                    fontSize: "0.8rem",
                    marginLeft: "1rem",
                  }}
                  onClick={doRestart}
                >
                  Restart Now
                </button>
              )}
            </div>
          )}
        </div>

        <div className={styles.settingsActions}>
          <span
            className={`${styles.settingsStatus} ${statusMsg.error ? styles.settingsStatusError : styles.settingsStatusOk}`}
          >
            {statusMsg.text}
          </span>
          <button className="btn btn-primary" onClick={saveSettings}>
            Save & Apply
          </button>
        </div>
      </div>
    )
  );
}
