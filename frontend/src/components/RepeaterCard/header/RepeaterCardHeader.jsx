import styles from "./RepeaterCardHeader.module.css";

export default function RepeaterCardHeader({ name, pubkeyShort, statusClass }) {
  return (
    <div className={styles["card-header"]}>
      <div>
        <div className={styles["card-name"]}>{name}</div>
        <div className={styles["card-id"]}>{pubkeyShort}</div>
      </div>
      <div>
        <span className={`status-dot ${statusClass}`}></span>
      </div>
    </div>
  );
}
