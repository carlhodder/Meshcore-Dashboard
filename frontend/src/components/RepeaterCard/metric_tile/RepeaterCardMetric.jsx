import styles from "./RepeaterCardMetric.module.css";

export default function RepeaterCardMetric({
  label,
  value,
  unit,
  valueClass = "",
  subValue,
  subClass = "",
  barPercent,
  barColor,
  showBar = false,
}) {
  return (
    <div className={styles.metric}>
      <div className={styles["metric-label"]}>{label}</div>
      <div className={`${styles["metric-value"]} ${valueClass}`}>
        {value != null ? value : "--"}
        {unit && <span className={styles["metric-unit"]}> {unit}</span>}
      </div>
      {subValue && (
        <div className={`${styles["metric-sub"]} ${subClass}`}>{subValue}</div>
      )}
      {showBar && (
        <div className={styles["bar-bg"]}>
          <div
            className={styles["bar-fill"]}
            style={{
              width: `${barPercent || 0}%`,
              background: barColor,
            }}
          ></div>
        </div>
      )}
    </div>
  );
}
