const DEFAULT_START_HOUR = 6;
const DEFAULT_END_HOUR = 24;
const SLOT_MINUTES = 15;
const DEFAULT_CHUNK_MINUTES = 60;
const FOCUS_CHUNK_MAP = {
  high: 90,
  medium: 60,
  low: 30,
};
const PREFERRED_WINDOWS = {
  morning: [9, 12],
  afternoon: [13, 17],
  evening: [18, 21],
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const toMidnight = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const dayIndexFromDate = (date, weekStart) => {
  const msPerDay = 24 * 60 * 60 * 1000;
  const start = toMidnight(weekStart).getTime();
  const target = toMidnight(date).getTime();
  return Math.floor((target - start) / msPerDay);
};

const minutesFromStart = (date) => date.getHours() * 60 + date.getMinutes();

const normalizeDeadlineScore = (deadline, horizonDays = 14) => {
  const now = new Date();
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysLeft = Math.max(0, Math.ceil((deadline - now) / msPerDay));
  return clamp(1 - daysLeft / horizonDays, 0, 1);
};

const normalizeImportance = (importance) => clamp((importance - 1) / 4, 0, 1);

const sortTasks = (tasks) =>
  [...tasks].sort((a, b) => {
    const scoreA = 1.3 * normalizeDeadlineScore(new Date(a.deadline)) + normalizeImportance(a.importance);
    const scoreB = 1.3 * normalizeDeadlineScore(new Date(b.deadline)) + normalizeImportance(b.importance);
    if (scoreA !== scoreB) return scoreB - scoreA;
    const deadlineDiff = new Date(a.deadline) - new Date(b.deadline);
    if (deadlineDiff !== 0) return deadlineDiff;
    const minutesA = a.estimated_minutes ?? a.estimatedMinutes ?? 0;
    const minutesB = b.estimated_minutes ?? b.estimatedMinutes ?? 0;
    return minutesB - minutesA;
  });

const chunkTask = (minutes, chunkMinutes = DEFAULT_CHUNK_MINUTES) => {
  const totalSlots = Math.ceil(minutes / SLOT_MINUTES);
  const chunkSlots = Math.max(1, Math.round(chunkMinutes / SLOT_MINUTES));
  const chunks = [];
  let remaining = totalSlots;
  while (remaining > 0) {
    const size = remaining >= chunkSlots ? chunkSlots : remaining;
    chunks.push(size);
    remaining -= size;
  }
  return chunks;
};

const buildSlotMap = ({ weekStart, startHour, endHour }) => {
  const slotsPerDay = Math.max(1, ((endHour - startHour) * 60) / SLOT_MINUTES);
  const occupied = Array.from({ length: 7 }, () => Array(slotsPerDay).fill(false));
  return { occupied, slotsPerDay };
};

const markRange = ({ occupied, slotsPerDay, startHour }, dayIndex, startMin, endMin) => {
  if (dayIndex < 0 || dayIndex >= 7) return;
  const startSlot = clamp(Math.floor((startMin - startHour * 60) / SLOT_MINUTES), 0, slotsPerDay);
  const endSlot = clamp(Math.ceil((endMin - startHour * 60) / SLOT_MINUTES), 0, slotsPerDay);
  for (let i = startSlot; i < endSlot; i += 1) {
    occupied[dayIndex][i] = true;
  }
};

const windowToSlots = (window, startHour, endHour, slotsPerDay) => {
  const [start, end] = window;
  const startSlot = clamp(Math.floor(((start - startHour) * 60) / SLOT_MINUTES), 0, slotsPerDay);
  const endSlot = clamp(Math.ceil(((end - startHour) * 60) / SLOT_MINUTES), 0, slotsPerDay);
  return { startSlot, endSlot: Math.max(startSlot, Math.min(slotsPerDay, endSlot)) };
};

const findSlot = ({ occupied, slotsPerDay }, preferredDays, chunkSlots, preferredTime, startHour, endHour) => {
  const searchWithin = (windows) => {
    for (const dayIndex of preferredDays) {
      const day = occupied[dayIndex];
      for (const window of windows) {
        const { startSlot, endSlot } = windowToSlots(window, startHour, endHour, slotsPerDay);
        for (let i = startSlot; i <= endSlot - chunkSlots; i += 1) {
          let ok = true;
          for (let j = 0; j < chunkSlots; j += 1) {
            if (day[i + j]) {
              ok = false;
              break;
            }
          }
          if (ok) return { dayIndex, startSlot: i };
        }
      }
    }
    return null;
  };

  const preferredWindow = preferredTime && PREFERRED_WINDOWS[preferredTime]
    ? [PREFERRED_WINDOWS[preferredTime]]
    : [];
  const fullDayWindow = [[startHour, endHour]];

  return (
    (preferredWindow.length > 0 ? searchWithin(preferredWindow) : null) ||
    searchWithin(fullDayWindow)
  );
};

export function aiSchedulerV2({
  tasks,
  existingBlocks = [],
  fixedSchedules = [],
  blockedTemplates = [],
  blockedRanges = [],
  weekStart,
  weekEnd,
  startHour = DEFAULT_START_HOUR,
  endHour = DEFAULT_END_HOUR,
}) {
  const { occupied, slotsPerDay } = buildSlotMap({ weekStart, startHour, endHour });

  // mark existing blocks
  existingBlocks.forEach((block) => {
    const start = new Date(block.start_at);
    const end = new Date(block.end_at);
    const dayIndex = dayIndexFromDate(start, weekStart);
    markRange({ occupied, slotsPerDay, startHour }, dayIndex, minutesFromStart(start), minutesFromStart(end));
  });

  // mark fixed schedules
  fixedSchedules.forEach((item) => {
    item.days.forEach((dayIndex) => {
      const [sh, sm] = item.start.split(":").map(Number);
      const [eh, em] = item.end.split(":").map(Number);
      markRange({ occupied, slotsPerDay, startHour }, dayIndex, sh * 60 + sm, eh * 60 + em);
    });
  });

  // mark blocked templates
  blockedTemplates.forEach((item) => {
    item.days.forEach((dayIndex) => {
      const [sh, sm] = item.start.split(":").map(Number);
      const [eh, em] = item.end.split(":").map(Number);
      markRange({ occupied, slotsPerDay, startHour }, dayIndex, sh * 60 + sm, eh * 60 + em);
    });
  });

  // mark manual blocked ranges
  blockedRanges.forEach((item) => {
    const dayIndex = dayIndexFromDate(item.date, weekStart);
    markRange({ occupied, slotsPerDay, startHour }, dayIndex, item.startMin, item.endMin);
  });

  const orderedTasks = sortTasks(tasks);
  const proposed = [];
  const unscheduled = [];

  orderedTasks.forEach((task) => {
    const deadline = new Date(task.deadline);
    const deadlineIndex = clamp(dayIndexFromDate(deadline, weekStart), 0, 6);
    const preferredDays = [
      ...Array.from({ length: deadlineIndex + 1 }, (_, i) => i),
      ...Array.from({ length: 7 - (deadlineIndex + 1) }, (_, i) => deadlineIndex + 1 + i),
    ];

    const taskMinutes = task.estimated_minutes ?? task.estimatedMinutes ?? 0;
    const focusNeed = task.focus_need ?? task.focusNeed ?? "medium";
    const chunkMinutes = FOCUS_CHUNK_MAP[focusNeed] ?? DEFAULT_CHUNK_MINUTES;
    const isSplittable = task.splittable !== false;
    const chunks = isSplittable ? chunkTask(taskMinutes, chunkMinutes) : [Math.ceil(taskMinutes / SLOT_MINUTES)];
    let remaining = chunks.length;

    chunks.forEach((chunkSlots) => {
      let slotsNeeded = chunkSlots;
      const preferredTime = task.preferred_time ?? task.preferredTime ?? "any";
      let placement = findSlot({ occupied, slotsPerDay }, preferredDays, slotsNeeded, preferredTime, startHour, endHour);
      if (!placement && slotsNeeded > 1) {
        placement = findSlot({ occupied, slotsPerDay }, preferredDays, 1, preferredTime, startHour, endHour);
        if (placement) slotsNeeded = 1;
      }
      if (!placement) return;

      const { dayIndex, startSlot } = placement;
      const startMin = startHour * 60 + startSlot * SLOT_MINUTES;
      const endMin = startMin + slotsNeeded * SLOT_MINUTES;
      for (let i = startSlot; i < startSlot + slotsNeeded; i += 1) {
        occupied[dayIndex][i] = true;
      }

      const dayDate = new Date(weekStart);
      dayDate.setDate(dayDate.getDate() + dayIndex);
      const startAt = new Date(dayDate);
      startAt.setHours(0, 0, 0, 0);
      startAt.setMinutes(startAt.getMinutes() + startMin);
      const endAt = new Date(dayDate);
      endAt.setHours(0, 0, 0, 0);
      endAt.setMinutes(endAt.getMinutes() + endMin);

      proposed.push({
        taskId: task.id,
        title: task.title,
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
      });
      remaining -= 1;
    });

    if (remaining > 0) {
      unscheduled.push({
        taskId: task.id,
        remainingChunks: remaining,
        reason: "no_free_slot",
      });
    }
  });

  return { proposed, unscheduled, weekStart, weekEnd };
}
