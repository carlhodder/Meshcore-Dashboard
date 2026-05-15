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
            setRemoteAdminNode={setRemoteAdminNode}
            updateRepeaterData={updateRepeaterData}
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
