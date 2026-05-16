import styles from "../../pages/MapPage.module.css";

export default function MapLegend({ open, onToggle }) {
  return (
    <div className={styles.mapLegend}>
      <div className={styles.legendHeader} onClick={onToggle}>
        <span>Legend</span>
        <span className={styles.legendToggle}>{open ? "▼" : "▲"}</span>
      </div>
      {open && (
        <div className={styles.legendContent}>
          <div className={styles.legendRow}>
            <div className={`${styles.legendDot} ${styles.gateway}`}></div>{" "}
            Gateway
          </div>
          <div className={`${styles.legendRow} ${styles.legendSubtitle}`}>
            Node fill = status
          </div>
          <div className={styles.legendRow}>
            <div className={`${styles.legendDot} ${styles.online}`}></div>{" "}
            Online
          </div>
          <div className={styles.legendRow}>
            <div className={`${styles.legendDot} ${styles.offline}`}></div>{" "}
            Offline
          </div>
          <div className={styles.legendRow}>
            <div className={`${styles.legendDot} ${styles.unknown}`}></div> Not
            polled
          </div>
          <div className={`${styles.legendRow} ${styles.legendSubtitle}`}>
            Contacts (All mode)
          </div>
          <div className={styles.legendRow}>
            <div className={`${styles.legendDot} ${styles.dotContact}`}></div>{" "}
            Contact
          </div>
          <div className={styles.legendRow}>
            <div className={`${styles.legendDot} ${styles.dotAdvert}`}></div>{" "}
            Advert
          </div>
          <div className={`${styles.legendRow} ${styles.legendSubtitle}`}>
            Paths layer
          </div>
          <div className={styles.legendRow}>
            <div className={`${styles.legendDot} ${styles.pathSingle}`}></div>{" "}
            Single route
          </div>
          <div className={styles.legendRow}>
            <div className={`${styles.legendDot} ${styles.pathShared}`}></div>{" "}
            Shared segment
          </div>
          <div className={`${styles.legendRow} ${styles.legendSubtitle}`}>
            Msg paths layer
          </div>
          <div className={styles.legendRow}>
            <div className={`${styles.legendDot} ${styles.pathMsg}`}></div>{" "}
            Message path
          </div>
          <div className={`${styles.legendRow} ${styles.legendSubtitle}`}>
            Neighbours layer
          </div>
          <div className={styles.legendRow}>
            <div
              className={`${styles.legendDot} ${styles.pathNeighbour}`}
            ></div>{" "}
            Neighbour link (SNR)
          </div>
        </div>
      )}
    </div>
  );
}
