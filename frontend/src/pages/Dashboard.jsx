import { useState, useEffect, useRef } from "preact/hooks";
import styles from "./Dashboard.module.css";
import HistoryModal from "../components/HistoryModal";
import RemoteAdminModal from "../components/RemoteAdminModal";
import RepeaterCard from "../components/RepeaterCard/RepeaterCard";

export default function Dashboard() {
  const [repeaters, setRepeaters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [historyNode, setHistoryNode] = useState(null);
  const [remoteAdminNode, setRemoteAdminNode] = useState(null);
  const [menuOpen, setMenuOpen] = useState(null);
  const [pingStates, setPingStates] = useState({});
  const [lastPolledMenuOpen, setLastPolledMenuOpen] = useState(null);

  const dragItem = useRef(null);
  const dragOverItem = useRef(null);

  const handleSort = async () => {
    if (dragItem.current === null || dragOverItem.current === null) return;

    let _repeaters = [...repeaters];
    const draggedItemContent = _repeaters.splice(dragItem.current, 1)[0];
    _repeaters.splice(dragOverItem.current, 0, draggedItemContent);

    dragItem.current = null;
    dragOverItem.current = null;

    setRepeaters(_repeaters);

    try {
      const pubkeys = _repeaters.map((r) => r.pubkey);
      await fetch("/api/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pubkeys }),
      });
    } catch (err) {
      console.error("Failed to reorder repeaters", err);
    }
  };

  useEffect(() => {
    const handleClick = (e) => {
      if (!e.target.closest(".menu-container")) {
        setMenuOpen(null);
      }
      if (!e.target.closest(".popup-menu-poll-intervals")) {
        setLastPolledMenuOpen(null);
      }
    };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now() / 1000;
      setPingStates((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const pk in next) {
          if (next[pk].cooldown > 0) {
            const remaining = Math.max(
              0,
              Math.ceil(next[pk].cooldownEndTime - now),
            );
            if (remaining !== next[pk].cooldown) {
              next[pk] = { ...next[pk], cooldown: remaining };
              changed = true;
            }
          }
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Poll repeaters
  useEffect(() => {
    updateRepeaterData();
    const interval = setInterval(() => {
      updateRepeaterData();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const updateRepeaterData = async () => {
    fetch("/api/repeaters")
      .then((res) => res.json())
      .then((data) => {
        setRepeaters(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  };

  const pingRepeater = async (pubkey, e) => {
    e.stopPropagation();
    const now = Date.now() / 1000;
    setPingStates((prev) => ({
      ...prev,
      [pubkey]: { cooldown: 30, cooldownEndTime: now + 30, result: null },
    }));

    try {
      const res = await fetch(`/api/ping/${encodeURIComponent(pubkey)}`, {
        method: "POST",
      });
      const data = await res.json();
      setPingStates((prev) => ({
        ...prev,
        [pubkey]: { ...prev[pubkey], result: data.ok ? "ok" : "fail" },
      }));
    } catch (err) {
      console.error(err);
      setPingStates((prev) => ({
        ...prev,
        [pubkey]: { ...prev[pubkey], result: "fail" },
      }));
    }
  };

  const sendAdvert = async (pubkey, e) => {
    e.stopPropagation();
    setMenuOpen(null);
    try {
      await fetch(`/api/advert/${encodeURIComponent(pubkey)}`, {
        method: "POST",
      });
    } catch (err) {
      console.error(err);
    }
  };

  const setClock = async (pubkey, e) => {
    e.stopPropagation();
    setMenuOpen(null);
    try {
      await fetch(`/api/set_clock/${encodeURIComponent(pubkey)}`, {
        method: "POST",
      });
    } catch (err) {
      console.error(err);
    }
  };

  const togglePauseRepeater = async (pubkey, e) => {
    e.stopPropagation();
    try {
      await fetch(`/api/repeater/${pubkey}/pause`, { method: "POST" });
      await updateRepeaterData();
    } catch (err) {
      console.log(err);
    }
  };

  if (loading)
    return (
      <div className={styles["no-data"]}>
        <h2>Connecting...</h2>
      </div>
    );

  const prefixToName = {};
  repeaters.forEach((rep) => {
    if (rep.pubkey) prefixToName[rep.pubkey.substring(0, 2)] = rep.name;
  });

  return (
    <>
      <div className={styles.grid} id="repeaterGrid">
        {repeaters.map((r, index) => (
          <RepeaterCard
            key={r.pubkey}
            r={r}
            index={index}
            prefixToName={prefixToName}
            dragItem={dragItem}
            dragOverItem={dragOverItem}
            handleSort={handleSort}
            setHistoryNode={setHistoryNode}
            lastPolledMenuOpen={lastPolledMenuOpen}
            setLastPolledMenuOpen={setLastPolledMenuOpen}
            menuOpen={menuOpen}
            setMenuOpen={setMenuOpen}
            pingStates={pingStates}
            pingRepeater={pingRepeater}
            sendAdvert={sendAdvert}
            setClock={setClock}
            setRemoteAdminNode={setRemoteAdminNode}
            togglePauseRepeater={togglePauseRepeater}
          />
        ))}
      </div>

      {historyNode && (
        <HistoryModal
          pubkey={historyNode.pubkey}
          name={historyNode.name}
          onClose={() => setHistoryNode(null)}
        />
      )}
      {remoteAdminNode && (
        <RemoteAdminModal
          pubkey={remoteAdminNode.pubkey}
          name={remoteAdminNode.name}
          lastLogin={remoteAdminNode.last_login_timestamp}
          onClose={() => setRemoteAdminNode(null)}
        />
      )}
    </>
  );
}
