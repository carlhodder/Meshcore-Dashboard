import styles from "../../pages/MapPage.module.css";

export default function MapControls({
  legendOpen,
  pickingHome,
  showingAllContacts,
  showingPaths,
  showingMsgPaths,
  showingNeighbourLinks,
  onToggleHome,
  onToggleContacts,
  onTogglePaths,
  onToggleMsgPaths,
  onToggleNeighbours,
  onRefresh,
}) {
  return (
    <div
      className={`${styles.mapBtnBar} ${!legendOpen ? styles.mapBtnBarSmallLegend : ""}`}
    >
      <button
        className={`${styles.mapBtn} ${styles.mapSetHomeBtn} ${pickingHome ? styles.picking : ""}`}
        onClick={onToggleHome}
      >
        {pickingHome ? "\u2715 Cancel" : "\u8962 Set Home"}
      </button>
      <button
        className={`${styles.mapBtn} ${styles.mapContactsBtn} ${showingAllContacts ? styles.active : ""}`}
        onClick={onToggleContacts}
      >
        &#9788; All Contacts
      </button>
      <button
        className={`${styles.mapBtn} ${styles.mapPathsBtn} ${showingPaths ? styles.active : ""}`}
        onClick={onTogglePaths}
      >
        &#8627; Paths
      </button>
      <button
        className={`${styles.mapBtn} ${styles.mapPathsBtn} ${showingMsgPaths ? styles.active : ""}`}
        onClick={onToggleMsgPaths}
      >
        &#9993; Msg Paths
      </button>
      <button
        className={`${styles.mapBtn} ${styles.mapNeighboursBtn} ${showingNeighbourLinks ? styles.active : ""}`}
        onClick={onToggleNeighbours}
      >
        &#8767; Neighbours
      </button>
      <button
        className={`${styles.mapBtn} ${styles.mapRefreshBtn}`}
        onClick={onRefresh}
      >
        Refresh
      </button>
    </div>
  );
}
