import { useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import { useSettings } from "../lib/useSettings";

const DAYS_SUN = ["일", "월", "화", "수", "목", "금", "토"];
const DAYS_MON = ["월", "화", "수", "목", "금", "토", "일"];

const startOfMonth = (date) => new Date(date.getFullYear(), date.getMonth(), 1);
const startOfWeek = (date, weekStartDay = "sunday") => {
  const d = new Date(date);
  const day = d.getDay();
  let diff = -day;
  if (weekStartDay === "monday") diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
};
const addDays = (date, n) => {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
};

export default function Month() {
  const { settings } = useSettings();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const activeView = pathname.startsWith("/month") ? "month" : "week";

  const [monthOffset, setMonthOffset] = useState(0);

  const currentMonth = useMemo(() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + monthOffset);
    return d;
  }, [monthOffset]);

  const monthLabel = `${currentMonth.getFullYear()}년 ${currentMonth.getMonth() + 1}월`;
  const daysHeader = settings.week_start_day === "monday" ? DAYS_MON : DAYS_SUN;

  const calendarDays = useMemo(() => {
    const first = startOfMonth(currentMonth);
    const start = startOfWeek(first, settings.week_start_day);
    return Array.from({ length: 42 }, (_, idx) => addDays(start, idx));
  }, [currentMonth, settings.week_start_day]);

  const today = new Date();

  return (
    <div style={styles.shell} className="tg-shell">
      <Sidebar />
      <main style={styles.main} className="tg-main">
        <div style={styles.header} className="tg-header">
          <div>
            <div style={styles.hTitle}>{monthLabel}</div>
            <div style={styles.hSub}>월간 캘린더</div>
          </div>
          <div style={styles.headerRight} className="tg-header-actions">
            <div style={styles.navGroup}>
              <button style={styles.iconBtn} onClick={() => setMonthOffset((v) => v - 1)}>◀</button>
              <button style={styles.btnGhost} onClick={() => setMonthOffset(0)}>오늘</button>
              <button style={styles.iconBtn} onClick={() => setMonthOffset((v) => v + 1)}>▶</button>
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

        <div style={styles.monthGrid}>
          {daysHeader.map((label) => (
            <div key={label} style={styles.dayLabel}>{label}</div>
          ))}
          {calendarDays.map((date, idx) => {
            const isCurrent = date.getMonth() === currentMonth.getMonth();
            const isToday = date.toDateString() === today.toDateString();
            return (
              <div
                key={`${date.toISOString()}-${idx}`}
                style={{
                  ...styles.dayCell,
                  ...(isCurrent ? {} : styles.dayCellMuted),
                  ...(isToday ? styles.dayCellToday : {}),
                }}
              >
                <div style={styles.dayNumber}>{date.getDate()}</div>
              </div>
            );
          })}
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
  hSub: { fontSize: 12, opacity: 0.7 },
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
  monthGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(7, 1fr)",
    gap: 8,
    background: "white",
    borderRadius: 18,
    border: "1px solid rgba(15,23,42,0.08)",
    padding: 12,
  },
  dayLabel: {
    textAlign: "center",
    fontSize: 12,
    fontWeight: 700,
    color: "#64748b",
    padding: "8px 0",
  },
  dayCell: {
    minHeight: 90,
    borderRadius: 12,
    background: "rgba(15,23,42,0.03)",
    padding: 10,
    border: "1px solid rgba(15,23,42,0.06)",
  },
  dayCellMuted: {
    opacity: 0.4,
  },
  dayCellToday: {
    border: "1px solid rgba(59,130,246,0.6)",
    background: "rgba(59,130,246,0.12)",
  },
  dayNumber: {
    fontSize: 13,
    fontWeight: 700,
  },
};
