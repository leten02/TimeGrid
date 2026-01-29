import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import BlockModal from "../components/BlockModal";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// UI 파라미터(여기만 바꾸면 전체가 바뀜)
const START_HOUR = 8;          // 그리드 시작 시간
const END_HOUR = 20;           // 그리드 끝 시간
const PX_PER_MIN = 1.2;        // 1분당 픽셀 (1.2면 60분=72px)
const DAY_COL_WIDTH = 160;     // day column 폭(중앙은 flex라 실제로는 min 폭)

function startOfWeekMonday(d) {
  const date = new Date(d);
  const day = date.getDay(); // 0=일
  const diff = (day === 0 ? -6 : 1) - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}
function fmtDate(d) {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
function minutesFromDayStart(date) {
  return date.getHours() * 60 + date.getMinutes();
}
function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export default function WeekV2() {
  const [me, setMe] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [err, setErr] = useState("");

  // modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState("create");
  const [selected, setSelected] = useState(null);

  const [weekOffset, setWeekOffset] = useState(0);

  const weekStart = useMemo(() => {
    const base = startOfWeekMonday(new Date());
    base.setDate(base.getDate() + weekOffset * 7);
    return base;
  }, [weekOffset]);

  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);

  const gridStartMin = START_HOUR * 60;
  const gridEndMin = END_HOUR * 60;
  const gridHeight = (gridEndMin - gridStartMin) * PX_PER_MIN;

  const load = async () => {
    setErr("");
    try {
      const meRes = await api("/me");
      setMe(meRes);

      const from_ = weekStart.toISOString();
      const to = weekEnd.toISOString();
      const list = await api(`/blocks?from_=${encodeURIComponent(from_)}&to=${encodeURIComponent(to)}`);
      setBlocks(list);
    } catch {
      window.location.href = "/";
    }
  };

  useEffect(() => { load(); }, [weekStart.getTime()]); // 주 이동 시 reload

  // Up Next: 지금 기준으로 가장 가까운 미래 일정 3개
  const upNext = useMemo(() => {
    const now = new Date();
    return [...blocks]
      .map(b => ({...b, _start: new Date(b.start_at), _end: new Date(b.end_at)}))
      .filter(b => b._end > now)
      .sort((a, b) => a._start - b._start)
      .slice(0, 3);
  }, [blocks]);

  const openCreate = () => {
    setSelected(null);
    setModalMode("create");
    setModalOpen(true);
  };
  const openEdit = (b) => {
    setSelected(b);
    setModalMode("edit");
    setModalOpen(true);
  };

  const createBlock = async (payload) => { await api("/blocks", { method: "POST", body: JSON.stringify(payload) }); await load(); };
  const updateBlock = async (payload) => { await api(`/blocks/${selected.id}`, { method: "PATCH", body: JSON.stringify(payload) }); await load(); };
  const deleteBlock = async () => { await api(`/blocks/${selected.id}`, { method: "DELETE" }); await load(); };

  const logout = async () => { await api("/auth/logout", { method: "POST" }); window.location.href = "/"; };

  const todayLine = useMemo(() => {
    const now = new Date();
    const nowMin = minutesFromDayStart(now);
    if (nowMin < gridStartMin || nowMin > gridEndMin) return null;
    const top = (nowMin - gridStartMin) * PX_PER_MIN;
    return { top };
  }, [weekStart.getTime()]);

  return (
    <div style={styles.shell}>
      {/* Sidebar */}
      <aside style={styles.sidebar}>
        <div style={styles.brand}>TimeGrid</div>
        <nav style={styles.nav}>
          <div style={{...styles.navItem, ...styles.navItemActive}}>Timetable</div>
          <div style={styles.navItem}>Inventory</div>
          <div style={styles.navItem}>Reports</div>
          <div style={styles.navItem}>Settings</div>
        </nav>
        <div style={{ marginTop: "auto", opacity: 0.75, fontSize: 12 }}>
          {me ? `${me.name || ""}` : ""}
        </div>
      </aside>

      {/* Main */}
      <main style={styles.main}>
        {/* Header */}
        <div style={styles.header}>
          <div>
            <div style={styles.hTitle}>Weekly Timetable</div>
            <div style={styles.hSub}>{fmtDate(weekStart)} – {fmtDate(addDays(weekEnd, -1))}</div>
          </div>

          <div style={styles.headerRight}>
            <button style={styles.btn} onClick={() => setWeekOffset(x => x - 1)}>◀</button>
            <button style={styles.btn} onClick={() => setWeekOffset(0)}>Today</button>
            <button style={styles.btn} onClick={() => setWeekOffset(x => x + 1)}>▶</button>
            <button style={styles.btnPrimary} onClick={openCreate}>+ Add</button>
            <button style={styles.btn} onClick={logout}>Logout</button>
          </div>
        </div>

        {/* Grid */}
        <div style={styles.gridWrap}>
          {/* Day header row */}
          <div style={styles.dayHeaderRow}>
            <div style={{ width: 64 }} />
            <div style={styles.dayHeaderCols}>
              {DAYS.map((d, idx) => {
                const date = addDays(weekStart, idx);
                const isToday = isSameDay(date, new Date());
                return (
                  <div key={d} style={{...styles.dayHeaderCell, ...(isToday ? styles.dayHeaderToday : {})}}>
                    <div style={{ fontWeight: 600 }}>{d}</div>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>{fmtDate(date)}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Body */}
          <div style={styles.bodyRow}>
            {/* Time column */}
            <div style={{ width: 64, position: "relative" }}>
              {Array.from({ length: END_HOUR - START_HOUR + 1 }).map((_, i) => {
                const hour = START_HOUR + i;
                const top = (hour * 60 - gridStartMin) * PX_PER_MIN;
                return (
                  <div key={hour} style={{ position: "absolute", top, left: 0, fontSize: 12, opacity: 0.7 }}>
                    {hour}:00
                  </div>
                );
              })}
            </div>

            {/* Day columns */}
            <div style={{ ...styles.dayCols, height: gridHeight }}>
              {DAYS.map((_, dayIndex) => {
                const dayDate = addDays(weekStart, dayIndex);
                const dayStart = new Date(dayDate); dayStart.setHours(0,0,0,0);

                // 이 day의 블록만
                const dayBlocks = blocks
                  .map(b => ({ ...b, _start: new Date(b.start_at), _end: new Date(b.end_at) }))
                  .filter(b => isSameDay(b._start, dayDate)); // MVP: 하루를 넘는 일정은 일단 제외(다음 단계에서 split)

                return (
                  <div key={dayIndex} style={styles.dayCol}>
                    {/* hour lines */}
                    {Array.from({ length: END_HOUR - START_HOUR }).map((_, i) => (
                      <div
                        key={i}
                        style={{
                          position: "absolute",
                          top: (i * 60) * PX_PER_MIN,
                          left: 0,
                          right: 0,
                          height: 0,
                          borderTop: "1px solid rgba(0,0,0,0.06)"
                        }}
                      />
                    ))}

                    {/* Today line (해당 요일 컬럼에만 표시) */}
                    {todayLine && isSameDay(dayDate, new Date()) && (
                      <div style={{
                        position: "absolute",
                        top: todayLine.top,
                        left: 0,
                        right: 0,
                        height: 2,
                        background: "rgba(255,0,0,0.45)"
                      }} />
                    )}

                    {/* blocks */}
                    {dayBlocks.map((b) => {
                      const startMin = minutesFromDayStart(b._start);
                      const endMin = minutesFromDayStart(b._end);
                      const top = (clamp(startMin, gridStartMin, gridEndMin) - gridStartMin) * PX_PER_MIN;
                      const height = (clamp(endMin, gridStartMin, gridEndMin) - clamp(startMin, gridStartMin, gridEndMin)) * PX_PER_MIN;

                      return (
                        <div
                          key={b.id}
                          onClick={() => openEdit(b)}
                          style={{
                            position: "absolute",
                            top,
                            left: 8,
                            right: 8,
                            height: Math.max(24, height),
                            borderRadius: 10,
                            padding: 10,
                            background: "rgba(90,140,255,0.18)",
                            border: "1px solid rgba(90,140,255,0.35)",
                            cursor: "pointer",
                            overflow: "hidden",
                          }}
                        >
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{b.title}</div>
                          <div style={{ fontSize: 12, opacity: 0.75 }}>
                            {b._start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}–
                            {b._end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {err && <p style={{ color: "crimson" }}>{err}</p>}

        <BlockModal
          open={modalOpen}
          mode={modalMode}
          initialBlock={selected}
          onClose={() => setModalOpen(false)}
          onSubmit={modalMode === "create" ? createBlock : updateBlock}
          onDelete={modalMode === "edit" ? deleteBlock : null}
        />
      </main>

      {/* Right panel */}
      <aside style={styles.right}>
        <div style={styles.quickTitle}>Quick</div>

        <div style={styles.card}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Focus Timer</div>
          <div style={{
            width: 140, height: 140, borderRadius: 999,
            border: "6px solid rgba(0,0,0,0.12)",
            display: "grid", placeItems: "center", margin: "8px auto 0"
          }}>
            <div style={{ fontSize: 28, fontWeight: 800 }}>45:30</div>
          </div>
          <div style={{ marginTop: 12, fontSize: 12, opacity: 0.75, textAlign: "center" }}>
            (다음 단계에서 실제 타이머 기능)
          </div>
        </div>

        <div style={styles.card}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>Up Next</div>
          {upNext.length === 0 ? (
            <div style={{ fontSize: 13, opacity: 0.7 }}>예정된 일정이 없어요.</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {upNext.map((b) => (
                <div key={b.id} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {b.title}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>
                    {b._start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <button style={{...styles.btnPrimary, width: "100%"}}>Reschedule</button>
      </aside>
    </div>
  );
}

const styles = {
  shell: {
    height: "100vh",
    display: "grid",
    gridTemplateColumns: "220px 1fr 280px",
    background: "rgba(245,246,248,1)",
  },
  sidebar: {
    padding: 16,
    borderRight: "1px solid rgba(0,0,0,0.08)",
    background: "rgba(255,255,255,0.7)",
    backdropFilter: "blur(10px)",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  brand: { fontWeight: 900, fontSize: 18 },
  nav: { display: "grid", gap: 8 },
  navItem: {
    padding: "10px 12px",
    borderRadius: 12,
    cursor: "pointer",
    opacity: 0.75,
  },
  navItemActive: {
    background: "rgba(0,0,0,0.06)",
    opacity: 1,
    fontWeight: 700,
  },
  main: {
    padding: 18,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  hTitle: { fontSize: 22, fontWeight: 900 },
  hSub: { fontSize: 12, opacity: 0.7 },
  headerRight: { display: "flex", gap: 8, alignItems: "center" },
  btn: {
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid rgba(0,0,0,0.12)",
    background: "rgba(255,255,255,0.85)",
    cursor: "pointer",
  },
  btnPrimary: {
    padding: "8px 12px",
    borderRadius: 10,
    border: "1px solid rgba(0,0,0,0.12)",
    background: "rgba(0,0,0,0.85)",
    color: "white",
    cursor: "pointer",
  },
  gridWrap: {
    flex: 1,
    background: "rgba(255,255,255,0.8)",
    border: "1px solid rgba(0,0,0,0.08)",
    borderRadius: 18,
    overflow: "auto",
  },
  dayHeaderRow: {
    position: "sticky",
    top: 0,
    zIndex: 5,
    display: "flex",
    padding: "12px 12px 8px",
    background: "rgba(255,255,255,0.9)",
    borderBottom: "1px solid rgba(0,0,0,0.06)",
  },
  dayHeaderCols: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 10, width: "100%" },
  dayHeaderCell: {
    minWidth: DAY_COL_WIDTH,
    padding: "8px 10px",
    borderRadius: 12,
    background: "rgba(0,0,0,0.03)",
    textAlign: "center",
  },
  dayHeaderToday: { outline: "2px solid rgba(0,0,0,0.2)" },
  bodyRow: {
    display: "flex",
    padding: 12,
    gap: 10,
  },
  dayCols: {
    position: "relative",
    flex: 1,
    display: "grid",
    gridTemplateColumns: "repeat(7, 1fr)",
    gap: 10,
    minWidth: 7 * DAY_COL_WIDTH + 6 * 10,
  },
  dayCol: {
    position: "relative",
    background: "rgba(0,0,0,0.02)",
    borderRadius: 14,
    border: "1px solid rgba(0,0,0,0.06)",
    minWidth: DAY_COL_WIDTH,
    overflow: "hidden",
  },
  right: {
    padding: 16,
    borderLeft: "1px solid rgba(0,0,0,0.08)",
    background: "rgba(255,255,255,0.7)",
    backdropFilter: "blur(10px)",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  quickTitle: { fontSize: 20, fontWeight: 900 },
  card: {
    background: "rgba(255,255,255,0.9)",
    border: "1px solid rgba(0,0,0,0.08)",
    borderRadius: 16,
    padding: 12,
  },
};