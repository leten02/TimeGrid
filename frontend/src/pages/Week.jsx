import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import { api } from "../lib/api";
import BlockModal from "../components/BlockModal";
import { useSettings } from "../lib/useSettings";

const DAYS_SUN = ["일", "월", "화", "수", "목", "금", "토"];
const DAYS_MON = ["월", "화", "수", "목", "금", "토", "일"];

// UI 파라미터(설정 기본값)
const DEFAULT_START_HOUR = 6;      // 그리드 시작 시간
const DEFAULT_END_HOUR = 24;       // 그리드 끝 시간
const DEFAULT_PX_PER_MIN = 1.2;    // 1분당 픽셀 (1.2면 60분=72px)
const DEFAULT_DAY_COL_WIDTH = 160; // day column 폭(중앙은 flex라 실제로는 min 폭)
const BLOCK_MIN = 15;          // 시간 차단 단위(분)
const BLOCKED_STORAGE_KEY = "timegrid:blockedSlots:v2";

function startOfWeek(d, weekStartDay = "sunday") {
  const date = new Date(d);
  const day = date.getDay(); // 0=일
  let diff = -day;
  if (weekStartDay === "monday") {
    diff = day === 0 ? -6 : 1 - day;
  }
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function addMonths(d, n) {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
}
function addYears(d, n) {
  const x = new Date(d);
  x.setFullYear(x.getFullYear() + n);
  return x;
}
function startOfMonth(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), 1);
  x.setHours(0, 0, 0, 0);
  return x;
}
function startOfYear(d) {
  const x = new Date(d.getFullYear(), 0, 1);
  x.setHours(0, 0, 0, 0);
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
function parseTimeToMinutes(value, fallbackMinutes) {
  if (!value || typeof value !== "string") return fallbackMinutes;
  const [hRaw, mRaw] = value.split(":");
  const h = Number(hRaw);
  const m = Number(mRaw ?? "0");
  if (Number.isNaN(h) || Number.isNaN(m)) return fallbackMinutes;
  return h * 60 + m;
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
function formatHoursMinutes(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.floor(totalMinutes % 60);
  return `${hours}:${pad2(minutes)}`;
}
function minutesFromDayStart(date) {
  return date.getHours() * 60 + date.getMinutes();
}
function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// ---- click-to-create helpers ----
const SLOT_MIN = 15;
function snapMinute(min) {
  return Math.round(min / SLOT_MIN) * SLOT_MIN;
}
function toLocalISOStringFromParts(baseDate, minutes) {
  const d = new Date(baseDate);
  d.setMinutes(d.getMinutes() + minutes);
  return d.toISOString();
}

const OVERLAP_TOLERANCE_MIN = 15;

// ---- overlap layout (cluster-aware) ----
function layoutOverlaps(blocks) {
  // Assign each block a column index (_col) and a column count for its overlap cluster (_colCount).
  // This prevents unrelated non-overlapping blocks from being squeezed.
  const items = [...blocks].sort((a, b) => a._start - b._start);

  const active = []; // { start: Date, end: Date, col: number }
  let cluster = []; // blocks in current overlap cluster (references to placed objects)
  let clusterMaxCols = 1;
  const toleranceMs = OVERLAP_TOLERANCE_MIN * 60 * 1000;

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
      const entry = active[i];
      const overlaps = entry.end.getTime() > b._start.getTime();
      const closeStart = b._start.getTime() - entry.start.getTime() <= toleranceMs;
      if (!overlaps || !closeStart) active.splice(i, 1);
    }

    // If no active blocks remain, the previous overlap cluster ended.
    if (active.length === 0) {
      finalizeCluster();
    }

    const col = nextFreeCol();
    const placedBlock = { ...b, _col: col, _colCount: 1 };
    placed.push(placedBlock);

    active.push({ start: b._start, end: b._end, col });

    cluster.push(placedBlock);
    clusterMaxCols = Math.max(clusterMaxCols, active.length);
  }

  // Finalize last cluster
  finalizeCluster();

  return placed;
}

export default function Week() {
  const { settings } = useSettings();
  const [me, setMe] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [fixedSchedules, setFixedSchedules] = useState([]);
  const [blockedTemplates, setBlockedTemplates] = useState([]);
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
  const [focusSeconds, setFocusSeconds] = useState(settings.focus_duration * 60);
  const [focusRunning, setFocusRunning] = useState(false);
  const [dragOverrides, setDragOverrides] = useState({});
  const dragOverridesRef = useRef({});
  const dragBlockRef = useRef(null);
  const dragMovedRef = useRef(false);
  const draggingIdRef = useRef(null);
  const dragJustEndedRef = useRef(0);

  // modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState("create");
  const [selected, setSelected] = useState(null);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const activeView = useMemo(() => {
    if (pathname.startsWith("/day")) return "day";
    if (pathname.startsWith("/month")) return "month";
    if (pathname.startsWith("/year")) return "year";
    return "week";
  }, [pathname]);

  const [viewDate, setViewDate] = useState(() => new Date());

  const gridWrapRef = useRef(null);
  const autoScrollDoneRef = useRef(false);
  const chatScrollRef = useRef(null);

  const dayLabels = useMemo(
    () => (settings.week_start_day === "monday" ? DAYS_MON : DAYS_SUN),
    [settings.week_start_day],
  );

  const compactMode = settings.compact_mode;
  const pxPerMin = compactMode ? 1.05 : DEFAULT_PX_PER_MIN;
  const dayColWidth = compactMode ? 140 : DEFAULT_DAY_COL_WIDTH;
  const gridGap = compactMode ? 6 : 8;
  const rowPadding = compactMode ? 10 : 14;
  const headerPadding = compactMode ? "10px 10px 8px" : "14px 14px 10px";

  const gridStartMinSetting = parseTimeToMinutes(settings.grid_start, DEFAULT_START_HOUR * 60);
  const rawGridEndMin = parseTimeToMinutes(settings.grid_end, DEFAULT_END_HOUR * 60);
  const gridEndMinSetting = rawGridEndMin > gridStartMinSetting ? rawGridEndMin : gridStartMinSetting + 60;
  const displayStartHour = Math.floor(gridStartMinSetting / 60);
  const displayEndHour = Math.ceil(gridEndMinSetting / 60);
  const hourCount = Math.max(0, displayEndHour - displayStartHour);

  const weekStart = useMemo(() => startOfWeek(viewDate, settings.week_start_day), [viewDate, settings.week_start_day]);
  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);
  const dayStart = useMemo(() => {
    const d = new Date(viewDate);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [viewDate]);
  const dayEnd = useMemo(() => addDays(dayStart, 1), [dayStart]);
  const monthStart = useMemo(() => startOfMonth(viewDate), [viewDate]);
  const monthEnd = useMemo(() => addMonths(monthStart, 1), [monthStart]);
  const yearStart = useMemo(() => startOfYear(viewDate), [viewDate]);
  const yearEnd = useMemo(() => addYears(yearStart, 1), [yearStart]);

  const gridStartMin = gridStartMinSetting;
  const gridEndMin = gridEndMinSetting;
  const gridHeight = (gridEndMin - gridStartMin) * pxPerMin;
  const blocksPerDay = Math.floor((gridEndMin - gridStartMin) / BLOCK_MIN);

  const rangeStart = useMemo(() => {
    if (activeView === "day") return dayStart;
    if (activeView === "month") return monthStart;
    if (activeView === "year") return yearStart;
    return weekStart;
  }, [activeView, dayStart, monthStart, yearStart, weekStart]);

  const rangeEnd = useMemo(() => {
    if (activeView === "day") return dayEnd;
    if (activeView === "month") return monthEnd;
    if (activeView === "year") return yearEnd;
    return weekEnd;
  }, [activeView, dayEnd, monthEnd, yearEnd, weekEnd]);

  const load = async () => {
    setErr("");
    try {
      const meRes = await api("/me");
      setMe(meRes);
    } catch {
      window.location.href = "/";
      return;
    }

    const from_ = rangeStart.toISOString();
    const to = rangeEnd.toISOString();
    try {
      const results = await Promise.allSettled([
        api(`/blocks?from_=${encodeURIComponent(from_)}&to=${encodeURIComponent(to)}`),
        api("/fixed-schedules"),
        api("/blocked-templates"),
      ]);

      const [blocksResult, fixedResult, blockedResult] = results;
      if (blocksResult.status === "fulfilled") {
        setBlocks(blocksResult.value);
      } else {
        setErr("타임테이블 데이터를 불러오지 못했어요.");
      }

      if (fixedResult.status === "fulfilled") {
        setFixedSchedules(fixedResult.value);
      } else {
        setFixedSchedules([]);
      }

      if (blockedResult.status === "fulfilled") {
        setBlockedTemplates(blockedResult.value);
      } else {
        setBlockedTemplates([]);
      }
    } catch {
      setErr("타임테이블 데이터를 불러오지 못했어요.");
    }
  };

  useEffect(() => { load(); }, [rangeStart.getTime(), rangeEnd.getTime()]); // 뷰 이동 시 reload
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    autoScrollDoneRef.current = false;
  }, [activeView, rangeStart.getTime()]);
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
    if (!focusRunning) return;
    const id = setInterval(() => {
      setFocusSeconds((prev) => {
        if (prev <= 1) {
          setFocusRunning(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [focusRunning]);
  useEffect(() => {
    if (focusRunning) return;
    setFocusSeconds(settings.focus_duration * 60);
  }, [settings.focus_duration, focusRunning]);
  useEffect(() => {
    persistBlockedSlots(blockedSlots);
  }, [blockedSlots]);

  const getDayKeyForDate = useCallback((date) => dateKey(date), []);
  const getDayKeyForIndex = useCallback((dayIndex) => dateKey(addDays(weekStart, dayIndex)), [weekStart]);
  const dayOfWeekFromIndex = useCallback(
    (dayIndex) => (settings.week_start_day === "monday" ? (dayIndex + 1) % 7 : dayIndex),
    [settings.week_start_day],
  );
  const getBlockedRangesForKey = useCallback((dayKey) => {
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
  }, [blockedSlots, blocksPerDay]);
  const getBlockedRanges = useCallback(
    (dayIndex) => getBlockedRangesForKey(getDayKeyForIndex(dayIndex)),
    [getBlockedRangesForKey, getDayKeyForIndex],
  );
  const getBlockedRangesForDate = useCallback(
    (date) => getBlockedRangesForKey(getDayKeyForDate(date)),
    [getBlockedRangesForKey, getDayKeyForDate],
  );
  const getTemplateBlockedRangesForDay = useCallback(
    (targetDay) => {
      const ranges = [];
      blockedTemplates.forEach((item) => {
        if (!item.days?.includes(targetDay)) return;
        const startMin = parseTimeToMinutes(item.start, gridStartMin);
        const endMin = parseTimeToMinutes(item.end, gridStartMin + 60);
        const startSlot = Math.max(0, Math.floor((startMin - gridStartMin) / BLOCK_MIN));
        const endSlot = Math.min(blocksPerDay - 1, Math.ceil((endMin - gridStartMin) / BLOCK_MIN) - 1);
        if (endSlot >= startSlot) ranges.push({ startSlot, endSlot });
      });
      return ranges;
    },
    [blockedTemplates, blocksPerDay, gridStartMin],
  );
  const getTemplateBlockedRanges = useCallback(
    (dayIndex) => getTemplateBlockedRangesForDay(dayOfWeekFromIndex(dayIndex)),
    [getTemplateBlockedRangesForDay, dayOfWeekFromIndex],
  );
  const getFixedBlocksForDay = useCallback(
    (targetDay) => fixedSchedules
      .filter((item) => item.days?.includes(targetDay))
      .map((item) => {
        const startMin = parseTimeToMinutes(item.start, gridStartMin);
        const endMin = parseTimeToMinutes(item.end, gridStartMin + 60);
        return {
          id: `fixed-${item.id}-${targetDay}`,
          title: item.title,
          startMin,
          endMin,
          category: item.category,
        };
      }),
    [fixedSchedules, gridStartMin],
  );
  const getFixedBlocks = useCallback(
    (dayIndex) => getFixedBlocksForDay(dayOfWeekFromIndex(dayIndex)),
    [getFixedBlocksForDay, dayOfWeekFromIndex],
  );
  const slotIndexFromClientY = useCallback((clientY, rect) => {
    const y = clamp(clientY - rect.top, 0, rect.height - 1);
    const minutes = gridStartMin + y / pxPerMin;
    const slot = Math.floor((minutes - gridStartMin) / BLOCK_MIN);
    return clamp(slot, 0, blocksPerDay - 1);
  }, [gridStartMin, blocksPerDay, pxPerMin]);

  const shiftView = useCallback((direction) => {
    setViewDate((prev) => {
      const next = new Date(prev);
      if (activeView === "day") next.setDate(next.getDate() + direction);
      else if (activeView === "week") next.setDate(next.getDate() + direction * 7);
      else if (activeView === "month") next.setMonth(next.getMonth() + direction);
      else next.setFullYear(next.getFullYear() + direction);
      return next;
    });
  }, [activeView]);

  const goToday = useCallback(() => setViewDate(new Date()), []);

  const getDayFromIndex = useCallback((dayIndex) => {
    if (activeView === "day") {
      const d = new Date(viewDate);
      d.setHours(0, 0, 0, 0);
      return d;
    }
    return addDays(weekStart, dayIndex);
  }, [activeView, viewDate, weekStart]);

  const getDayIndexFromPoint = useCallback((x, y) => {
    if (typeof document === "undefined") return null;
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const dayEl = el.closest("[data-day-index]");
    if (!dayEl) return null;
    const index = Number(dayEl.getAttribute("data-day-index"));
    return Number.isNaN(index) ? null : index;
  }, []);

  const handleBlockDragStart = useCallback((e, block) => {
    if (blockMode || activeView === "month" || activeView === "year") return;
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const durationMin = Math.max(15, (block._end - block._start) / 60000);
    const grabOffsetMin = (e.clientY - rect.top) / pxPerMin;
    dragBlockRef.current = {
      id: block.id,
      durationMin,
      grabOffsetMin,
      startClientX: e.clientX,
      startClientY: e.clientY,
    };
    dragMovedRef.current = false;
    draggingIdRef.current = block.id;

    const handleMove = (evt) => {
      const drag = dragBlockRef.current;
      if (!drag) return;
      const delta = Math.abs(evt.clientX - drag.startClientX) + Math.abs(evt.clientY - drag.startClientY);
      if (delta > 3) dragMovedRef.current = true;
      const dayIndex = getDayIndexFromPoint(evt.clientX, evt.clientY);
      if (dayIndex === null) return;
      const dayEl = document.querySelector(`[data-day-index="${dayIndex}"]`);
      if (!dayEl) return;
      const dayRect = dayEl.getBoundingClientRect();
      const y = evt.clientY - dayRect.top;
      const rawMin = gridStartMin + (y - drag.grabOffsetMin) / pxPerMin;
      const snapped = snapMinute(rawMin);
      const maxStart = gridEndMin - drag.durationMin;
      const startMin = clamp(snapped, gridStartMin, maxStart);
      const dayDate = getDayFromIndex(dayIndex);
      const base = new Date(dayDate);
      base.setHours(0, 0, 0, 0);
      const start = new Date(base.getTime() + startMin * 60000);
      const end = new Date(start.getTime() + drag.durationMin * 60000);

      const next = { ...dragOverridesRef.current, [drag.id]: { start, end } };
      dragOverridesRef.current = next;
      setDragOverrides(next);
    };

      const handleUp = async () => {
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
        const drag = dragBlockRef.current;
        dragBlockRef.current = null;
        const override = dragOverridesRef.current[drag?.id];
        if (drag && dragMovedRef.current && override) {
        try {
          await api(`/blocks/${drag.id}`, {
            method: "PATCH",
            body: JSON.stringify({
              start_at: override.start.toISOString(),
              end_at: override.end.toISOString(),
            }),
          });
          await load();
        } catch {
          // ignore
        }
      }
      if (dragMovedRef.current) {
        dragJustEndedRef.current = Date.now();
      }
      if (drag?.id && dragOverridesRef.current[drag.id]) {
        const next = { ...dragOverridesRef.current };
        delete next[drag.id];
        dragOverridesRef.current = next;
        setDragOverrides(next);
      }
      draggingIdRef.current = null;
      dragMovedRef.current = false;
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  }, [blockMode, activeView, pxPerMin, gridStartMin, gridEndMin, getDayIndexFromPoint, getDayFromIndex, load]);

  const handleBlockMouseDown = (e, dayKey) => {
    if (!blockMode) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const slot = slotIndexFromClientY(e.clientY, rect);
    const key = `${dayKey}|${slot}`;
    const action = blockedSlots.has(key) ? "unblock" : "block";

    dragStateRef.current = { rect, dayKey, action };
    setDragSelect({ dayKey, startSlot: slot, endSlot: slot, action });
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
      const { dayKey, startSlot, endSlot, action } = current;
      const rangeStart = Math.min(startSlot, endSlot);
      const rangeEnd = Math.max(startSlot, endSlot);

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
        context: {
          now: new Date().toISOString(),
          tz_offset_minutes: new Date().getTimezoneOffset(),
          default_duration_minutes: 60,
        },
      };
      const res = await api("/ai/chat", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setMessages((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, role: "assistant", text: res?.reply || "응답을 가져오지 못했어요." },
      ]);
      if (res?.created_blocks && res.created_blocks.length > 0) {
        await load();
      }
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
    const top = (nowMin - gridStartMin) * pxPerMin;
    return { top };
  }, [nowTick, gridStartMin, gridEndMin, pxPerMin]);

  const now = new Date(nowTick);
  const today = now;
  const focusHours = pad2(Math.floor(focusSeconds / 3600));
  const focusMinutes = pad2(Math.floor((focusSeconds % 3600) / 60));
  const focusSecs = pad2(focusSeconds % 60);
  const weeklyTotalMinutes = useMemo(
    () => blocks.reduce((sum, b) => sum + (new Date(b.end_at) - new Date(b.start_at)) / 60000, 0),
    [blocks],
  );
  const weeklyTotalLabel = `+${formatHoursMinutes(weeklyTotalMinutes)}`;

  const headerTitle = useMemo(() => {
    if (activeView === "day") return "일간 타임테이블";
    if (activeView === "month") return "월간 캘린더";
    if (activeView === "year") return "연간 캘린더";
    return "주간 타임테이블";
  }, [activeView]);

  const headerSub = useMemo(() => {
    if (activeView === "day") {
      return `${viewDate.getFullYear()}.${pad2(viewDate.getMonth() + 1)}.${pad2(viewDate.getDate())}`;
    }
    if (activeView === "month") {
      return `${viewDate.getFullYear()}년 ${viewDate.getMonth() + 1}월`;
    }
    if (activeView === "year") {
      return `${viewDate.getFullYear()}년`;
    }
    return `${fmtDate(weekStart)} – ${fmtDate(addDays(weekEnd, -1))}`;
  }, [activeView, viewDate, weekStart, weekEnd]);

  const dayLabelForDate = useMemo(() => DAYS_SUN[viewDate.getDay()], [viewDate]);

  const eventsByDate = useMemo(() => {
    const map = new Map();
    blocks.forEach((b) => {
      const start = new Date(b.start_at);
      const key = dateKey(start);
      const list = map.get(key) ?? [];
      list.push({ ...b, _start: start, _end: new Date(b.end_at) });
      map.set(key, list);
    });
    map.forEach((list) => list.sort((a, b) => a._start - b._start));
    return map;
  }, [blocks]);

  const monthCalendarStart = useMemo(
    () => startOfWeek(monthStart, settings.week_start_day),
    [monthStart, settings.week_start_day],
  );
  const monthCalendarDays = useMemo(
    () => Array.from({ length: 42 }, (_, i) => addDays(monthCalendarStart, i)),
    [monthCalendarStart],
  );
  const yearMonths = useMemo(
    () => Array.from({ length: 12 }, (_, i) => new Date(viewDate.getFullYear(), i, 1)),
    [viewDate],
  );

  useEffect(() => {
    const el = gridWrapRef.current;
    if (!el || autoScrollDoneRef.current) return;

    if (activeView !== "week" && activeView !== "day") return;

    // Only auto-scroll when the current date is within the displayed range.
    const now = new Date(nowTick);
    const rangeStartForScroll = activeView === "day" ? dayStart : weekStart;
    const rangeEndForScroll = activeView === "day" ? dayEnd : weekEnd;
    if (now < rangeStartForScroll || now >= rangeEndForScroll) return;

    if (!todayLine) return;

    // Scroll so "now" line is a bit below the sticky header.
    const target = Math.max(0, todayLine.top - 140);
    el.scrollTop = target;
    autoScrollDoneRef.current = true;
  }, [activeView, dayStart.getTime(), dayEnd.getTime(), weekStart.getTime(), weekEnd.getTime(), todayLine, nowTick]);

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
      <Sidebar />

      {/* Main */}
      <main style={styles.main}>
        {/* Header */}
        <div style={styles.header}>
          <div>
            <div style={styles.hTitle}>{headerTitle}</div>
            <div style={styles.hSub}>{headerSub}</div>
          </div>

          <div style={styles.headerRight}>
            <div style={styles.navGroup}>
              <button style={styles.iconBtn} onClick={() => shiftView(-1)} aria-label="이전">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M15 6l-6 6 6 6" stroke="#0f172a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button style={styles.btnGhost} onClick={goToday}>오늘</button>
              <button style={styles.iconBtn} onClick={() => shiftView(1)} aria-label="다음">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M9 6l6 6-6 6" stroke="#0f172a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
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

        {/* Grid */}
        <div style={styles.gridWrap} ref={gridWrapRef}>
          {activeView === "week" && (
            <>
              <div style={{ ...styles.dayHeaderRow, gap: gridGap, padding: headerPadding }}>
                <div style={{ width: 64, display: "grid", placeItems: "center", fontSize: 12, opacity: 0.7 }}>
                  시간
                </div>
                <div style={{ ...styles.dayHeaderCols, gap: gridGap }}>
                  {dayLabels.map((d, idx) => {
                    const date = addDays(weekStart, idx);
                    const isToday = isSameDay(date, today);
                    return (
                      <div
                        key={`${d}-${idx}`}
                        style={{ ...styles.dayHeaderCell, ...(isToday ? styles.dayHeaderToday : {}), minWidth: dayColWidth }}
                      >
                        <div style={{ fontWeight: 600 }}>{d}</div>
                        <div style={{ fontSize: 12, opacity: 0.7 }}>{fmtDate(date)}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div style={{ ...styles.bodyRow, gap: gridGap, padding: rowPadding }}>
                <div style={{ width: 64, position: "relative" }}>
                  {Array.from({ length: hourCount }).map((_, i) => {
                    const hour = displayStartHour + i;
                    const top = (hour * 60 - gridStartMin) * pxPerMin;
                    return (
                      <div key={hour} style={{ position: "absolute", top, left: 0, fontSize: 12, opacity: 0.7 }}>
                        {pad2(hour)}:00
                      </div>
                    );
                  })}
                </div>

                <div
                  style={{
                    ...styles.dayCols,
                    height: gridHeight,
                    gap: gridGap,
                    minWidth: 7 * dayColWidth + 6 * gridGap,
                  }}
                >
                  {dayLabels.map((_, dayIndex) => {
                    const dayDate = addDays(weekStart, dayIndex);
                    const dayKey = getDayKeyForIndex(dayIndex);
                    const dayBlocks = blocks
                      .map((b) => {
                        const override = dragOverrides[b.id];
                        const start = override ? override.start : new Date(b.start_at);
                        const end = override ? override.end : new Date(b.end_at);
                        return { ...b, _start: start, _end: end };
                      })
                      .filter(b => isSameDay(b._start, dayDate));
                    const laidOut = layoutOverlaps(dayBlocks);
                    const fixedForDay = getFixedBlocks(dayIndex);

                    return (
                      <div
                        key={dayIndex}
                        className="tg-daycol"
                        data-day-index={dayIndex}
                        data-day-key={dayKey}
                        style={{
                          ...styles.dayCol,
                          ...(blockMode ? styles.dayColBlockMode : {}),
                          cursor: blockMode ? "crosshair" : "pointer",
                          minWidth: dayColWidth,
                        }}
                        onMouseDown={(e) => handleBlockMouseDown(e, dayKey)}
                        onClick={(e) => {
                          if (blockMode) return;
                          const rect = e.currentTarget.getBoundingClientRect();
                          const y = e.clientY - rect.top;
                          const rawMin = gridStartMin + y / pxPerMin;
                          const startMin = snapMinute(rawMin);
                          const endMin = startMin + 60;
                          const dayStartLocal = new Date(dayDate);
                          dayStartLocal.setHours(0, 0, 0, 0);
                          const preset = {
                            start_at: toLocalISOStringFromParts(dayStartLocal, startMin),
                            end_at: toLocalISOStringFromParts(dayStartLocal, endMin),
                          };
                          openCreate(preset);
                        }}
                      >
                        {Array.from({ length: hourCount }).map((_, i) => (
                          <div
                            key={i}
                            style={{
                              position: "absolute",
                              top: (i * 60) * pxPerMin,
                              left: 0,
                              right: 0,
                              height: 0,
                              borderTop: "1px solid rgba(15,23,42,0.06)",
                              zIndex: 1,
                            }}
                          />
                        ))}

                        {getBlockedRanges(dayIndex).map((range) => (
                          <div
                            key={`blocked-${dayIndex}-${range.startSlot}-${range.endSlot}`}
                            style={{
                              ...styles.blockedSlot,
                              top: range.startSlot * BLOCK_MIN * pxPerMin,
                              height: (range.endSlot - range.startSlot + 1) * BLOCK_MIN * pxPerMin,
                            }}
                          />
                        ))}

                        {getTemplateBlockedRanges(dayIndex).map((range) => (
                          <div
                            key={`blocked-template-${dayIndex}-${range.startSlot}-${range.endSlot}`}
                            style={{
                              ...styles.blockedTemplateSlot,
                              top: range.startSlot * BLOCK_MIN * pxPerMin,
                              height: (range.endSlot - range.startSlot + 1) * BLOCK_MIN * pxPerMin,
                            }}
                          />
                        ))}

                        {dragSelect && dragSelect.dayKey === dayKey && (
                          <div
                            style={{
                              ...styles.blockedSlotPreview,
                              top: Math.min(dragSelect.startSlot, dragSelect.endSlot) * BLOCK_MIN * pxPerMin,
                              height: (Math.abs(dragSelect.endSlot - dragSelect.startSlot) + 1) * BLOCK_MIN * pxPerMin,
                            }}
                          />
                        )}

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

                        {fixedForDay.map((item) => {
                          const top = (clamp(item.startMin, gridStartMin, gridEndMin) - gridStartMin) * pxPerMin;
                          const height = (clamp(item.endMin, gridStartMin, gridEndMin) - clamp(item.startMin, gridStartMin, gridEndMin)) * pxPerMin;
                          return (
                            <div
                              key={item.id}
                              style={{
                                ...styles.fixedBlock,
                                top,
                                height: Math.max(24, height),
                              }}
                            >
                              <div style={{ fontWeight: 600, fontSize: 12.5 }}>{item.title}</div>
                              <div style={{ fontSize: 11, opacity: 0.7 }}>
                                {pad2(Math.floor(item.startMin / 60))}:{pad2(item.startMin % 60)}–
                                {pad2(Math.floor(item.endMin / 60))}:{pad2(item.endMin % 60)}
                              </div>
                            </div>
                          );
                        })}
                        {laidOut.map((b) => {
                          const startMin = minutesFromDayStart(b._start);
                          const endMin = minutesFromDayStart(b._end);
                          const top = (clamp(startMin, gridStartMin, gridEndMin) - gridStartMin) * pxPerMin;
                          const height = (clamp(endMin, gridStartMin, gridEndMin) - clamp(startMin, gridStartMin, gridEndMin)) * pxPerMin;
                          const gap = 6;
                          const widthPct = 100 / (b._colCount || 1);
                          const leftPct = (b._col || 0) * widthPct;

                          return (
                            <div
                              key={b.id}
                              onClick={(ev) => {
                                ev.stopPropagation();
                                if (blockMode) return;
                                if (Date.now() - dragJustEndedRef.current < 250) return;
                                openEdit(b);
                              }}
                              onMouseDown={(ev) => handleBlockDragStart(ev, b)}
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
                                cursor: blockMode ? "default" : "grab",
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
            </>
          )}

          {activeView === "day" && (
            <>
              <div style={{ ...styles.dayHeaderRow, gap: gridGap, padding: headerPadding }}>
                <div style={{ width: 64, display: "grid", placeItems: "center", fontSize: 12, opacity: 0.7 }}>
                  시간
                </div>
                <div style={{ ...styles.dayHeaderCols, gap: gridGap, gridTemplateColumns: "1fr" }}>
                  <div style={{ ...styles.dayHeaderCell, minWidth: dayColWidth }}>
                    <div style={{ fontWeight: 600 }}>{dayLabelForDate}</div>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>{fmtDate(viewDate)}</div>
                  </div>
                </div>
              </div>

              <div style={{ ...styles.bodyRow, gap: gridGap, padding: rowPadding }}>
                <div style={{ width: 64, position: "relative" }}>
                  {Array.from({ length: hourCount }).map((_, i) => {
                    const hour = displayStartHour + i;
                    const top = (hour * 60 - gridStartMin) * pxPerMin;
                    return (
                      <div key={hour} style={{ position: "absolute", top, left: 0, fontSize: 12, opacity: 0.7 }}>
                        {pad2(hour)}:00
                      </div>
                    );
                  })}
                </div>

                <div
                  style={{
                    ...styles.dayCols,
                    height: gridHeight,
                    gap: gridGap,
                    gridTemplateColumns: "1fr",
                    minWidth: dayColWidth,
                  }}
                >
                  {(() => {
                    const dayDate = new Date(viewDate);
                    const dayKey = getDayKeyForDate(dayDate);
                    const dayBlocks = blocks
                      .map((b) => {
                        const override = dragOverrides[b.id];
                        const start = override ? override.start : new Date(b.start_at);
                        const end = override ? override.end : new Date(b.end_at);
                        return { ...b, _start: start, _end: end };
                      })
                      .filter(b => isSameDay(b._start, dayDate));
                    const laidOut = layoutOverlaps(dayBlocks);
                    const fixedForDay = getFixedBlocksForDay(dayDate.getDay());

                    return (
                      <div
                        className="tg-daycol"
                        data-day-index={0}
                        data-day-key={dayKey}
                        style={{
                          ...styles.dayCol,
                          ...(blockMode ? styles.dayColBlockMode : {}),
                          cursor: blockMode ? "crosshair" : "pointer",
                          minWidth: dayColWidth,
                        }}
                        onMouseDown={(e) => handleBlockMouseDown(e, dayKey)}
                        onClick={(e) => {
                          if (blockMode) return;
                          const rect = e.currentTarget.getBoundingClientRect();
                          const y = e.clientY - rect.top;
                          const rawMin = gridStartMin + y / pxPerMin;
                          const startMin = snapMinute(rawMin);
                          const endMin = startMin + 60;
                          const dayStartLocal = new Date(dayDate);
                          dayStartLocal.setHours(0, 0, 0, 0);
                          const preset = {
                            start_at: toLocalISOStringFromParts(dayStartLocal, startMin),
                            end_at: toLocalISOStringFromParts(dayStartLocal, endMin),
                          };
                          openCreate(preset);
                        }}
                      >
                        {Array.from({ length: hourCount }).map((_, i) => (
                          <div
                            key={i}
                            style={{
                              position: "absolute",
                              top: (i * 60) * pxPerMin,
                              left: 0,
                              right: 0,
                              height: 0,
                              borderTop: "1px solid rgba(15,23,42,0.06)",
                              zIndex: 1,
                            }}
                          />
                        ))}

                        {getBlockedRangesForDate(dayDate).map((range) => (
                          <div
                            key={`blocked-day-${range.startSlot}-${range.endSlot}`}
                            style={{
                              ...styles.blockedSlot,
                              top: range.startSlot * BLOCK_MIN * pxPerMin,
                              height: (range.endSlot - range.startSlot + 1) * BLOCK_MIN * pxPerMin,
                            }}
                          />
                        ))}

                        {getTemplateBlockedRangesForDay(dayDate.getDay()).map((range) => (
                          <div
                            key={`blocked-template-day-${range.startSlot}-${range.endSlot}`}
                            style={{
                              ...styles.blockedTemplateSlot,
                              top: range.startSlot * BLOCK_MIN * pxPerMin,
                              height: (range.endSlot - range.startSlot + 1) * BLOCK_MIN * pxPerMin,
                            }}
                          />
                        ))}

                        {dragSelect && dragSelect.dayKey === dayKey && (
                          <div
                            style={{
                              ...styles.blockedSlotPreview,
                              top: Math.min(dragSelect.startSlot, dragSelect.endSlot) * BLOCK_MIN * pxPerMin,
                              height: (Math.abs(dragSelect.endSlot - dragSelect.startSlot) + 1) * BLOCK_MIN * pxPerMin,
                            }}
                          />
                        )}

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

                        {fixedForDay.map((item) => {
                          const top = (clamp(item.startMin, gridStartMin, gridEndMin) - gridStartMin) * pxPerMin;
                          const height = (clamp(item.endMin, gridStartMin, gridEndMin) - clamp(item.startMin, gridStartMin, gridEndMin)) * pxPerMin;
                          return (
                            <div
                              key={item.id}
                              style={{
                                ...styles.fixedBlock,
                                top,
                                height: Math.max(24, height),
                              }}
                            >
                              <div style={{ fontWeight: 600, fontSize: 12.5 }}>{item.title}</div>
                              <div style={{ fontSize: 11, opacity: 0.7 }}>
                                {pad2(Math.floor(item.startMin / 60))}:{pad2(item.startMin % 60)}–
                                {pad2(Math.floor(item.endMin / 60))}:{pad2(item.endMin % 60)}
                              </div>
                            </div>
                          );
                        })}
                        {laidOut.map((b) => {
                          const startMin = minutesFromDayStart(b._start);
                          const endMin = minutesFromDayStart(b._end);
                          const top = (clamp(startMin, gridStartMin, gridEndMin) - gridStartMin) * pxPerMin;
                          const height = (clamp(endMin, gridStartMin, gridEndMin) - clamp(startMin, gridStartMin, gridEndMin)) * pxPerMin;
                          const gap = 6;
                          const widthPct = 100 / (b._colCount || 1);
                          const leftPct = (b._col || 0) * widthPct;

                          return (
                            <div
                              key={b.id}
                              onClick={(ev) => {
                                ev.stopPropagation();
                                if (blockMode) return;
                                if (Date.now() - dragJustEndedRef.current < 250) return;
                                openEdit(b);
                              }}
                              onMouseDown={(ev) => handleBlockDragStart(ev, b)}
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
                                cursor: blockMode ? "default" : "grab",
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
                  })()}
                </div>
              </div>
            </>
          )}

          {activeView === "month" && (
            <div style={styles.monthWrap}>
              <div style={styles.monthHeaderRow}>
                {dayLabels.map((label) => (
                  <div key={label} style={styles.monthHeaderCell}>{label}</div>
                ))}
              </div>
              <div style={styles.monthGrid}>
                {monthCalendarDays.map((date) => {
                  const key = dateKey(date);
                  const items = eventsByDate.get(key) ?? [];
                  const inMonth = date.getMonth() === viewDate.getMonth();
                  const isToday = isSameDay(date, today);
                  return (
                    <div
                      key={key}
                      style={{
                        ...styles.monthCell,
                        ...(!inMonth ? styles.monthCellMuted : {}),
                        ...(isToday ? styles.monthCellToday : {}),
                      }}
                    >
                      <div style={styles.monthCellDate}>{date.getDate()}</div>
                      <div style={styles.monthCellEvents}>
                        {items.slice(0, 2).map((ev) => (
                          <div key={`${ev.id}-${key}`} style={styles.monthEvent}>
                            {ev.title}
                          </div>
                        ))}
                        {items.length > 2 && (
                          <div style={styles.monthMore}>+{items.length - 2}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeView === "year" && (
            <div style={styles.yearWrap}>
              <div style={styles.yearGrid}>
                {yearMonths.map((monthDate) => {
                  const monthStartLocal = startOfMonth(monthDate);
                  const miniStart = startOfWeek(monthStartLocal, settings.week_start_day);
                  const miniDays = Array.from({ length: 42 }, (_, i) => addDays(miniStart, i));
                  return (
                    <div key={monthDate.getMonth()} style={styles.yearCard}>
                      <div style={styles.yearMonthTitle}>{monthDate.getMonth() + 1}월</div>
                      <div style={styles.miniGrid}>
                        {miniDays.map((date) => {
                          const inMonth = date.getMonth() === monthDate.getMonth();
                          const key = dateKey(date);
                          const hasEvent = (eventsByDate.get(key)?.length ?? 0) > 0 && inMonth;
                          return (
                            <div
                              key={`${monthDate.getMonth()}-${key}`}
                              style={{ ...styles.miniCell, ...(!inMonth ? styles.miniCellMuted : {}) }}
                            >
                              <span>{date.getDate()}</span>
                              {hasEvent && <span style={styles.miniDot} />}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {err && <p style={{ color: "crimson" }}>{err}</p>}

      </main>

      {/* Right panel */}
      <aside style={styles.right}>
        <button
          style={{ ...styles.blockModeButton, ...(blockMode ? styles.blockModeButtonActive : {}) }}
          onClick={() => setBlockMode((v) => !v)}
        >
          <span style={{ ...styles.blockModeDot, ...(blockMode ? styles.blockModeDotActive : {}) }} />
          시간 차단 모드
        </button>

        <div style={styles.panelCard}>
          <div style={styles.panelHeader}>
            <span style={styles.dotBlue} />
            <span style={styles.panelTitle}>Focus Timer</span>
          </div>
          <div style={styles.timerRow}>
            <div style={styles.timerUnit}>
              <div style={styles.timerBox}>
                <div style={styles.timerValue}>{focusHours}</div>
              </div>
              <div style={styles.timerLabel}>HR</div>
            </div>
            <div style={styles.timerSeparator}>
              <span style={styles.timerSeparatorDot} />
              <span style={styles.timerSeparatorDot} />
            </div>
            <div style={styles.timerUnit}>
              <div style={styles.timerBox}>
                <div style={styles.timerValue}>{focusMinutes}</div>
              </div>
              <div style={styles.timerLabel}>MIN</div>
            </div>
            <div style={styles.timerSeparator}>
              <span style={styles.timerSeparatorDot} />
              <span style={styles.timerSeparatorDot} />
            </div>
            <div style={styles.timerUnit}>
              <div style={styles.timerBox}>
                <div style={styles.timerValue}>{focusSecs}</div>
              </div>
              <div style={styles.timerLabel}>SEC</div>
            </div>
          </div>
          <div style={styles.timerActions}>
            <button
              style={styles.startBtn}
              onClick={() => setFocusRunning((v) => !v)}
            >
              <span style={styles.startIcon} aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M8 6l10 6-10 6V6z" stroke="white" strokeWidth="1.6" strokeLinejoin="round" />
                </svg>
              </span>
              {focusRunning ? "Pause Focus" : "Start Focus"}
            </button>
            <button style={styles.resetBtn} onClick={() => { setFocusSeconds(settings.focus_duration * 60); setFocusRunning(false); }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M20 12a8 8 0 10-2.34 5.66"
                  stroke="#475569"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
                <path d="M20 7v5h-5" stroke="#475569" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>

        <div style={{ ...styles.panelCard, ...styles.aiPanelCard }}>
          <div style={styles.panelHeader}>
            <span style={styles.dotPurple} />
            <span style={styles.panelTitle}>AI 스케줄 도우미</span>
            <span style={styles.panelBadge}>{chatLoading ? "응답 중" : "대기 중"}</span>
          </div>
          <div style={styles.aiBody} ref={chatScrollRef}>
            {messages.map((m) => (
              <div
                key={m.id}
                style={{ ...styles.aiBubble, ...(m.role === "user" ? styles.aiBubbleUser : {}) }}
              >
                {m.text}
              </div>
            ))}
          </div>
          <textarea
            style={styles.aiTextarea}
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={handleChatKeyDown}
            placeholder="AI에게 스케줄 관련 질문을 하세요..."
            disabled={chatLoading}
          />
          <button
            style={{ ...styles.aiSend, ...(chatLoading ? styles.chatSendDisabled : {}) }}
            onClick={sendChat}
            disabled={chatLoading}
          >
            전송
          </button>
          <div style={styles.aiHint}>Enter 전송 · Shift+Enter 줄바꿈</div>
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

const styles = {
  shell: {
    minHeight: "100vh",
    height: "100vh",
    display: "grid",
    gridTemplateColumns: "96px 1fr 360px",
    background: "#f6f7fb",
    position: "relative",
    overflow: "hidden",
    color: "#0f172a",
    fontFamily: "'Pretendard','SF Pro Display','Apple SD Gothic Neo','Noto Sans KR',sans-serif",
  },
  shellBackdrop: {
    position: "absolute",
    inset: 0,
    background: "transparent",
    pointerEvents: "none",
    zIndex: 0,
  },
  main: {
    position: "relative",
    zIndex: 1,
    padding: 24,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 16,
  },
  hTitle: { fontSize: 24, fontWeight: 900, letterSpacing: "-0.4px" },
  hSub: { fontSize: 12, opacity: 0.7 },
  headerRight: { display: "flex", gap: 12, alignItems: "center" },
  navGroup: { display: "flex", gap: 8, alignItems: "center" },
  iconBtn: {
    border: "1px solid rgba(15,23,42,0.14)",
    background: "white",
    width: 34,
    height: 34,
    borderRadius: 999,
    cursor: "pointer",
    display: "grid",
    placeItems: "center",
    lineHeight: 1,
    padding: 0,
  },
  btnGhost: {
    padding: "0 18px",
    borderRadius: 999,
    border: "1px solid rgba(15,23,42,0.14)",
    background: "white",
    cursor: "pointer",
    color: "#0f172a",
    fontWeight: 600,
    fontSize: 13,
    height: 34,
    display: "grid",
    placeItems: "center",
  },
  viewSwitch: {
    display: "flex",
    gap: 4,
    padding: 4,
    borderRadius: 999,
    background: "rgba(15,23,42,0.06)",
    border: "1px solid rgba(15,23,42,0.08)",
    alignItems: "center",
    height: 34,
  },
  viewSwitchItem: {
    border: "none",
    background: "transparent",
    padding: "6px 12px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    color: "#475569",
    cursor: "pointer",
    minWidth: 44,
    height: 24,
    display: "grid",
    placeItems: "center",
    textAlign: "center",
  },
  viewSwitchItemActive: {
    background: "#0f172a",
    color: "white",
    boxShadow: "0 8px 18px rgba(15,23,42,0.18)",
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
    zIndex: 20,
    display: "flex",
    gap: 8,
    padding: "14px 14px 10px",
    background: "rgba(255,255,255,0.98)",
    backdropFilter: "blur(10px)",
    borderBottom: "1px solid rgba(15,23,42,0.06)",
    boxShadow: "0 6px 14px rgba(15,23,42,0.06)",
  },
  dayHeaderCols: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8, width: "100%" },
  dayHeaderCell: {
    minWidth: DEFAULT_DAY_COL_WIDTH,
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
    minWidth: 7 * DEFAULT_DAY_COL_WIDTH + 6 * 8,
  },
  dayCol: {
    position: "relative",
    background: "rgba(255,255,255,0.6)",
    borderRadius: 18,
    border: "1px solid rgba(15,23,42,0.08)",
    minWidth: DEFAULT_DAY_COL_WIDTH,
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
  blockedTemplateSlot: {
    position: "absolute",
    left: 6,
    right: 6,
    borderRadius: 12,
    background: "rgba(248,113,113,0.08)",
    border: "1px dashed rgba(248,113,113,0.4)",
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
  fixedBlock: {
    position: "absolute",
    left: 8,
    right: 8,
    borderRadius: 12,
    padding: 8,
    background: "rgba(15,23,42,0.08)",
    border: "1px solid rgba(15,23,42,0.2)",
    boxShadow: "0 6px 14px rgba(15,23,42,0.08)",
    zIndex: 4,
    pointerEvents: "none",
    color: "#0f172a",
  },
  right: {
    position: "relative",
    zIndex: 1,
    padding: 20,
    borderLeft: "1px solid rgba(15,23,42,0.08)",
    background: "white",
    display: "flex",
    flexDirection: "column",
    gap: 16,
    overflow: "hidden",
    height: "100%",
  },
  blockModeButton: {
    width: "100%",
    padding: "10px 14px",
    borderRadius: 999,
    border: "1px solid rgba(15,23,42,0.12)",
    background: "rgba(15,23,42,0.04)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
  },
  blockModeButtonActive: {
    background: "#0f172a",
    color: "white",
    borderColor: "#0f172a",
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
  panelCard: {
    background: "white",
    borderRadius: 18,
    border: "1px solid rgba(15,23,42,0.08)",
    padding: 16,
    display: "grid",
    gap: 14,
    boxShadow: "0 12px 24px rgba(15,23,42,0.06)",
    boxSizing: "border-box",
  },
  aiPanelCard: {
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
  },
  panelHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontWeight: 700,
  },
  panelTitle: { fontSize: 13 },
  panelBadge: {
    marginLeft: "auto",
    fontSize: 11,
    background: "rgba(15,23,42,0.08)",
    padding: "4px 8px",
    borderRadius: 999,
    color: "#64748b",
  },
  dotBlue: {
    width: 8,
    height: 8,
    borderRadius: 999,
    background: "#3b82f6",
  },
  dotPurple: {
    width: 8,
    height: 8,
    borderRadius: 999,
    background: "#8b5cf6",
  },
  timerRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    width: "100%",
    flexWrap: "nowrap",
    boxSizing: "border-box",
    maxWidth: "100%",
  },
  timerUnit: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
  },
  timerBox: {
    background: "rgba(15,23,42,0.04)",
    borderRadius: 20,
    width: 72,
    height: 66,
    display: "grid",
    placeItems: "center",
    textAlign: "center",
  },
  timerValue: { fontSize: 24, fontWeight: 800 },
  timerLabel: { fontSize: 11, color: "#94a3b8", letterSpacing: "0.6px" },
  timerSeparator: {
    height: 66,
    width: 14,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    gap: 6,
    alignItems: "center",
  },
  timerSeparatorDot: {
    width: 5,
    height: 5,
    borderRadius: 999,
    background: "#94a3b8",
    opacity: 0.7,
  },
  timerActions: { display: "flex", gap: 12, alignItems: "center", width: "100%", maxWidth: "100%" },
  startBtn: {
    flex: 1,
    padding: "10px 18px",
    height: 48,
    borderRadius: 18,
    border: "none",
    background: "#2563eb",
    color: "white",
    fontWeight: 700,
    fontSize: 14,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    lineHeight: 1,
    minWidth: 0,
  },
  startIcon: {
    width: 18,
    height: 18,
    display: "grid",
    placeItems: "center",
    fontSize: 16,
  },
  resetBtn: {
    width: 44,
    height: 48,
    borderRadius: 16,
    border: "1px solid rgba(15,23,42,0.08)",
    background: "#f1f5f9",
    cursor: "pointer",
    fontWeight: 600,
    color: "#475569",
    display: "grid",
    placeItems: "center",
    lineHeight: 1,
    flexShrink: 0,
  },
  aiBody: {
    maxHeight: "none",
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    display: "grid",
    gap: 10,
  },
  aiBubble: {
    background: "rgba(15,23,42,0.04)",
    padding: "10px 12px",
    borderRadius: 14,
    fontSize: 12,
    lineHeight: 1.5,
  },
  aiBubbleUser: {
    background: "rgba(59,130,246,0.12)",
    border: "1px solid rgba(59,130,246,0.25)",
    alignSelf: "flex-end",
  },
  aiTextarea: {
    width: "100%",
    minHeight: 80,
    border: "1px solid rgba(15,23,42,0.12)",
    borderRadius: 14,
    padding: "10px 12px",
    fontSize: 12,
    resize: "none",
  },
  aiSend: {
    width: "100%",
    borderRadius: 14,
    border: "none",
    background: "#0f172a",
    color: "white",
    fontWeight: 700,
    cursor: "pointer",
    padding: "10px 12px",
  },
  chatSendDisabled: {
    opacity: 0.65,
    cursor: "not-allowed",
  },
  aiHint: {
    fontSize: 11,
    color: "#94a3b8",
    textAlign: "center",
  },
  monthWrap: {
    display: "grid",
    gap: 12,
    padding: 16,
  },
  monthHeaderRow: {
    display: "grid",
    gridTemplateColumns: "repeat(7, 1fr)",
    gap: 8,
    padding: "0 8px",
  },
  monthHeaderCell: {
    textAlign: "center",
    fontSize: 12,
    fontWeight: 600,
    color: "#64748b",
  },
  monthGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(7, 1fr)",
    gap: 8,
    padding: "0 8px 16px",
  },
  monthCell: {
    minHeight: 90,
    borderRadius: 16,
    background: "rgba(15,23,42,0.03)",
    border: "1px solid rgba(15,23,42,0.06)",
    padding: "8px 8px 6px",
    display: "grid",
    gap: 6,
  },
  monthCellMuted: {
    opacity: 0.45,
  },
  monthCellToday: {
    borderColor: "rgba(59,130,246,0.6)",
    boxShadow: "0 0 0 1px rgba(59,130,246,0.35) inset",
  },
  monthCellDate: {
    fontSize: 12,
    fontWeight: 700,
    color: "#0f172a",
  },
  monthCellEvents: {
    display: "grid",
    gap: 4,
  },
  monthEvent: {
    fontSize: 11,
    padding: "4px 6px",
    borderRadius: 8,
    background: "rgba(59,130,246,0.12)",
    border: "1px solid rgba(59,130,246,0.2)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  monthMore: {
    fontSize: 11,
    color: "#64748b",
  },
  yearWrap: {
    padding: 16,
  },
  yearGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: 16,
  },
  yearCard: {
    background: "rgba(15,23,42,0.03)",
    border: "1px solid rgba(15,23,42,0.06)",
    borderRadius: 16,
    padding: 12,
    display: "grid",
    gap: 8,
  },
  yearMonthTitle: {
    fontSize: 12,
    fontWeight: 700,
    color: "#0f172a",
  },
  miniGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(7, 1fr)",
    gap: 4,
  },
  miniCell: {
    fontSize: 9,
    color: "#334155",
    height: 18,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    borderRadius: 6,
  },
  miniCellMuted: {
    color: "#94a3b8",
  },
  miniDot: {
    width: 4,
    height: 4,
    borderRadius: 999,
    background: "#3b82f6",
  },
};
