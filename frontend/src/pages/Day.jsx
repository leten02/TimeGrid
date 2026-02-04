import { useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import { useSettings } from "../lib/useSettings";

const DAY_NAMES = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];
const DAY_LABELS_SUN = ["일", "월", "화", "수", "목", "금", "토"];

const startOfDay = (d) => {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  return date;
};

const addDays = (d, n) => {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
};

const pad2 = (n) => String(n).padStart(2, "0");

const parseTimeToMinutes = (value, fallbackMinutes) => {
  if (!value || typeof value !== "string") return fallbackMinutes;
  const [hRaw, mRaw] = value.split(":");
  const h = Number(hRaw);
  const m = Number(mRaw ?? "0");
  if (Number.isNaN(h) || Number.isNaN(m)) return fallbackMinutes;
  return h * 60 + m;
};

export default function Day() {
  const { settings } = useSettings();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const activeView = pathname.startsWith("/day") ? "day" : "week";

  const [dayOffset, setDayOffset] = useState(0);
  const currentDay = useMemo(() => addDays(startOfDay(new Date()), dayOffset), [dayOffset]);

  const dayShortLabel = DAY_LABELS_SUN[currentDay.getDay()];
  const startMin = parseTimeToMinutes(settings.grid_start, 6 * 60);
  const rawEndMin = parseTimeToMinutes(settings.grid_end, 24 * 60);
  const endMin = rawEndMin > startMin ? rawEndMin : startMin + 60;
  const pxPerMin = settings.compact_mode ? 1.05 : 1.2;
  const gridHeight = (endMin - startMin) * pxPerMin;
  const hourCount = Math.max(0, Math.ceil(endMin / 60) - Math.floor(startMin / 60));
  const startHour = Math.floor(startMin / 60);

  const title = `${currentDay.getFullYear()}년 ${currentDay.getMonth() + 1}월 ${currentDay.getDate()}일`;
  const subTitle = DAY_NAMES[currentDay.getDay()];

  return (
    <div style={styles.shell}>
      <Sidebar />
      <main style={styles.main}>
        <div style={styles.header}>
          <div>
            <div style={styles.hTitle}>{title}</div>
            <div style={styles.hSub}>{subTitle}</div>
          </div>
          <div style={styles.headerRight}>
            <div style={styles.navGroup}>
              <button style={styles.iconBtn} onClick={() => setDayOffset((v) => v - 1)}>◀</button>
              <button style={styles.btnGhost} onClick={() => setDayOffset(0)}>오늘</button>
              <button style={styles.iconBtn} onClick={() => setDayOffset((v) => v + 1)}>▶</button>
            </div>
            <div style={styles.viewSwitch}>
              {[
                { key: "day", label: "일" },
                { key: "week", label: "주" },
                { key: "month", label: "월" },
                { key: "year", label: "년" },
              ].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => navigate(`/${item.key === "week" ? "week" : item.key}`)}
                  style={{
                    ...styles.viewSwitchItem,
                    ...(activeView === item.key ? styles.viewSwitchItemActive : {}),
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div style={styles.dayHeader}>
          <div style={styles.dayHeaderLabel}>하루 종일</div>
          <div style={styles.dayHeaderBadge}>{dayShortLabel}</div>
        </div>

        <div style={styles.gridWrap}>
          <div style={styles.timeCol}>
            {Array.from({ length: hourCount }).map((_, i) => {
              const hour = startHour + i;
              const top = (hour * 60 - startMin) * pxPerMin;
              return (
                <div key={hour} style={{ position: "absolute", top, left: 0, fontSize: 12, color: "#64748b" }}>
                  {pad2(hour)}시
                </div>
              );
            })}
          </div>
          <div style={{ ...styles.dayCol, height: gridHeight }}>
            {Array.from({ length: hourCount }).map((_, i) => (
              <div
                key={i}
                style={{
                  position: "absolute",
                  top: i * 60 * pxPerMin,
                  left: 0,
                  right: 0,
                  borderTop: "1px solid rgba(15,23,42,0.06)",
                }}
              />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

const styles = {
  shell: {
    minHeight: "100vh",
    display: "grid",
    gridTemplateColumns: "96px 1fr",
    background: "#f6f7fb",
    fontFamily: "'Pretendard','SF Pro Display','Apple SD Gothic Neo','Noto Sans KR',sans-serif",
    color: "#0f172a",
  },
  main: {
    padding: "24px 32px",
    display: "grid",
    gap: 18,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 16,
  },
  hTitle: { fontSize: 26, fontWeight: 900 },
  hSub: { fontSize: 14, opacity: 0.7 },
  headerRight: { display: "flex", gap: 12, alignItems: "center" },
  navGroup: { display: "flex", gap: 6, alignItems: "center" },
  iconBtn: {
    border: "1px solid rgba(15,23,42,0.12)",
    background: "white",
    width: 32,
    height: 32,
    borderRadius: 999,
    cursor: "pointer",
    fontWeight: 700,
  },
  btnGhost: {
    padding: "8px 12px",
    borderRadius: 999,
    border: "1px solid rgba(15,23,42,0.12)",
    background: "rgba(255,255,255,0.85)",
    cursor: "pointer",
    color: "#0f172a",
    fontWeight: 600,
    height: 32,
    display: "grid",
    placeItems: "center",
  },
  viewSwitch: {
    display: "flex",
    gap: 6,
    padding: 6,
    borderRadius: 999,
    background: "rgba(15,23,42,0.06)",
    border: "1px solid rgba(15,23,42,0.08)",
    alignItems: "center",
    height: 32,
  },
  viewSwitchItem: {
    border: "none",
    background: "transparent",
    padding: "6px 14px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    color: "#475569",
    cursor: "pointer",
    minWidth: 44,
    textAlign: "center",
  },
  viewSwitchItemActive: {
    background: "#0f172a",
    color: "white",
    boxShadow: "0 8px 18px rgba(15,23,42,0.18)",
  },
  dayHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 16px",
    borderRadius: 14,
    background: "white",
    border: "1px solid rgba(15,23,42,0.08)",
  },
  dayHeaderLabel: { fontSize: 12, color: "#64748b", fontWeight: 600 },
  dayHeaderBadge: {
    padding: "6px 12px",
    borderRadius: 999,
    background: "rgba(15,23,42,0.06)",
    fontSize: 12,
    fontWeight: 700,
  },
  gridWrap: {
    display: "grid",
    gridTemplateColumns: "64px 1fr",
    gap: 12,
    alignItems: "flex-start",
  },
  timeCol: {
    position: "relative",
    minHeight: 200,
  },
  dayCol: {
    position: "relative",
    background: "white",
    borderRadius: 18,
    border: "1px solid rgba(15,23,42,0.08)",
    overflow: "hidden",
  },
};
