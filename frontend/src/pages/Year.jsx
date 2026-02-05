import { useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import Sidebar from "../components/Sidebar";

const DAYS = ["일", "월", "화", "수", "목", "금", "토"];

const startOfMonth = (year, month) => new Date(year, month, 1);
const startOfWeek = (date) => {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
};
const addDays = (date, n) => {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
};

export default function Year() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const activeView = pathname.startsWith("/year") ? "year" : "week";
  const [yearOffset, setYearOffset] = useState(0);

  const currentYear = useMemo(() => new Date().getFullYear() + yearOffset, [yearOffset]);
  const today = new Date();

  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => i), []);

  return (
    <div style={styles.shell} className="tg-shell">
      <Sidebar />
      <main style={styles.main} className="tg-main">
        <div style={styles.header} className="tg-header">
          <div>
            <div style={styles.hTitle}>{currentYear}년</div>
            <div style={styles.hSub}>연간 캘린더</div>
          </div>
          <div style={styles.headerRight} className="tg-header-actions">
            <div style={styles.navGroup}>
              <button style={styles.iconBtn} onClick={() => setYearOffset((v) => v - 1)}>◀</button>
              <button style={styles.btnGhost} onClick={() => setYearOffset(0)}>오늘</button>
              <button style={styles.iconBtn} onClick={() => setYearOffset((v) => v + 1)}>▶</button>
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

        <div style={styles.yearGrid}>
          {months.map((month) => {
            const monthStart = startOfMonth(currentYear, month);
            const start = startOfWeek(monthStart);
            const days = Array.from({ length: 42 }, (_, idx) => addDays(start, idx));
            return (
              <div key={month} style={styles.monthCard}>
                <div style={styles.monthTitle}>{month + 1}월</div>
                <div style={styles.miniGrid}>
                  {DAYS.map((label) => (
                    <div key={label} style={styles.miniLabel}>{label}</div>
                  ))}
                  {days.map((date, idx) => {
                    const isCurrent = date.getMonth() === month;
                    const isToday = date.toDateString() === today.toDateString();
                    return (
                      <div
                        key={`${month}-${idx}`}
                        style={{
                          ...styles.miniCell,
                          ...(isCurrent ? {} : styles.miniCellMuted),
                          ...(isToday ? styles.miniCellToday : {}),
                        }}
                      >
                        {date.getDate()}
                      </div>
                    );
                  })}
                </div>
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
  yearGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 16,
  },
  monthCard: {
    background: "white",
    borderRadius: 16,
    border: "1px solid rgba(15,23,42,0.08)",
    padding: 12,
    display: "grid",
    gap: 8,
  },
  monthTitle: { fontSize: 14, fontWeight: 800 },
  miniGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(7, 1fr)",
    gap: 4,
  },
  miniLabel: {
    fontSize: 9,
    color: "#94a3b8",
    textAlign: "center",
  },
  miniCell: {
    fontSize: 10,
    textAlign: "center",
    padding: "2px 0",
    borderRadius: 6,
    background: "rgba(15,23,42,0.03)",
  },
  miniCellMuted: {
    opacity: 0.35,
  },
  miniCellToday: {
    background: "rgba(239,68,68,0.2)",
    color: "#b91c1c",
    fontWeight: 700,
  },
};
