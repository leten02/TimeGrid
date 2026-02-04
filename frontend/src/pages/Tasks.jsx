import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Sidebar from "../components/Sidebar";
import { api } from "../lib/api";
import { useSettings } from "../lib/useSettings";

const BLOCKED_SLOTS_KEY = "timegrid:blockedSlots:v2";
const BLOCK_MIN = 15;

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

const formatDeadline = (iso) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

const formatTimeRange = (minutes) => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}분`;
  if (mins === 0) return `${hours}시간`;
  return `${hours}시간 ${mins}분`;
};

const formatEstimatedLabel = (task) => {
  const minutes = getEstimatedMinutes(task);
  if (!minutes) return "예상: 미입력";
  const base = formatTimeRange(minutes);
  return task.estimated_by_ai ? `AI 예상: ${base}` : `예상: ${base}`;
};

const formatDateTime = (iso) => {
  const d = new Date(iso);
  const date = `${d.getMonth() + 1}/${d.getDate()}`;
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${date} ${time}`;
};

const PRIORITY_OPTIONS = [
  { key: "high", label: "높음", color: "#ef4444" },
  { key: "medium", label: "보통", color: "#f59e0b" },
  { key: "low", label: "낮음", color: "#22c55e" },
];

const PRIORITY_IMPORTANCE = { high: 5, medium: 3, low: 1 };

const PREFERRED_TIME_OPTIONS = [
  { key: "morning", label: "오전", sub: "9-12시", emoji: "🌅" },
  { key: "afternoon", label: "오후", sub: "13-17시", emoji: "🌤️" },
  { key: "evening", label: "저녁", sub: "18-21시", emoji: "🌆" },
  { key: "any", label: "상관없음", sub: "", emoji: "⏱️" },
];

const FOCUS_NEED_OPTIONS = [
  { key: "high", label: "높음", sub: "조용한 오전" },
  { key: "medium", label: "보통", sub: "평소 시간" },
  { key: "low", label: "낮음", sub: "언제든" },
];

const DURATION_PRESETS = [15, 30, 45, 60, 90, 120];

const PREFERRED_LABELS = {
  morning: "오전",
  afternoon: "오후",
  evening: "저녁",
  any: "상관없음",
};

const FOCUS_LABELS = {
  high: "높음",
  medium: "보통",
  low: "낮음",
};

const getEstimatedMinutes = (task) => task.estimated_minutes ?? task.estimatedMinutes ?? 0;

const parseHour = (value, fallback) => {
  if (!value || typeof value !== "string") return fallback;
  const [h] = value.split(":");
  const hour = Number(h);
  return Number.isNaN(hour) ? fallback : hour;
};

const toSchedulerTask = (task) => ({
  ...task,
  estimatedMinutes: task.estimated_minutes ?? task.estimatedMinutes,
  preferredTime: task.preferred_time ?? task.preferredTime,
  focusNeed: task.focus_need ?? task.focusNeed,
  splittable: task.splittable,
});

const parseBlockedRanges = (keys) => {
  return keys.map((key) => {
    const [dateStr, slotStr] = key.split("|");
    const slot = Number(slotStr);
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    return {
      date,
      startMin: slot * BLOCK_MIN,
      endMin: slot * BLOCK_MIN + BLOCK_MIN,
    };
  });
};

export default function Tasks() {
  const { settings } = useSettings();
  const [tasks, setTasks] = useState([]);
  const [fixedSchedules, setFixedSchedules] = useState([]);
  const [blockedTemplates, setBlockedTemplates] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [notice, setNotice] = useState("");
  const [proposedBlocks, setProposedBlocks] = useState([]);
  const [unscheduled, setUnscheduled] = useState([]);
  const rescheduleCheckedRef = useRef(false);

  const [form, setForm] = useState({
    title: "",
    description: "",
    duration: "",
    deadline: "",
    priority_tag: "medium",
    splittable: true,
    preferred_time: "any",
    focus_need: "medium",
    category: "공부",
  });

  const pendingTasks = useMemo(
    () => tasks.filter((task) => task.status !== "done"),
    [tasks],
  );
  const doneTasks = useMemo(
    () => tasks.filter((task) => task.status === "done"),
    [tasks],
  );

  const loadData = useCallback(async () => {
    try {
      const results = await Promise.allSettled([
        api("/tasks"),
        api("/fixed-schedules"),
        api("/blocked-templates"),
      ]);
      const [tasksResult, fixedResult, blockedResult] = results;

      if (tasksResult.status === "fulfilled") {
        setTasks(tasksResult.value);
      } else {
        setTasks([]);
        setNotice("태스크를 불러오지 못했어요.");
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
      setNotice("데이터를 불러오지 못했어요. 새로고침해 주세요.");
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const runReschedule = useCallback(async () => {
    if (rescheduleCheckedRef.current) return;
    rescheduleCheckedRef.current = true;
    try {
      const weekStart = startOfWeek(new Date(), settings.week_start_day);
      const weekEnd = addDays(weekStart, 7);
      let blockedKeys = [];
      if (typeof window !== "undefined") {
        try {
          blockedKeys = JSON.parse(window.localStorage.getItem(BLOCKED_SLOTS_KEY) || "[]");
        } catch {
          blockedKeys = [];
        }
      }
      const blockedRanges = parseBlockedRanges(blockedKeys);
      const startHour = parseHour(settings.grid_start, 6);
      const endHour = parseHour(settings.grid_end, 24);

      const res = await api("/ai/reschedule", {
        method: "POST",
        body: JSON.stringify({
          week_start: weekStart.toISOString(),
          week_end: weekEnd.toISOString(),
          start_hour: startHour,
          end_hour: endHour,
          now: new Date().toISOString(),
          blocked_ranges: blockedRanges.map((item) => ({
            date: item.date.toISOString(),
            start_min: item.startMin,
            end_min: item.endMin,
          })),
        }),
      });

      if (res.notifications && res.notifications.length > 0) {
        setNotice(res.notifications.join(" "));
        await loadData();
      }
    } catch {
      // ignore silent reschedule failures
    }
  }, [settings, loadData]);

  useEffect(() => {
    if (tasks.length >= 0 && fixedSchedules && blockedTemplates) {
      runReschedule();
    }
  }, [tasks, fixedSchedules, blockedTemplates, runReschedule]);

  const addTask = async () => {
    if (!form.title.trim()) return;
    const deadline = form.deadline
      ? new Date(`${form.deadline}T23:59:00`).toISOString()
      : new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    try {
      const importance = PRIORITY_IMPORTANCE[form.priority_tag] ?? 3;
      const estimatedMinutes = form.duration ? Number(form.duration) : null;
      const created = await api("/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description.trim(),
          estimated_minutes: estimatedMinutes,
          deadline,
          importance,
          priority_tag: form.priority_tag,
          splittable: form.splittable,
          preferred_time: form.preferred_time,
          focus_need: form.focus_need,
          category: form.category,
        }),
      });
      const nextTasks = [created, ...tasks];
      setTasks(nextTasks);
      setShowForm(false);
      setForm({
        title: "",
        description: "",
        duration: "",
        deadline: "",
        priority_tag: "medium",
        splittable: true,
        preferred_time: "any",
        focus_need: "medium",
        category: "공부",
      });
      scheduleTasks(nextTasks, settings.auto_schedule);
    } catch {
      setNotice("태스크를 저장하지 못했어요.");
    }
  };

  const toggleDone = async (taskId) => {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return;
    const nextStatus = task.status === "done" ? "pending" : "done";
    try {
      const updated = await api(`/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus }),
      });
      setTasks((prev) => prev.map((item) => (item.id === taskId ? updated : item)));
    } catch {
      setNotice("상태 변경에 실패했어요.");
    }
  };

  const resetTask = async (task) => {
    if (!task) return;
    setNotice("");
    try {
      const weekStart = startOfWeek(new Date(), settings.week_start_day);
      const weekEnd = addDays(weekStart, 7);
      const blocks = await api(
        `/blocks?from_=${encodeURIComponent(weekStart.toISOString())}&to=${encodeURIComponent(weekEnd.toISOString())}`,
      );
      const related = blocks.filter((block) => block.task_id === task.id);
      if (related.length > 0) {
        await Promise.all(
          related.map((block) =>
            api(`/blocks/${block.id}`, {
              method: "DELETE",
            }),
          ),
        );
      }
      await api(`/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "pending" }),
      });
      await scheduleTasks([{ ...task, status: "pending" }], true);
    } catch {
      setNotice("재설정에 실패했어요.");
    }
  };

  const scheduleTasks = async (overrideTasks, autoApply = false) => {
    const baseTasks = overrideTasks ?? tasks;
    const targetTasks = baseTasks.filter((task) => task.status === "pending");
    if (targetTasks.length === 0 || loading) return;
    setLoading(true);
    setNotice("");
    try {
      const weekStart = startOfWeek(new Date(), settings.week_start_day);
      const weekEnd = addDays(weekStart, 7);
      const blocks = await api(
        `/blocks?from_=${encodeURIComponent(weekStart.toISOString())}&to=${encodeURIComponent(weekEnd.toISOString())}`,
      );
      let blockedKeys = [];
      if (typeof window !== "undefined") {
        try {
          blockedKeys = JSON.parse(window.localStorage.getItem(BLOCKED_SLOTS_KEY) || "[]");
        } catch {
          blockedKeys = [];
        }
      }
      const blockedRanges = parseBlockedRanges(blockedKeys);

      const startHour = parseHour(settings.grid_start, 6);
      const endHour = parseHour(settings.grid_end, 24);

      const res = await api("/ai/schedule", {
        method: "POST",
        body: JSON.stringify({
          week_start: weekStart.toISOString(),
          week_end: weekEnd.toISOString(),
          start_hour: startHour,
          end_hour: endHour,
          now: new Date().toISOString(),
          tasks: targetTasks.map((task) => ({
            id: task.id,
            title: task.title,
            estimated_minutes: getEstimatedMinutes(task),
            deadline: task.deadline,
            importance: task.importance,
            priority_tag: task.priority_tag ?? task.priorityTag,
            splittable: task.splittable,
            preferred_time: task.preferred_time ?? task.preferredTime,
            focus_need: task.focus_need ?? task.focusNeed,
          })),
          existing_blocks: blocks.map((b) => ({ start_at: b.start_at, end_at: b.end_at })),
          fixed_schedules: fixedSchedules.map((f) => ({ days: f.days, start: f.start, end: f.end })),
          blocked_templates: blockedTemplates.map((t) => ({ days: t.days, start: t.start, end: t.end })),
          blocked_ranges: blockedRanges.map((item) => ({
            date: item.date.toISOString(),
            start_min: item.startMin,
            end_min: item.endMin,
          })),
        }),
      });

      const proposed = (res.proposed_blocks || []).map((block) => ({
        taskId: block.task_id,
        title: block.title,
        start_at: block.start_at,
        end_at: block.end_at,
      }));
      const unscheduled = res.unscheduled || [];

      if (proposed.length === 0) {
        setNotice("배치 가능한 시간이 없어서 일정 생성이 실패했어요.");
        setLoading(false);
        return;
      }
      if (autoApply) {
        await applyScheduleBlocks(proposed, unscheduled);
        return;
      }
      setProposedBlocks(proposed);
      setUnscheduled(unscheduled);
      if (unscheduled.length > 0) {
        setNotice("일부 태스크는 시간 부족으로 배치되지 않았어요. 미리보기를 확인하세요.");
      }
    } catch (e) {
      setNotice("스케줄 생성 중 오류가 발생했어요. 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  };

  const applyScheduleBlocks = async (blocksToApply, unscheduledList = []) => {
    if (blocksToApply.length === 0 || applying) return;
    const hasUnscheduled = unscheduledList.length > 0;
    setApplying(true);
    setNotice("");
    try {
      await Promise.all(
        blocksToApply.map((block) =>
          api("/blocks", {
            method: "POST",
            body: JSON.stringify({
              title: block.title,
              note: "AI 자동 스케줄",
              task_id: block.taskId,
              start_at: block.start_at,
              end_at: block.end_at,
            }),
          }),
        ),
      );

      const scheduledIds = new Set(blocksToApply.map((b) => b.taskId));
      await Promise.all(
        Array.from(scheduledIds).map((taskId) =>
          api(`/tasks/${taskId}`, {
            method: "PATCH",
            body: JSON.stringify({ status: "scheduled" }),
          }),
        ),
      );

      await loadData();
      setProposedBlocks([]);
      setUnscheduled([]);
      if (hasUnscheduled) {
        setNotice("일부 태스크는 시간 부족으로 배치되지 않았어요.");
      } else {
        setNotice("AI가 태스크를 시간표에 추가했어요.");
      }
    } catch {
      setNotice("일정 적용에 실패했어요. 다시 시도해주세요.");
    } finally {
      setApplying(false);
    }
  };

  const applySchedule = async () => {
    if (proposedBlocks.length === 0 || applying) return;
    await applyScheduleBlocks(proposedBlocks, unscheduled);
  };

  const clearPreview = () => {
    setProposedBlocks([]);
    setUnscheduled([]);
  };

  return (
    <div style={styles.shell}>
      <Sidebar />
      <main style={styles.main}>
        <div style={styles.header}>
          <div>
            <div style={styles.hTitle}>태스크 관리</div>
            <div style={styles.hSub}>진행 중 {pendingTasks.length}개 · 완료됨 {doneTasks.length}개</div>
          </div>
          <div style={styles.headerActions}>
            <button style={styles.btnGhost} onClick={scheduleTasks} disabled={loading}>
              {loading ? "스케줄링 중" : "AI가 시간 찾기"}
            </button>
            <button style={styles.btnPrimary} onClick={() => setShowForm((v) => !v)}>
              + 새 태스크
            </button>
          </div>
        </div>

        {showForm && (
          <section style={styles.formCard}>
            <div style={styles.formRow}>
              <div style={styles.field}>
                <label style={styles.label}>태스크 제목 *</label>
                <input
                  style={styles.input}
                  placeholder="예: 알고리즘 과제"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>예상 소요 시간 (분)</label>
                <input
                  style={styles.input}
                  type="number"
                  min="15"
                  step="15"
                  placeholder="예: 45 (비워두면 AI 추정)"
                  value={form.duration}
                  onChange={(e) => setForm({ ...form, duration: e.target.value })}
                />
                <div style={styles.presetRow}>
                  {DURATION_PRESETS.map((minutes) => (
                    <button
                      key={minutes}
                      type="button"
                      style={{
                        ...styles.presetChip,
                        ...(form.duration === String(minutes) ? styles.presetChipActive : {}),
                      }}
                      onClick={() => setForm({ ...form, duration: String(minutes) })}
                    >
                      {formatTimeRange(minutes)}
                    </button>
                  ))}
                </div>
              </div>
              <div style={styles.field}>
                <label style={styles.label}>마감일</label>
                <input
                  type="date"
                  style={styles.input}
                  value={form.deadline}
                  onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                />
              </div>
            </div>
            <div style={styles.formRow}>
              <div style={styles.field}>
                <label style={styles.label}>우선순위 태그</label>
                <div style={styles.segmentedRow}>
                  {PRIORITY_OPTIONS.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      style={{
                        ...styles.segmentedButton,
                        ...(form.priority_tag === option.key ? styles.segmentedButtonActive : {}),
                      }}
                      onClick={() => setForm({ ...form, priority_tag: option.key })}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div style={styles.field}>
                <label style={styles.label}>분할 가능</label>
                <div style={styles.toggleRow}>
                  <div>
                    <div style={styles.toggleTitle}>여러 시간대로 나눠서 진행</div>
                    <div style={styles.toggleSub}>필요하면 AI가 쪼개서 배치합니다.</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, splittable: !form.splittable })}
                    style={{
                      ...styles.toggleSwitch,
                      ...(form.splittable ? styles.toggleSwitchOn : {}),
                    }}
                  >
                    <span style={{ ...styles.toggleHandle, ...(form.splittable ? styles.toggleHandleOn : {}) }} />
                  </button>
                </div>
              </div>
              <div style={styles.field}>
                <label style={styles.label}>카테고리</label>
                <select
                  style={styles.select}
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                >
                  <option value="공부">공부</option>
                  <option value="업무">업무</option>
                  <option value="개인">개인</option>
                  <option value="기타">기타</option>
                </select>
              </div>
            </div>
            <div style={styles.formRow}>
              <div style={styles.field}>
                <label style={styles.label}>선호 시간대</label>
                <div style={styles.segmentedRow}>
                  {PREFERRED_TIME_OPTIONS.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      style={{
                        ...styles.segmentedButton,
                        ...(form.preferred_time === option.key ? styles.segmentedButtonActive : {}),
                      }}
                      onClick={() => setForm({ ...form, preferred_time: option.key })}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div style={styles.field}>
                <label style={styles.label}>집중도 필요</label>
                <div style={styles.segmentedRow}>
                  {FOCUS_NEED_OPTIONS.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      style={{
                        ...styles.segmentedButton,
                        ...(form.focus_need === option.key ? styles.segmentedButtonActive : {}),
                      }}
                      onClick={() => setForm({ ...form, focus_need: option.key })}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div style={styles.formRow}>
              <div style={styles.field}>
                <label style={styles.label}>메모 (선택사항)</label>
                <textarea
                  style={{ ...styles.input, minHeight: 80, resize: "vertical" }}
                  placeholder="추가로 고려할 사항이 있나요?"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
            </div>
            <div style={styles.formActions}>
              <button style={styles.btnGhost} onClick={() => setShowForm(false)}>취소</button>
              <button style={styles.btnPrimary} onClick={addTask}>태스크 추가</button>
            </div>
          </section>
        )}

        {notice && <div style={styles.notice}>{notice}</div>}

        {proposedBlocks.length > 0 && (
          <section style={styles.previewCard}>
            <div style={styles.previewHeader}>
              <div>
                <div style={styles.previewTitle}>AI 스케줄 미리보기</div>
                <div style={styles.previewSub}>적용 전 확인 후 확정하세요.</div>
              </div>
              <div style={styles.previewCount}>{proposedBlocks.length}개</div>
            </div>
            <div style={styles.previewList}>
              {proposedBlocks.map((block) => (
                <div key={`${block.taskId}-${block.start_at}`} style={styles.previewItem}>
                  <div style={styles.previewItemTitle}>{block.title}</div>
                  <div style={styles.previewItemMeta}>
                    {formatDateTime(block.start_at)} → {formatDateTime(block.end_at)}
                  </div>
                </div>
              ))}
            </div>
            {unscheduled.length > 0 && (
              <div style={styles.previewWarning}>
                {unscheduled.length}개 태스크는 시간 부족으로 배치되지 않았어요.
              </div>
            )}
            <div style={styles.previewActions}>
              <button style={styles.btnGhost} onClick={clearPreview}>취소</button>
              <button style={styles.btnPrimary} onClick={applySchedule} disabled={applying}>
                {applying ? "적용 중" : "적용"}
              </button>
            </div>
          </section>
        )}

        <section style={styles.section}>
          <div style={styles.sectionTitle}>진행 중 ({pendingTasks.length})</div>
          <div style={styles.list}>
            {pendingTasks.map((task) => (
              <div key={task.id} style={styles.card}>
                <label style={styles.checkbox}>
                  <input
                    type="checkbox"
                    checked={task.status === "done"}
                    onChange={() => toggleDone(task.id)}
                  />
                  <span />
                </label>
                <div style={styles.cardBody}>
                  <div style={styles.cardTitle}>{task.title}</div>
                  {task.description && <div style={styles.cardSub}>{task.description}</div>}
                  <div style={styles.metaRow}>
                    <span style={styles.metaItem}>마감: {formatDeadline(task.deadline)}</span>
                    <span style={styles.metaItem}>{formatEstimatedLabel(task)}</span>
                    {task.priority_tag && (
                      <span style={styles.metaBadge}>
                        우선순위 {task.priority_tag === "high" ? "높음" : task.priority_tag === "low" ? "낮음" : "보통"}
                      </span>
                    )}
                    {task.preferred_time && (
                      <span style={styles.metaItem}>선호: {PREFERRED_LABELS[task.preferred_time] ?? task.preferred_time}</span>
                    )}
                    {task.focus_need && (
                      <span style={styles.metaItem}>집중도: {FOCUS_LABELS[task.focus_need] ?? task.focus_need}</span>
                    )}
                    {typeof task.splittable === "boolean" && (
                      <span style={styles.metaItem}>{task.splittable ? "분할 가능" : "분할 불가"}</span>
                    )}
                  </div>
                </div>
                <button style={styles.linkButton} onClick={() => resetTask(task)}>재설정</button>
              </div>
            ))}
            {pendingTasks.length === 0 && (
              <div style={styles.empty}>진행 중인 태스크가 없습니다.</div>
            )}
          </div>
        </section>

        <section style={styles.section}>
          <div style={styles.sectionTitle}>완료됨 ({doneTasks.length})</div>
          <div style={styles.list}>
            {doneTasks.map((task) => (
              <div key={task.id} style={styles.cardMuted}>
                <label style={styles.checkbox}>
                  <input
                    type="checkbox"
                    checked
                    onChange={() => toggleDone(task.id)}
                  />
                  <span />
                </label>
                <div style={styles.cardBody}>
                  <div style={styles.cardTitle}>{task.title}</div>
                  <div style={styles.metaRow}>
                    <span style={styles.metaItem}>마감: {formatDeadline(task.deadline)}</span>
                    <span style={styles.metaItem}>{formatEstimatedLabel(task)}</span>
                  </div>
                </div>
              </div>
            ))}
            {doneTasks.length === 0 && <div style={styles.empty}>완료된 태스크가 없습니다.</div>}
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
  headerActions: { display: "flex", gap: 10 },
  btnPrimary: {
    border: "none",
    padding: "10px 16px",
    borderRadius: 14,
    background: "linear-gradient(135deg, #6366f1, #3b82f6)",
    color: "white",
    fontWeight: 700,
    cursor: "pointer",
  },
  btnGhost: {
    border: "1px solid rgba(15,23,42,0.12)",
    background: "white",
    padding: "10px 16px",
    borderRadius: 14,
    fontWeight: 700,
    cursor: "pointer",
  },
  formCard: {
    background: "white",
    borderRadius: 18,
    border: "1px solid rgba(15,23,42,0.08)",
    padding: 20,
    display: "grid",
    gap: 18,
  },
  formRow: {
    display: "grid",
    gap: 14,
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    alignItems: "start",
  },
  field: { display: "grid", gap: 8 },
  label: { fontSize: 12, fontWeight: 600, color: "#475569" },
  input: {
    border: "1px solid rgba(15,23,42,0.12)",
    borderRadius: 12,
    padding: "10px 12px",
    fontSize: 13,
    background: "white",
  },
  select: {
    border: "1px solid rgba(15,23,42,0.12)",
    borderRadius: 12,
    padding: "10px 12px",
    fontSize: 13,
    background: "white",
  },
  presetRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
  },
  presetChip: {
    border: "1px solid rgba(15,23,42,0.12)",
    background: "rgba(15,23,42,0.02)",
    color: "#334155",
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 12,
    cursor: "pointer",
  },
  presetChipActive: {
    borderColor: "rgba(59,130,246,0.6)",
    background: "rgba(59,130,246,0.12)",
    color: "#1d4ed8",
  },
  segmentedRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(90px, 1fr))",
    gap: 6,
    padding: 4,
    borderRadius: 999,
    border: "1px solid rgba(15,23,42,0.08)",
    background: "rgba(15,23,42,0.04)",
  },
  segmentedButton: {
    border: "none",
    background: "transparent",
    padding: "8px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
    color: "#475569",
    cursor: "pointer",
    display: "grid",
    placeItems: "center",
    height: 32,
  },
  segmentedButtonActive: {
    background: "#0f172a",
    color: "white",
    boxShadow: "0 8px 18px rgba(15,23,42,0.18)",
  },
  toggleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(15,23,42,0.08)",
    background: "rgba(15,23,42,0.03)",
  },
  toggleTitle: { fontWeight: 600, fontSize: 12 },
  toggleSub: { fontSize: 11, color: "#64748b", marginTop: 2 },
  toggleSwitch: {
    width: 46,
    height: 26,
    borderRadius: 999,
    border: "none",
    background: "rgba(15,23,42,0.15)",
    position: "relative",
    cursor: "pointer",
    padding: 0,
  },
  toggleSwitchOn: {
    background: "#2563eb",
  },
  toggleHandle: {
    width: 22,
    height: 22,
    borderRadius: 999,
    background: "white",
    position: "absolute",
    top: 2,
    left: 2,
    transition: "transform 0.2s ease",
  },
  toggleHandleOn: {
    transform: "translateX(20px)",
  },
  formActions: { display: "flex", justifyContent: "flex-end", gap: 8 },
  notice: {
    background: "rgba(59,130,246,0.1)",
    border: "1px solid rgba(59,130,246,0.2)",
    padding: "10px 14px",
    borderRadius: 12,
    fontSize: 12,
  },
  previewCard: {
    background: "white",
    borderRadius: 18,
    border: "1px solid rgba(15,23,42,0.08)",
    padding: 16,
    display: "grid",
    gap: 12,
  },
  previewHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  previewTitle: { fontSize: 15, fontWeight: 700 },
  previewSub: { fontSize: 12, color: "#64748b" },
  previewCount: {
    background: "rgba(15,23,42,0.08)",
    borderRadius: 999,
    padding: "4px 10px",
    fontSize: 12,
    fontWeight: 700,
  },
  previewList: {
    display: "grid",
    gap: 10,
    maxHeight: 220,
    overflowY: "auto",
  },
  previewItem: {
    padding: "10px 12px",
    borderRadius: 12,
    background: "rgba(15,23,42,0.04)",
  },
  previewItemTitle: { fontSize: 13, fontWeight: 700 },
  previewItemMeta: { fontSize: 11, color: "#64748b", marginTop: 4 },
  previewWarning: {
    padding: "8px 10px",
    borderRadius: 10,
    background: "rgba(245,158,11,0.12)",
    color: "#b45309",
    fontSize: 12,
    fontWeight: 600,
  },
  previewActions: { display: "flex", justifyContent: "flex-end", gap: 8 },
  section: { display: "grid", gap: 12 },
  sectionTitle: { fontSize: 14, fontWeight: 700 },
  list: { display: "grid", gap: 12 },
  card: {
    background: "white",
    borderRadius: 16,
    border: "1px solid rgba(15,23,42,0.08)",
    padding: 14,
    display: "grid",
    gridTemplateColumns: "24px 1fr auto",
    gap: 12,
    alignItems: "center",
  },
  cardMuted: {
    background: "rgba(15,23,42,0.04)",
    borderRadius: 16,
    border: "1px solid rgba(15,23,42,0.08)",
    padding: 14,
    display: "grid",
    gridTemplateColumns: "24px 1fr",
    gap: 12,
    alignItems: "center",
  },
  cardBody: { display: "grid", gap: 6 },
  cardTitle: { fontSize: 14, fontWeight: 700 },
  cardSub: { fontSize: 12, opacity: 0.7 },
  metaRow: { display: "flex", gap: 8, flexWrap: "wrap" },
  metaItem: { fontSize: 11, color: "#64748b" },
  metaBadge: {
    fontSize: 11,
    color: "#1d4ed8",
    background: "rgba(59,130,246,0.12)",
    padding: "2px 8px",
    borderRadius: 999,
    fontWeight: 600,
  },
  checkbox: {
    display: "grid",
    placeItems: "center",
  },
  linkButton: {
    border: "none",
    background: "transparent",
    color: "#64748b",
    fontSize: 12,
    cursor: "pointer",
  },
  empty: {
    padding: "20px 0",
    fontSize: 12,
    color: "#94a3b8",
  },
};
