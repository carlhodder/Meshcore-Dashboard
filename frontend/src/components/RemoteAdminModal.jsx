import { useState, useRef, useEffect } from "preact/hooks";
import styles from "./RemoteAdminModal.module.css";

export default function RemoteAdminModal({ pubkey, name, onClose }) {
  const [lines, setLines] = useState([]);
  const [cmd, setCmd] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const outputRef = useRef(null);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [lines]);

  const addLine = (text, isError = false) => {
    setLines((prev) => [...prev, { text, isError }]);
  };

  const handleLogin = async () => {
    setIsLoading(true);
    addLine(`> Logging in to ${name}...`);
    try {
      const res = await fetch(`/api/cli_login/${encodeURIComponent(pubkey)}`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.ok) {
        setIsLoggedIn(true);
        addLine("Login successful.");
      } else {
        addLine(`Error: ${data.error || "Login failed"}`, true);
      }
    } catch (err) {
      addLine(`Error: ${err.message}`, true);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSend = async () => {
    if (!cmd ||!cmd.trim() || !isLoggedIn) return;
    cmd = cmd.trim()

    // Add warnings for a couple of commands that could leave you stranded
    if (cmd.toLowerCase() == 'set repeat off') {
      if (!confirm("WARNING: This will also stop responding to login/commands if they hop, only direct connections will work after this. Are you sure?")){
        return;
      }
    }
    if (cmd.toLowerCase() == 'start ota') {
      if (!confirm("WARNING: This can leave the repeater in a broken state, are you sure? (and if nrf52 did you flash the bootloader first?)")){
        return;
      }
    }
    setCmd("");
    setIsLoading(true);
    addLine(`> ${cmd}`);

    try {
      const res = await fetch(
        `/api/cli_cmd/${encodeURIComponent(pubkey)}/${encodeURIComponent(cmd)}`,
        {
          method: "POST",
        },
      );
      const data = await res.json();
      if (data.ok) {
        if (data.text) {
          addLine(data.text);
        } else {
          addLine("Command sent successfully (no output).");
        }
      } else {
        addLine(`Error: ${data.error || "Command failed"}`, true);
      }
    } catch (err) {
      addLine(`Error: ${err.message}`, true);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !isLoading && isLoggedIn && cmd.trim()) {
      handleSend();
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>Remote Admin: {name}</h2>
          <button className={styles["close-btn"]} onClick={onClose}>
            &times;
          </button>
        </div>
        <div className={styles["terminal-window"]}>
          <div className={styles["output-area"]} ref={outputRef}>
            <div style={{ marginTop: "auto" }}>
              {lines.map((line, i) => (
                <div
                  key={i}
                  className={`${styles.line} ${line.isError ? styles["error-line"] : ""}`}
                >
                  {line.text}
                </div>
              ))}
            </div>
          </div>
          <div className={styles["input-area"]}>
            <span className={styles.prompt}>{">"}</span>
            <input
              type="text"
              className={styles.input}
              value={cmd}
              onInput={(e) => setCmd(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={!isLoggedIn || isLoading}
              autoFocus
            />
            <div className={styles.actions}>
              <button
                className={`${styles.btn} ${styles["btn-primary"]}`}
                onClick={handleSend}
                disabled={!isLoggedIn || isLoading || !cmd.trim()}
              >
                Send
              </button>
              <button
                className={styles.btn}
                onClick={handleLogin}
                disabled={isLoggedIn || isLoading}
              >
                {isLoggedIn ? "logged in" : "Login"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
