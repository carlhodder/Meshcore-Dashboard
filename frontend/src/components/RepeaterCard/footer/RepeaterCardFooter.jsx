import styles from "./RepeaterCardFooter.module.css";
import { format } from "date-fns";

function timeout_date_string(timestamp) {
  if (timestamp === 0 || !timestamp) {
    return "";
  } else {
    return format(new Date(timestamp * 1000), "yyyy-MM-dd h:mm aa");
  }
}

export default function RepeaterCardFooter({
  timeAgoString,
  routeChain,
  fwVersion,
  isOffline,
  r, // the repeater object
  lastPolledMenuOpen,
  setLastPolledMenuOpen,
  menuOpen,
  setMenuOpen,
  pingState,
  pingRepeater,
  sendAdvert,
  setClock,
  setRemoteAdminNode,
  togglePauseRepeater,
}) {
  const cooldown = pingState ? pingState.cooldown : 0;
  const result = pingState ? pingState.result : null;
  const pingDisabled = cooldown > 0;
  let pingClass = styles["card-ping-btn"];
  if (cooldown > 0 && result) {
    pingClass +=
      result === "ok" ? ` ${styles["ping-ok"]}` : ` ${styles["ping-fail"]}`;
  }
  const pingLabel = cooldown > 0 ? `${cooldown}s` : "Poll";

  return (
    <div className={styles["card-footer"]}>
      <div className={styles["card-footer-left"]}>
        <div
          tabIndex={-1}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) {
              setLastPolledMenuOpen(false);
            }
          }}
          style={{ position: "relative", display: "inline-block" }}
        >
          <span
            className={styles["card-footer-seen"]}
            onClick={(e) => {
              e.stopPropagation();
              setLastPolledMenuOpen(!lastPolledMenuOpen);
              setMenuOpen(false);
            }}
          >
            Last seen: {timeAgoString}
          </span>
          {lastPolledMenuOpen && (
            <div
              className={`${styles["popup-menu"]} ${styles["popup-menu-poll-intervals"]}`}
            >
              <table>
                <tbody>
                  <tr>
                    <td>Last poll:</td>
                    <td>{timeout_date_string(r.last_poll_timestamp)}</td>
                  </tr>
                  <tr>
                    <td>Last neighbours poll:</td>
                    <td>{timeout_date_string(r.last_neighbour_poll)}</td>
                  </tr>
                  <tr>
                    <td>Last FW poll:</td>
                    <td>{timeout_date_string(r.last_fw_poll)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className={styles["card-footer-route-container"]}>
          {routeChain && (
            <div className={styles["card-footer-route"]}>{routeChain}</div>
          )}
        </div>
        <div className={styles["card-footer-fw-container"]}>
          {fwVersion && (
            <div className={styles["card-footer-fw"]}>{fwVersion}</div>
          )}
        </div>
        <div className={styles["card-offline-text-container"]}>
          {isOffline && (
            <div className={styles["card-offline-text"]}>
              No response to last poll
            </div>
          )}
        </div>
      </div>
      <div className={styles["actions-container"]}>
        <button
          className={pingClass}
          disabled={pingDisabled || r.paused}
          onClick={(e) => pingRepeater(e)}
        >
          {pingLabel}
        </button>
        <div
          className={styles["menu-container"]}
          tabIndex={-1}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) {
              setMenuOpen(false);
            }
          }}
        >
          <button
            className={styles["hamburger-btn"]}
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(!menuOpen);
              setLastPolledMenuOpen(false);
            }}
          >
            &#8942;
          </button>
          {menuOpen && (
            <div className={styles["popup-menu"]}>
              <button onClick={(e) => sendAdvert(e)}>Advert</button>
              <button onClick={(e) => setClock(e)}>Set clock</button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  setRemoteAdminNode({
                    pubkey: r.pubkey,
                    name: r.name,
                    last_login_timestamp: r.last_login_timestamp,
                  });
                }}
              >
                Remote Admin
              </button>
              <button
                onClick={(e) => {
                  setMenuOpen(false);
                  togglePauseRepeater(e);
                }}
              >
                {r.paused ? "Start" : "Pause"} Polling
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
