import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

const DEFAULT_SETTINGS = {
  week_start_day: "sunday",
  compact_mode: false,
  grid_start: "00:00",
  grid_end: "23:59",
  scheduling_density: 60,
  preferred_time: "any",
  auto_schedule: true,
  focus_duration: 45,
  break_duration: 15,
  timer_sound: true,
  task_reminders: true,
  daily_report: false,
  notify_before: 10,
  theme: "light",
  language: "ko",
};

export function useSettings() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    try {
      const data = await api("/settings");
      setSettings({ ...DEFAULT_SETTINGS, ...data });
    } catch (err) {
      setError("설정을 불러오지 못했어요.");
    } finally {
      setLoading(false);
    }
  }, []);

  const updateSettings = useCallback(async (patch) => {
    setSettings((prev) => ({ ...prev, ...patch }));
    try {
      const data = await api("/settings", {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setSettings({ ...DEFAULT_SETTINGS, ...data });
      return data;
    } catch (err) {
      setError("설정 저장에 실패했어요.");
      throw err;
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { settings, loading, error, refresh, updateSettings };
}
