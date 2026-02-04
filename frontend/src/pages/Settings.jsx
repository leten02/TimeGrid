import Sidebar from "../components/Sidebar";
import { api } from "../lib/api";
import { useSettings } from "../lib/useSettings";

const Toggle = ({ value, onChange }) => (
  <button
    type="button"
    onClick={() => onChange(!value)}
    aria-pressed={value}
    style={{ ...styles.toggle, ...(value ? styles.toggleOn : {}) }}
  >
    <span style={{ ...styles.toggleKnob, ...(value ? styles.toggleKnobOn : {}) }} />
  </button>
);

export default function Settings() {
  const { settings, loading, error, updateSettings } = useSettings();

  const applySetting = (patch) => {
    updateSettings(patch).catch(() => {});
  };

  const logout = async () => {
    await api("/auth/logout", { method: "POST" });
    window.location.href = "/";
  };

  return (
    <div style={styles.shell}>
      <Sidebar />
      <main style={styles.main}>
        <div style={styles.header}>
          <div>
            <div style={styles.hTitle}>설정</div>
            <div style={styles.hSub}>앱 환경과 AI 스케줄링 기본값을 설정합니다.</div>
          </div>
        </div>
        {error && <div style={styles.error}>{error}</div>}

        <section style={styles.card}>
          <div style={styles.cardTitle}>Profile</div>
          <div style={styles.profileRow}>
            <div style={styles.avatar}>TG</div>
            <div>
              <div style={styles.profileName}>TimeGrid User</div>
              <div style={styles.profileEmail}>user@timegrid.app</div>
            </div>
          </div>
        </section>

        <section style={styles.card}>
          <div style={styles.cardTitle}>Timetable Appearance</div>
          <div style={styles.fieldRow}>
            <div style={styles.field}>
              <label style={styles.label}>Week Start Day</label>
              <select
                style={styles.select}
                value={settings.week_start_day}
                onChange={(e) => applySetting({ week_start_day: e.target.value })}
                disabled={loading}
              >
                <option value="sunday">Sunday</option>
                <option value="monday">Monday</option>
              </select>
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Compact Mode</label>
              <Toggle value={settings.compact_mode} onChange={(value) => applySetting({ compact_mode: value })} />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Grid Start Hour</label>
              <input
                type="time"
                style={styles.input}
                value={settings.grid_start}
                onChange={(e) => applySetting({ grid_start: e.target.value })}
                disabled={loading}
              />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Grid End Hour</label>
              <input
                type="time"
                style={styles.input}
                value={settings.grid_end}
                onChange={(e) => applySetting({ grid_end: e.target.value })}
                disabled={loading}
              />
            </div>
          </div>
        </section>

        <section style={styles.card}>
          <div style={styles.cardTitle}>AI Scheduling Preferences</div>
          <div style={styles.fieldRow}>
            <div style={styles.field}>
              <label style={styles.label}>Scheduling Density</label>
              <input
                type="range"
                min="0"
                max="100"
                value={settings.scheduling_density}
                onChange={(e) => applySetting({ scheduling_density: Number(e.target.value) })}
                style={styles.range}
              />
              <div style={styles.rangeLabels}>
                <span>Flexible</span>
                <strong>{settings.scheduling_density}</strong>
                <span>High</span>
              </div>
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Preferred Work Time</label>
              <select
                style={styles.select}
                value={settings.preferred_time}
                onChange={(e) => applySetting({ preferred_time: e.target.value })}
                disabled={loading}
              >
                <option value="morning">Morning (9-12)</option>
                <option value="afternoon">Afternoon (1-5)</option>
                <option value="evening">Evening (6-9)</option>
                <option value="any">Any Time</option>
              </select>
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Auto-Schedule Tasks</label>
              <Toggle value={settings.auto_schedule} onChange={(value) => applySetting({ auto_schedule: value })} />
            </div>
          </div>
        </section>

        <section style={styles.card}>
          <div style={styles.cardTitle}>Focus Timer</div>
          <div style={styles.fieldRow}>
            <div style={styles.field}>
              <label style={styles.label}>Focus Duration</label>
              <select
                style={styles.select}
                value={String(settings.focus_duration)}
                onChange={(e) => applySetting({ focus_duration: Number(e.target.value) })}
                disabled={loading}
              >
                <option value="15">15 min</option>
                <option value="25">25 min</option>
                <option value="30">30 min</option>
                <option value="45">45 min</option>
                <option value="60">60 min</option>
              </select>
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Break Duration</label>
              <select
                style={styles.select}
                value={String(settings.break_duration)}
                onChange={(e) => applySetting({ break_duration: Number(e.target.value) })}
                disabled={loading}
              >
                <option value="5">5 min</option>
                <option value="10">10 min</option>
                <option value="15">15 min</option>
              </select>
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Timer Sound</label>
              <Toggle value={settings.timer_sound} onChange={(value) => applySetting({ timer_sound: value })} />
            </div>
          </div>
        </section>

        <section style={styles.card}>
          <div style={styles.cardTitle}>Notifications</div>
          <div style={styles.fieldRow}>
            <div style={styles.field}>
              <label style={styles.label}>Task Reminders</label>
              <Toggle value={settings.task_reminders} onChange={(value) => applySetting({ task_reminders: value })} />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Daily Report</label>
              <Toggle value={settings.daily_report} onChange={(value) => applySetting({ daily_report: value })} />
            </div>
            {settings.task_reminders && (
              <div style={styles.subField}>
                <label style={styles.label}>Notify Before</label>
                <select
                  style={styles.select}
                  value={String(settings.notify_before)}
                  onChange={(e) => applySetting({ notify_before: Number(e.target.value) })}
                  disabled={loading}
                >
                  <option value="5">5 min</option>
                  <option value="10">10 min</option>
                  <option value="15">15 min</option>
                  <option value="30">30 min</option>
                </select>
              </div>
            )}
          </div>
        </section>

        <section style={styles.card}>
          <div style={styles.cardTitle}>Appearance</div>
          <div style={styles.fieldRow}>
            <div style={styles.field}>
              <label style={styles.label}>Theme</label>
              <select
                style={styles.select}
                value={settings.theme}
                onChange={(e) => applySetting({ theme: e.target.value })}
                disabled={loading}
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
                <option value="auto">Auto</option>
              </select>
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Language</label>
              <select
                style={styles.select}
                value={settings.language}
                onChange={(e) => applySetting({ language: e.target.value })}
                disabled={loading}
              >
                <option value="ko">한국어</option>
                <option value="en">English</option>
                <option value="jp">日本語</option>
              </select>
            </div>
          </div>
        </section>

        <section style={styles.cardDanger}>
          <div style={styles.cardTitle}>Danger Zone</div>
          <button style={styles.deleteButton}>Delete All Data</button>
        </section>

        <div style={styles.logoutWrap}>
          <button style={styles.logoutButton} onClick={logout}>로그아웃</button>
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
    overflow: "auto",
    display: "grid",
    gap: 18,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  hTitle: { fontSize: 22, fontWeight: 800 },
  hSub: { fontSize: 12, opacity: 0.6 },
  error: {
    padding: "10px 12px",
    borderRadius: 12,
    background: "rgba(239,68,68,0.12)",
    color: "#b91c1c",
    fontSize: 12,
    fontWeight: 600,
  },
  card: {
    background: "white",
    borderRadius: 18,
    border: "1px solid rgba(15,23,42,0.08)",
    padding: 18,
    display: "grid",
    gap: 14,
  },
  cardDanger: {
    background: "rgba(239,68,68,0.08)",
    borderRadius: 18,
    border: "1px solid rgba(239,68,68,0.2)",
    padding: 18,
    display: "grid",
    gap: 12,
  },
  cardTitle: { fontSize: 15, fontWeight: 700 },
  profileRow: { display: "flex", gap: 14, alignItems: "center" },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 16,
    background: "linear-gradient(135deg, #6366f1, #3b82f6)",
    color: "white",
    display: "grid",
    placeItems: "center",
    fontWeight: 700,
  },
  profileName: { fontWeight: 700 },
  profileEmail: { fontSize: 12, color: "#94a3b8" },
  fieldRow: {
    display: "grid",
    gap: 14,
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  },
  field: { display: "grid", gap: 8 },
  subField: {
    display: "grid",
    gap: 8,
    borderLeft: "3px solid rgba(59,130,246,0.4)",
    paddingLeft: 12,
  },
  label: { fontSize: 12, fontWeight: 600, color: "#475569" },
  input: {
    border: "1px solid rgba(15,23,42,0.12)",
    borderRadius: 12,
    padding: "10px 12px",
    fontSize: 13,
  },
  select: {
    border: "1px solid rgba(15,23,42,0.12)",
    borderRadius: 12,
    padding: "10px 12px",
    fontSize: 13,
    background: "white",
  },
  range: {
    width: "100%",
  },
  rangeLabels: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 11,
    color: "#94a3b8",
  },
  toggle: {
    width: 44,
    height: 26,
    borderRadius: 999,
    border: "1px solid rgba(15,23,42,0.2)",
    background: "rgba(15,23,42,0.12)",
    padding: 3,
    display: "flex",
    alignItems: "center",
    cursor: "pointer",
  },
  toggleOn: {
    background: "linear-gradient(135deg, #2563eb, #1d4ed8)",
    borderColor: "rgba(37,99,235,0.6)",
  },
  toggleKnob: {
    width: 18,
    height: 18,
    borderRadius: 999,
    background: "white",
    transform: "translateX(0)",
    transition: "transform 0.15s ease",
  },
  toggleKnobOn: {
    transform: "translateX(18px)",
  },
  deleteButton: {
    border: "none",
    padding: "12px 16px",
    borderRadius: 12,
    background: "rgba(239,68,68,0.2)",
    color: "#b91c1c",
    fontWeight: 700,
    cursor: "pointer",
  },
  logoutWrap: {
    marginTop: 6,
  },
  logoutButton: {
    width: "100%",
    padding: "14px 16px",
    borderRadius: 16,
    border: "1px solid rgba(255,59,48,0.6)",
    background: "linear-gradient(135deg, #ff453a, #ff3b30)",
    color: "white",
    fontSize: 15,
    fontWeight: 800,
    cursor: "pointer",
    boxShadow: "0 12px 20px rgba(255,59,48,0.25)",
  },
};
