import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import BlockModal from "../components/BlockModal";

const DAYS = ["일", "월", "화", "수", "목", "금", "토"];

// UI 파라미터(여기만 바꾸면 전체가 바뀜)
const START_HOUR = 6;          // 그리드 시작 시간
const END_HOUR = 24;           // 그리드 끝 시간
const PX_PER_MIN = 1.2;        // 1분당 픽셀 (1.2면 60분=72px)
const DAY_COL_WIDTH = 160;     // day column 폭(중앙은 flex라 실제로는 min 폭)
const BLOCK_MIN = 60;          // 시간 차단 단위(분)
const BLOCKED_STORAGE_KEY = "timegrid:blockedSlots:v1";

function startOfWeekSunday(d) {
  const date = new Date(d);
  const day = date.getDay(); // 0=일
  const diff = -day;
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
function pad2(n) {
  return String(n).padStart(2, "0");
}
function dateKey(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function loadBlockedSlots() {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(BLOCKED_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed) : new Set();
  } catch {
    return new Set();
  }
}
function persistBlockedSlots(next) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BLOCKED_STORAGE_KEY, JSON.stringify([...next]));
  } catch {
    // no-op
  }
}
function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}:${pad2(minutes)}:${pad2(seconds)}`;
  return `${minutes}:${pad2(seconds)}`;
}
function minutesFromDayStart(date) {
  return date.getHours() * 60 + date.getMinutes();
}
function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// ---- click-to-create helpers ----
const SLOT_MIN = 30;
function snapMinute(min) {
  return Math.round(min / SLOT_MIN) * SLOT_MIN;
}
function toLocalISOStringFromParts(baseDate, minutes) {
  const d = new Date(baseDate);
  d.setMinutes(d.getMinutes() + minutes);
  return d.toISOString();
}

// ---- overlap layout (cluster-aware) ----
function layoutOverlaps(blocks) {
  // Assign each block a column index (_col) and a column count for its overlap cluster (_colCount).
  // This prevents unrelated non-overlapping blocks from being squeezed.
  const items = [...blocks].sort((a, b) => a._start - b._start);

  const active = []; // { end: Date, col: number }
  let cluster = []; // blocks in current overlap cluster (references to placed objects)
  let clusterMaxCols = 1;

  const placed = [];

  const nextFreeCol = () => {
    const used = new Set(active.map((x) => x.col));
    let c = 0;
    while (used.has(c)) c += 1;
    return c;
  };

  const finalizeCluster = () => {
    if (cluster.length === 0) return;
    const maxCols = Math.max(1, clusterMaxCols);
    for (const b of cluster) b._colCount = maxCols;
    cluster = [];
    clusterMaxCols = 1;
  };

  for (const b of items) {
    // Remove ended active blocks
    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i].end <= b._start) active.splice(i, 1);
    }

    // If no active blocks remain, the previous overlap cluster ended.
    if (active.length === 0) {
      finalizeCluster();
    }

    const col = nextFreeCol();
    const placedBlock = { ...b, _col: col, _colCount: 1 };
    placed.push(placedBlock);

    active.push({ end: b._end, col });

    cluster.push(placedBlock);
    clusterMaxCols = Math.max(clusterMaxCols, active.length);
  }

  // Finalize last cluster
  finalizeCluster();

  return placed;
}

export default function Week() {
  const [me, setMe] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [err, setErr] = useState("");
  const [nowTick, setNowTick] = useState(Date.now());
  const [blockMode, setBlockMode] = useState(false);
  const [blockedSlots, setBlockedSlots] = useState(() => loadBlockedSlots());
  const [dragSelect, setDragSelect] = useState(null);
  const dragSelectRef = useRef(null);
  const dragStateRef = useRef(null);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [messages, setMessages] = useState([
    { id: "welcome", role: "assistant", text: "안녕하세요! 스케줄 설정을 도와드릴게요. 어떤 도움이 필요하신가요?" },
  ]);
  const navigate = useNavigate();

  // modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState("create");
  const [selected, setSelected] = useState(null);

  const [weekOffset, setWeekOffset] = useState(0);

  const gridWrapRef = useRef(null);
  const autoScrollDoneRef = useRef(false);
  const chatScrollRef = useRef(null);

  const weekStart = useMemo(() => {
    const base = startOfWeekSunday(new Date());
    base.setDate(base.getDate() + weekOffset * 7);
    return base;
  }, [weekOffset]);

  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);

  const gridStartMin = START_HOUR * 60;
  const gridEndMin = END_HOUR * 60;
  const gridHeight = (gridEndMin - gridStartMin) * PX_PER_MIN;
  const blocksPerDay = (gridEndMin - gridStartMin) / BLOCK_MIN;

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
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    autoScrollDoneRef.current = false;
  }, [weekStart.getTime()]);
  useEffect(() => {
    dragSelectRef.current = dragSelect;
  }, [dragSelect]);
  useEffect(() => {
    if (!blockMode) {
      setDragSelect(null);
      dragStateRef.current = null;
    }
  }, [blockMode]);
  useEffect(() => {
    if (!chatScrollRef.current) return;
    chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
  }, [messages]);
  useEffect(() => {
    persistBlockedSlots(blockedSlots);
  }, [blockedSlots]);

  // Up Next: 지금 기준으로 가장 가까운 미래 일정 3개
  const upNext = useMemo(() => {
    const now = new Date(nowTick);
    return [...blocks]
      .map(b => ({...b, _start: new Date(b.start_at), _end: new Date(b.end_at)}))
      .filter(b => b._end > now)
      .sort((a, b) => a._start - b._start)
      .slice(0, 3);
  }, [blocks, nowTick]);

  const getDayKey = (dayIndex) => dateKey(addDays(weekStart, dayIndex));
  const getBlockedRanges = useCallback((dayIndex) => {
    const dayKey = getDayKey(dayIndex);
    const ranges = [];
    let start = null;
    for (let slot = 0; slot < blocksPerDay; slot += 1) {
      const isBlocked = blockedSlots.has(`${dayKey}|${slot}`);
      if (isBlocked && start === null) start = slot;
      if (!isBlocked && start !== null) {
        ranges.push({ startSlot: start, endSlot: slot - 1 });
        start = null;
      }
    }
    if (start !== null) ranges.push({ startSlot: start, endSlot: blocksPerDay - 1 });
    return ranges;
  }, [blockedSlots, blocksPerDay, getDayKey]);
  const slotIndexFromClientY = useCallback((clientY, rect) => {
    const y = clamp(clientY - rect.top, 0, rect.height - 1);
    const minutes = gridStartMin + y / PX_PER_MIN;
    const slot = Math.floor((minutes - gridStartMin) / BLOCK_MIN);
    return clamp(slot, 0, blocksPerDay - 1);
  }, [gridStartMin, blocksPerDay]);

  const handleBlockMouseDown = (e, dayIndex) => {
    if (!blockMode) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const slot = slotIndexFromClientY(e.clientY, rect);
    const key = `${getDayKey(dayIndex)}|${slot}`;
    const action = blockedSlots.has(key) ? "unblock" : "block";

    dragStateRef.current = { rect, dayIndex, action };
    setDragSelect({ dayIndex, startSlot: slot, endSlot: slot, action });
  };

  useEffect(() => {
    if (!dragSelect) return;

    const handleMove = (e) => {
      const state = dragStateRef.current;
      if (!state) return;
      const slot = slotIndexFromClientY(e.clientY, state.rect);
      setDragSelect((prev) => (prev ? { ...prev, endSlot: slot } : prev));
    };

    const handleUp = () => {
      const current = dragSelectRef.current;
      if (!current) return;
      const { dayIndex, startSlot, endSlot, action } = current;
      const rangeStart = Math.min(startSlot, endSlot);
      const rangeEnd = Math.max(startSlot, endSlot);
      const dayKey = getDayKey(dayIndex);

      setBlockedSlots((prev) => {
        const next = new Set(prev);
        for (let slot = rangeStart; slot <= rangeEnd; slot += 1) {
          const key = `${dayKey}|${slot}`;
          if (action === "block") next.add(key);
          else next.delete(key);
        }
        return next;
      });

      setDragSelect(null);
      dragStateRef.current = null;
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [dragSelect, weekStart.getTime(), blocksPerDay, gridStartMin, gridEndMin, blockMode, slotIndexFromClientY]);

  const openCreate = (preset = null) => {
    setSelected(preset);
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

  const sendChat = async () => {
    const text = chatInput.trim();
    if (!text || chatLoading) return;
    const ts = Date.now();
    const nextMessages = [...messages, { id: `u-${ts}`, role: "user", text }];
    setMessages(nextMessages);
    setChatInput("");
    setChatLoading(true);

    try {
      const payload = {
        messages: nextMessages.map(({ role, text: msgText }) => ({ role, text: msgText })),
      };
      const res = await api("/ai/chat", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setMessages((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, role: "assistant", text: res?.reply || "응답을 가져오지 못했어요." },
      ]);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, role: "assistant", text: "현재 응답을 받을 수 없어요. 잠시 후 다시 시도해주세요." },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleChatKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
  };

  const todayLine = useMemo(() => {
    const now = new Date(nowTick);
    const nowMin = minutesFromDayStart(now);
    if (nowMin < gridStartMin || nowMin > gridEndMin) return null;
    const top = (nowMin - gridStartMin) * PX_PER_MIN;
    return { top };
  }, [nowTick, gridStartMin, gridEndMin]);

  const now = new Date(nowTick);
  const today = now;
  const ongoing = upNext.find((b) => b._start <= now && b._end > now);
  const nextStart = upNext.find((b) => b._start > now);
  const focusLabel = nextStart
    ? formatDuration(nextStart._start - now)
    : ongoing
      ? formatDuration(ongoing._end - now)
      : "--:--";
  const focusSub = nextStart
    ? `다음 일정: ${nextStart.title}`
    : ongoing
      ? `${ongoing.title} 종료까지`
      : "예정된 일정이 없습니다.";

  useEffect(() => {
    const el = gridWrapRef.current;
    if (!el || autoScrollDoneRef.current) return;

    // Only auto-scroll when the current date is within the displayed week.
    const now = new Date(nowTick);
    if (now < weekStart || now >= weekEnd) return;

    if (!todayLine) return;

    // Scroll so "now" line is a bit below the sticky header.
    const target = Math.max(0, todayLine.top - 140);
    el.scrollTop = target;
    autoScrollDoneRef.current = true;
  }, [weekStart.getTime(), weekEnd.getTime(), todayLine, nowTick]);

  return (
    <div style={styles.shell}>
      <div style={styles.shellBackdrop} aria-hidden="true" />
      <style>{`
        .tg-card { transition: transform 0.18s ease, box-shadow 0.18s ease; }
        .tg-card:hover { transform: translateY(-2px); box-shadow: 0 18px 30px rgba(15,23,42,0.12); }
        .tg-pill { transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease; }
        .tg-pill:hover { transform: translateY(-1px); box-shadow: 0 10px 20px rgba(15,23,42,0.12); }
        .tg-daycol { transition: box-shadow 0.2s ease, transform 0.2s ease; }
        .tg-daycol:hover { box-shadow: 0 14px 28px rgba(15,23,42,0.08); }
      `}</style>
      {/* Sidebar */}
      <aside style={styles.sidebar}>
        <div style={styles.brand}>
          <img
            src="/brand/timegrid_mark.png"
            alt="TimeGrid"
            style={styles.brandLogo}
          />
          <span>TimeGrid</span>
        </div>
        <nav style={styles.nav}>
          <div style={{...styles.navItem, ...styles.navItemActive}} onClick={() => navigate("/week")}>타임테이블</div>
          <div style={styles.navItem}>인벤토리</div>
          <div style={styles.navItem}>리포트</div>
          <div style={styles.navItem} onClick={() => navigate("/settings")}>설정</div>
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
            <div style={styles.hTitle}>주간 타임테이블</div>
            <div style={styles.hSub}>{fmtDate(weekStart)} – {fmtDate(addDays(weekEnd, -1))}</div>
          </div>

          <div style={styles.headerRight}>
            <button style={styles.btnGhost} className="tg-pill" onClick={() => setWeekOffset(x => x - 1)}>◀</button>
            <button style={styles.btnGhost} className="tg-pill" onClick={() => setWeekOffset(0)}>오늘</button>
            <button style={styles.btnGhost} className="tg-pill" onClick={() => setWeekOffset(x => x + 1)}>▶</button>
            <button style={styles.btnPrimary} className="tg-pill" onClick={() => openCreate(null)}>+ 추가</button>
          </div>
        </div>

        {/* Grid */}
        <div style={styles.gridWrap} ref={gridWrapRef}>
          {/* Day header row */}
          <div style={styles.dayHeaderRow}>
            <div style={{ width: 64, display: "grid", placeItems: "center", fontSize: 12, opacity: 0.7 }}>
              시간
            </div>
            <div style={styles.dayHeaderCols}>
              {DAYS.map((d, idx) => {
                const date = addDays(weekStart, idx);
                const isToday = isSameDay(date, today);
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
              {Array.from({ length: END_HOUR - START_HOUR }).map((_, i) => {
                const hour = START_HOUR + i;
                const top = (hour * 60 - gridStartMin) * PX_PER_MIN;
                return (
                  <div key={hour} style={{ position: "absolute", top, left: 0, fontSize: 12, opacity: 0.7 }}>
                    {pad2(hour)}:00
                  </div>
                );
              })}
            </div>

            {/* Day columns */}
            <div style={{ ...styles.dayCols, height: gridHeight }}>
              {DAYS.map((_, dayIndex) => {
                const dayDate = addDays(weekStart, dayIndex);

                // 이 day의 블록만
                const dayBlocks = blocks
                  .map(b => ({ ...b, _start: new Date(b.start_at), _end: new Date(b.end_at) }))
                  .filter(b => isSameDay(b._start, dayDate)); // MVP: 하루를 넘는 일정은 일단 제외(다음 단계에서 split)

                const laidOut = layoutOverlaps(dayBlocks);

                return (
                  <div
                    key={dayIndex}
                    className="tg-daycol"
                    style={{ ...styles.dayCol, ...(blockMode ? styles.dayColBlockMode : {}), cursor: blockMode ? "crosshair" : "pointer" }}
                    onMouseDown={(e) => handleBlockMouseDown(e, dayIndex)}
                    onClick={(e) => {
                      if (blockMode) return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      const y = e.clientY - rect.top;

                      const rawMin = gridStartMin + y / PX_PER_MIN;
                      const startMin = snapMinute(rawMin);
                      const endMin = startMin + 60; // default 1 hour

                      const dayStart = new Date(dayDate);
                      dayStart.setHours(0, 0, 0, 0);

                      const preset = {
                        start_at: toLocalISOStringFromParts(dayStart, startMin),
                        end_at: toLocalISOStringFromParts(dayStart, endMin),
                      };

                      openCreate(preset);
                    }}
                  >
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
                          borderTop: "1px solid rgba(15,23,42,0.06)",
                          zIndex: 1,
                        }}
                      />
                    ))}

                    {/* Blocked slots */}
                    {getBlockedRanges(dayIndex).map((range) => (
                      <div
                        key={`blocked-${dayIndex}-${range.startSlot}-${range.endSlot}`}
                        style={{
                          ...styles.blockedSlot,
                          top: range.startSlot * BLOCK_MIN * PX_PER_MIN,
                          height: (range.endSlot - range.startSlot + 1) * BLOCK_MIN * PX_PER_MIN,
                        }}
                      />
                    ))}

                    {/* Drag selection preview */}
                    {dragSelect && dragSelect.dayIndex === dayIndex && (
                      <div
                        style={{
                          ...styles.blockedSlotPreview,
                          top: Math.min(dragSelect.startSlot, dragSelect.endSlot) * BLOCK_MIN * PX_PER_MIN,
                          height: (Math.abs(dragSelect.endSlot - dragSelect.startSlot) + 1) * BLOCK_MIN * PX_PER_MIN,
                        }}
                      />
                    )}

                    {/* Today line (해당 요일 컬럼에만 표시) */}
                    {todayLine && isSameDay(dayDate, today) && (
                      <div style={{
                        position: "absolute",
                        top: todayLine.top,
                        left: 0,
                        right: 0,
                        height: 2,
                        background: "rgba(255,59,48,0.7)",
                        zIndex: 4,
                      }} />
                    )}

                    {/* blocks */}
                    {laidOut.map((b) => {
                      const startMin = minutesFromDayStart(b._start);
                      const endMin = minutesFromDayStart(b._end);
                      const top = (clamp(startMin, gridStartMin, gridEndMin) - gridStartMin) * PX_PER_MIN;
                      const height = (clamp(endMin, gridStartMin, gridEndMin) - clamp(startMin, gridStartMin, gridEndMin)) * PX_PER_MIN;

                      const gap = 6;
                      const widthPct = 100 / (b._colCount || 1);
                      const leftPct = (b._col || 0) * widthPct;

                      return (
                        <div
                          key={b.id}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            if (!blockMode) openEdit(b);
                          }}
                          style={{
                            position: "absolute",
                            top,
                            left: `calc(${leftPct}% + ${gap}px)`,
                            width: `calc(${widthPct}% - ${gap * 2}px)`,
                            height: Math.max(24, height),
                            borderRadius: 12,
                            padding: 8,
                            background: "rgba(90,140,255,0.2)",
                            border: "1px solid rgba(90,140,255,0.45)",
                            boxShadow: "0 6px 16px rgba(37,99,235,0.16)",
                            cursor: "pointer",
                            overflow: "hidden",
                            zIndex: 5,
                            pointerEvents: blockMode ? "none" : "auto",
                            opacity: blockMode ? 0.75 : 1,
                          }}
                        >
                          <div style={{ fontWeight: 600, fontSize: 12.5 }}>{b.title}</div>
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

      </main>

      {/* Right panel */}
      <aside style={styles.right}>
        <button
          style={{ ...styles.blockModeBtn, ...(blockMode ? styles.blockModeBtnActive : {}) }}
          className="tg-pill"
          onClick={() => setBlockMode((v) => !v)}
        >
          <span style={{ ...styles.blockModeDot, ...(blockMode ? styles.blockModeDotActive : {}) }} />
          시간 차단 모드
        </button>
        {blockMode && (
          <div style={styles.blockHint}>
            드래그로 여러 시간대를 한 번에 차단할 수 있어요.
          </div>
        )}

        <div style={styles.card} className="tg-card">
          <div style={styles.focusHeader}>
            <div style={styles.focusTitle}>집중 타이머</div>
            <button style={styles.btnGhostSm} className="tg-pill">재조정</button>
          </div>
          <div style={styles.focusTime}>{focusLabel}</div>
          <div style={styles.focusSub}>{focusSub}</div>
        </div>

        <div style={styles.chatCard} className="tg-card">
          <div style={styles.chatHeader}>
            <span>AI 스케줄 도우미</span>
            <span style={styles.chatHeaderBadge}>
              {chatLoading ? "응답 중" : blockMode ? "차단 모드 ON" : "대기 중"}
            </span>
          </div>
          <div style={styles.chatBody} ref={chatScrollRef}>
            {messages.map((m) => (
              <div
                key={m.id}
                style={{ ...styles.chatBubble, ...(m.role === "user" ? styles.chatBubbleUser : {}) }}
              >
                {m.text}
              </div>
            ))}
          </div>
          <div style={styles.chatInputWrap}>
            <textarea
              style={styles.chatInput}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={handleChatKeyDown}
              placeholder="AI에게 스케줄 관련 질문을 하세요..."
              rows={3}
              disabled={chatLoading}
            />
            <button
              style={{ ...styles.chatSend, ...(chatLoading ? styles.chatSendDisabled : {}) }}
              className="tg-pill"
              onClick={sendChat}
              disabled={chatLoading}
            >
              {chatLoading ? "응답 중" : "전송"}
            </button>
          </div>
          <div style={styles.chatHint}>Enter 전송 · Shift+Enter 줄바꿈</div>
        </div>
      </aside>

      <BlockModal
        open={modalOpen}
        mode={modalMode}
        initialBlock={selected}
        onClose={() => setModalOpen(false)}
        onSubmit={modalMode === "create" ? createBlock : updateBlock}
        onDelete={modalMode === "edit" ? deleteBlock : null}
      />
    </div>
  );
}

const cardBase = {
  background: "rgba(255,255,255,0.9)",
  border: "1px solid rgba(15,23,42,0.08)",
  borderRadius: 18,
  padding: 14,
  boxShadow: "0 10px 24px rgba(15,23,42,0.08)",
};

const styles = {
  shell: {
    minHeight: "100vh",
    height: "100vh",
    display: "grid",
    gridTemplateColumns: "220px 1fr 320px",
    background: "linear-gradient(180deg, #f6f7fb 0%, #eef1f7 60%, #e8ecf5 100%)",
    position: "relative",
    overflow: "visible",
    color: "#0f172a",
    fontFamily: "'Pretendard','SF Pro Display','Apple SD Gothic Neo','Noto Sans KR',sans-serif",
  },
  shellBackdrop: {
    position: "absolute",
    inset: 0,
    background: "radial-gradient(circle at 15% 5%, rgba(59,130,246,0.12), transparent 45%), radial-gradient(circle at 85% 0%, rgba(255,59,48,0.12), transparent 45%), radial-gradient(circle at 80% 90%, rgba(16,185,129,0.12), transparent 45%)",
    pointerEvents: "none",
    zIndex: 0,
  },
  sidebar: {
    position: "relative",
    zIndex: 1,
    padding: 18,
    borderRight: "1px solid rgba(15,23,42,0.08)",
    background: "rgba(255,255,255,0.6)",
    backdropFilter: "blur(14px)",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  brand: { fontWeight: 800, fontSize: 18, display: "flex", alignItems: "center", gap: 8, letterSpacing: "-0.3px" },
  brandLogo: { width: 22, height: 22, display: "block" },
  nav: { display: "grid", gap: 8 },
  navItem: {
    padding: "10px 12px",
    borderRadius: 14,
    cursor: "pointer",
    opacity: 0.8,
  },
  navItemActive: {
    background: "rgba(15,23,42,0.08)",
    opacity: 1,
    fontWeight: 700,
  },
  main: {
    position: "relative",
    zIndex: 1,
    padding: 20,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    gap: 14,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  hTitle: { fontSize: 24, fontWeight: 900, letterSpacing: "-0.4px" },
  hSub: { fontSize: 12, opacity: 0.7 },
  headerRight: { display: "flex", gap: 8, alignItems: "center" },
  btnGhost: {
    padding: "8px 12px",
    borderRadius: 999,
    border: "1px solid rgba(15,23,42,0.12)",
    background: "rgba(255,255,255,0.85)",
    cursor: "pointer",
    color: "#0f172a",
    fontWeight: 600,
  },
  btnGhostSm: {
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid rgba(15,23,42,0.12)",
    background: "rgba(255,255,255,0.85)",
    cursor: "pointer",
    color: "#0f172a",
    fontWeight: 600,
    fontSize: 12,
  },
  btnPrimary: {
    padding: "8px 14px",
    borderRadius: 999,
    border: "1px solid rgba(15,23,42,0.2)",
    background: "linear-gradient(135deg, #0f172a, #1f2937)",
    color: "white",
    cursor: "pointer",
    fontWeight: 700,
  },
  gridWrap: {
    flex: 1,
    background: "rgba(255,255,255,0.78)",
    border: "1px solid rgba(15,23,42,0.08)",
    borderRadius: 22,
    overflow: "auto",
    boxShadow: "0 16px 30px rgba(15,23,42,0.08)",
  },
  dayHeaderRow: {
    position: "sticky",
    top: 0,
    zIndex: 5,
    display: "flex",
    gap: 8,
    padding: "14px 14px 10px",
    background: "rgba(255,255,255,0.92)",
    backdropFilter: "blur(10px)",
    borderBottom: "1px solid rgba(15,23,42,0.06)",
  },
  dayHeaderCols: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8, width: "100%" },
  dayHeaderCell: {
    minWidth: DAY_COL_WIDTH,
    padding: "8px 10px",
    borderRadius: 16,
    background: "rgba(15,23,42,0.04)",
    border: "1px solid rgba(15,23,42,0.06)",
    textAlign: "center",
  },
  dayHeaderToday: { background: "rgba(15,23,42,0.08)", boxShadow: "0 0 0 2px rgba(15,23,42,0.2)" },
  bodyRow: {
    display: "flex",
    padding: 14,
    gap: 8,
  },
  dayCols: {
    position: "relative",
    flex: 1,
    display: "grid",
    gridTemplateColumns: "repeat(7, 1fr)",
    gap: 8,
    minWidth: 7 * DAY_COL_WIDTH + 6 * 8,
  },
  dayCol: {
    position: "relative",
    background: "rgba(255,255,255,0.6)",
    borderRadius: 18,
    border: "1px solid rgba(15,23,42,0.08)",
    minWidth: DAY_COL_WIDTH,
    overflow: "hidden",
  },
  dayColBlockMode: {
    background: "rgba(255,59,48,0.04)",
    border: "1px solid rgba(255,59,48,0.35)",
  },
  blockedSlot: {
    position: "absolute",
    left: 6,
    right: 6,
    borderRadius: 12,
    background: "rgba(255,59,48,0.16)",
    border: "1px solid rgba(255,59,48,0.35)",
    zIndex: 2,
    pointerEvents: "none",
  },
  blockedSlotPreview: {
    position: "absolute",
    left: 6,
    right: 6,
    borderRadius: 12,
    background: "rgba(255,59,48,0.1)",
    border: "1px dashed rgba(255,59,48,0.6)",
    zIndex: 3,
    pointerEvents: "none",
  },
  right: {
    position: "relative",
    zIndex: 1,
    padding: 18,
    borderLeft: "1px solid rgba(15,23,42,0.08)",
    background: "rgba(255,255,255,0.6)",
    backdropFilter: "blur(14px)",
    display: "flex",
    flexDirection: "column",
    gap: 12,
    overflow: "hidden",
  },
  blockModeBtn: {
    padding: "10px 14px",
    borderRadius: 999,
    border: "1px solid rgba(15,23,42,0.12)",
    background: "rgba(15,23,42,0.06)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    fontWeight: 700,
    color: "#0f172a",
    cursor: "pointer",
  },
  blockModeBtnActive: {
    background: "linear-gradient(135deg, #0f172a, #1f2937)",
    color: "white",
    border: "1px solid rgba(15,23,42,0.2)",
    boxShadow: "0 10px 20px rgba(15,23,42,0.2)",
  },
  blockModeDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    background: "rgba(15,23,42,0.45)",
  },
  blockModeDotActive: {
    background: "#ff3b30",
  },
  blockHint: {
    fontSize: 12,
    opacity: 0.7,
    marginTop: -4,
    marginBottom: 4,
  },
  card: cardBase,
  focusHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  focusTitle: { fontWeight: 700 },
  focusTime: { fontSize: 30, fontWeight: 800, letterSpacing: "-0.4px" },
  focusSub: { fontSize: 12, opacity: 0.7, marginTop: 6 },
  chatCard: {
    ...cardBase,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    flex: 1,
    minHeight: 280,
  },
  chatHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    fontWeight: 700,
  },
  chatHeaderBadge: {
    fontSize: 11,
    padding: "4px 8px",
    borderRadius: 999,
    background: "rgba(15,23,42,0.08)",
    color: "#0f172a",
  },
  chatBody: {
    flex: 1,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: 10,
    paddingRight: 4,
  },
  chatBubble: {
    alignSelf: "flex-start",
    background: "rgba(15,23,42,0.06)",
    borderRadius: 14,
    padding: "8px 10px",
    fontSize: 13,
    lineHeight: 1.4,
    maxWidth: "80%",
  },
  chatBubbleUser: {
    alignSelf: "flex-end",
    background: "rgba(59,130,246,0.16)",
    border: "1px solid rgba(59,130,246,0.3)",
  },
  chatInputWrap: {
    display: "flex",
    gap: 8,
    alignItems: "flex-end",
  },
  chatInput: {
    flex: 1,
    resize: "none",
    border: "1px solid rgba(15,23,42,0.12)",
    borderRadius: 12,
    padding: 10,
    fontSize: 13,
    background: "rgba(255,255,255,0.9)",
    color: "#0f172a",
    lineHeight: 1.4,
  },
  chatSend: {
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid rgba(15,23,42,0.2)",
    background: "rgba(15,23,42,0.92)",
    color: "white",
    fontWeight: 700,
    cursor: "pointer",
  },
  chatSendDisabled: {
    opacity: 0.65,
    cursor: "not-allowed",
  },
  chatHint: {
    fontSize: 11,
    opacity: 0.6,
  },
};
