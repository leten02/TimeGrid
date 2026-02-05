import { useEffect, useMemo, useState } from "react";
import Sidebar from "../components/Sidebar";
import { api } from "../lib/api";
import { useSettings } from "../lib/useSettings";

const startOfWeek = (d, weekStartDay = "sunday") => {
  const date = new Date(d);
  const day = date.getDay();
  let diff = -day;
  if (weekStartDay === "monday") {
    diff = day === 0 ? -6 : 1 - day;
  }
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
};

const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

const formatWeekRange = (weekStart) => {
  const end = addDays(weekStart, 6);
  return `${weekStart.getMonth() + 1}월 ${weekStart.getDate()}일 - ${end.getMonth() + 1}월 ${end.getDate()}일`;
};

export default function Reports() {
  const { settings } = useSettings();
  const [blocks, setBlocks] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const weekStart = startOfWeek(new Date(), settings.week_start_day);
      const weekEnd = addDays(weekStart, 7);
      try {
        const [list, taskRows] = await Promise.all([
          api(`/blocks?from_=${encodeURIComponent(weekStart.toISOString())}&to=${encodeURIComponent(weekEnd.toISOString())}`),
          api("/tasks"),
        ]);
        setBlocks(list);
        setTasks(taskRows);
      } catch {
        setBlocks([]);
        setTasks([]);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [settings.week_start_day]);

  const weeklyMinutes = useMemo(() => {
    return blocks.reduce((sum, block) => {
      const start = new Date(block.start_at);
      const end = new Date(block.end_at);
      return sum + Math.max(0, (end - start) / 60000);
    }, 0);
  }, [blocks]);

  const weekStart = useMemo(() => startOfWeek(new Date(), settings.week_start_day), [settings.week_start_day]);
  const dailyMinutes = useMemo(() => {
    const minutes = Array.from({ length: 7 }, () => 0);
    const msPerDay = 24 * 60 * 60 * 1000;
    blocks.forEach((block) => {
      const start = new Date(block.start_at);
      const end = new Date(block.end_at);
      const dayIndex = Math.floor((start.getTime() - weekStart.getTime()) / msPerDay);
      if (dayIndex >= 0 && dayIndex < 7) {
        minutes[dayIndex] += Math.max(0, (end - start) / 60000);
      }
    });
    return minutes;
  }, [blocks, weekStart]);

  const totalTasks = tasks.length;
  const doneTasks = tasks.filter((t) => t.status === "done").length;
  const completionRate = totalTasks ? Math.round((doneTasks / totalTasks) * 1000) / 10 : 0;

  const maxMinutes = Math.max(...dailyMinutes, 1);
  const dayLabels = settings.week_start_day === "monday"
    ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div style={styles.shell} className="tg-shell">
      <Sidebar />
      <main style={styles.main} className="tg-main">
        <div style={styles.header} className="tg-header">
          <div>
            <div style={styles.hTitle}>주간 생산성 리포트</div>
            <div style={styles.hSub}>{formatWeekRange(weekStart)}</div>
          </div>
          <div style={styles.headerActions} className="tg-header-actions">
            <button style={styles.btnGhost}>공유</button>
            <button style={styles.btnPrimary}>PDF 내보내기</button>
          </div>
        </div>

        <div style={styles.summaryGrid}>
          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>총 계획 시간</div>
            <div style={styles.summaryValue}>{(weeklyMinutes / 60).toFixed(1)}h</div>
            <div style={styles.summarySub}>주간 누적</div>
          </div>
          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>집중 완료율</div>
            <div style={styles.summaryValue}>{completionRate}%</div>
            <div style={styles.summarySub}>태스크 기준</div>
          </div>
          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>연속 달성</div>
            <div style={styles.summaryValue}>12 Days</div>
            <div style={styles.summarySub}>Keep it up!</div>
          </div>
        </div>

        <section style={styles.chartCard}>
          <div style={styles.chartHeader}>
            <div>
              <div style={styles.chartTitle}>일일 작업 분포</div>
              <div style={styles.chartSub}>주간 집중 시간 분석</div>
            </div>
            <button style={styles.linkButton}>7일 보기</button>
          </div>
          <div style={styles.chartArea}>
            {dailyMinutes.map((value, idx) => {
              const height = Math.max(12, (value / maxMinutes) * 180);
              return (
                <div key={dayLabels[idx]} style={styles.barWrap}>
                  <div style={{ ...styles.bar, height }} />
                  <span style={styles.barLabel}>{dayLabels[idx]}</span>
                </div>
              );
            })}
          </div>
          {loading && <div style={styles.chartLoading}>데이터 불러오는 중...</div>}
        </section>

        <section style={styles.chartCard}>
          <div style={styles.chartHeader}>
            <div>
              <div style={styles.chartTitle}>카테고리별 분석</div>
              <div style={styles.chartSub}>주요 활동 시간 분포</div>
            </div>
            <button style={styles.linkButton}>상세 보기</button>
          </div>
          <div style={styles.categoryGrid}>
            <div style={styles.categoryItem}>
              <span>개발</span>
              <strong>18.4h</strong>
            </div>
            <div style={styles.categoryItem}>
              <span>공부</span>
              <strong>12.1h</strong>
            </div>
            <div style={styles.categoryItem}>
              <span>회의</span>
              <strong>6.2h</strong>
            </div>
            <div style={styles.categoryItem}>
              <span>개인</span>
              <strong>5.8h</strong>
            </div>
          </div>
        </section>
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
    overflow: "auto",
    display: "grid",
    gap: 20,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  hTitle: { fontSize: 22, fontWeight: 800 },
  hSub: { fontSize: 12, opacity: 0.6 },
  headerActions: { display: "flex", gap: 10, alignItems: "center" },
  btnPrimary: {
    border: "none",
    padding: "10px 16px",
    borderRadius: 14,
    background: "#0f172a",
    color: "white",
    fontWeight: 700,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 38,
  },
  btnGhost: {
    border: "1px solid rgba(15,23,42,0.12)",
    background: "white",
    padding: "10px 16px",
    borderRadius: 14,
    fontWeight: 700,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 38,
  },
  summaryGrid: {
    display: "grid",
    gap: 16,
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  },
  summaryCard: {
    background: "white",
    borderRadius: 18,
    border: "1px solid rgba(15,23,42,0.08)",
    padding: 16,
    display: "grid",
    gap: 6,
  },
  summaryLabel: { fontSize: 12, color: "#64748b" },
  summaryValue: { fontSize: 24, fontWeight: 800 },
  summarySub: { fontSize: 12, color: "#94a3b8" },
  chartCard: {
    background: "white",
    borderRadius: 18,
    border: "1px solid rgba(15,23,42,0.08)",
    padding: 18,
    display: "grid",
    gap: 16,
  },
  chartHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  chartTitle: { fontSize: 15, fontWeight: 700 },
  chartSub: { fontSize: 12, color: "#94a3b8" },
  linkButton: {
    border: "none",
    background: "transparent",
    color: "#3b82f6",
    fontWeight: 600,
    cursor: "pointer",
    fontSize: 12,
  },
  chartArea: {
    display: "grid",
    gridTemplateColumns: "repeat(7, 1fr)",
    gap: 12,
    alignItems: "end",
    minHeight: 220,
  },
  barWrap: {
    display: "grid",
    gap: 8,
    justifyItems: "center",
  },
  bar: {
    width: "100%",
    borderRadius: 16,
    background: "linear-gradient(180deg, #60a5fa, #3b82f6)",
  },
  barLabel: { fontSize: 11, color: "#94a3b8" },
  chartLoading: { fontSize: 12, color: "#94a3b8" },
  categoryGrid: {
    display: "grid",
    gap: 12,
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
  },
  categoryItem: {
    background: "rgba(15,23,42,0.04)",
    borderRadius: 14,
    padding: 12,
    display: "flex",
    justifyContent: "space-between",
    fontSize: 13,
    fontWeight: 600,
  },
};
