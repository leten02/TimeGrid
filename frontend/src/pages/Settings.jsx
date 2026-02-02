import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";

function Toggle({ value, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      aria-pressed={value}
      style={{ ...styles.toggle, ...(value ? styles.toggleOn : {}) }}
    >
      <span style={{ ...styles.toggleKnob, ...(value ? styles.toggleKnobOn : {}) }} />
    </button>
  );
}

export default function Settings() {
  const navigate = useNavigate();
  const [weekStart, setWeekStart] = useState("sunday");
  const [defaultBlock, setDefaultBlock] = useState("60");
  const [timezone, setTimezone] = useState("Asia/Seoul");
  const [autoScroll, setAutoScroll] = useState(true);
  const [blockRespect, setBlockRespect] = useState(true);
  const [notifyBefore, setNotifyBefore] = useState(true);
  const [dailySummary, setDailySummary] = useState(false);
  const [weeklyReport, setWeeklyReport] = useState(true);
  const [aiAssist, setAiAssist] = useState(true);
  const [aiPriority, setAiPriority] = useState(false);
  const [localSave, setLocalSave] = useState(true);

  const logout = async () => {
    await api("/auth/logout", { method: "POST" });
    window.location.href = "/";
  };

  return (
    <div style={styles.shell}>
      <div style={styles.shellBackdrop} aria-hidden="true" />

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
          <div style={styles.navItem} onClick={() => navigate("/week")}>타임테이블</div>
          <div style={styles.navItem}>인벤토리</div>
          <div style={styles.navItem}>리포트</div>
          <div style={{ ...styles.navItem, ...styles.navItemActive }}>설정</div>
        </nav>
      </aside>

      <main style={styles.main}>
        <div style={styles.header}>
          <div>
            <div style={styles.hTitle}>설정</div>
            <div style={styles.hSub}>TimeGrid 환경과 기본 동작을 설정합니다.</div>
          </div>
        </div>

        <div style={styles.settingsGrid}>
          <section style={styles.card}>
            <div style={styles.cardTitle}>프로필</div>
            <div style={styles.fieldRow}>
              <div style={styles.field}>
                <label style={styles.label}>이름</label>
                <input style={styles.input} placeholder="이름" />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>이메일</label>
                <input style={styles.input} placeholder="email@example.com" />
              </div>
            </div>
            <div style={styles.field}>
              <label style={styles.label}>시간대</label>
              <select value={timezone} onChange={(e) => setTimezone(e.target.value)} style={styles.select}>
                <option value="Asia/Seoul">Asia/Seoul (KST)</option>
                <option value="Asia/Tokyo">Asia/Tokyo (JST)</option>
                <option value="America/Los_Angeles">America/Los_Angeles (PST)</option>
              </select>
            </div>
          </section>

          <section style={styles.card}>
            <div style={styles.cardTitle}>일정 기본값</div>
            <div style={styles.fieldRow}>
              <div style={styles.field}>
                <label style={styles.label}>주 시작 요일</label>
                <select value={weekStart} onChange={(e) => setWeekStart(e.target.value)} style={styles.select}>
                  <option value="sunday">일요일</option>
                  <option value="monday">월요일</option>
                </select>
              </div>
              <div style={styles.field}>
                <label style={styles.label}>기본 일정 길이</label>
                <select value={defaultBlock} onChange={(e) => setDefaultBlock(e.target.value)} style={styles.select}>
                  <option value="30">30분</option>
                  <option value="60">60분</option>
                  <option value="90">90분</option>
                </select>
              </div>
            </div>
            <div style={styles.toggleRow}>
              <span style={styles.toggleLabel}>오늘 버튼 자동 스크롤</span>
              <Toggle value={autoScroll} onChange={setAutoScroll} />
            </div>
            <div style={styles.toggleRow}>
              <span style={styles.toggleLabel}>차단된 시간 우선 적용</span>
              <Toggle value={blockRespect} onChange={setBlockRespect} />
            </div>
          </section>

          <section style={styles.card}>
            <div style={styles.cardTitle}>알림</div>
            <div style={styles.toggleRow}>
              <span style={styles.toggleLabel}>일정 시작 10분 전 알림</span>
              <Toggle value={notifyBefore} onChange={setNotifyBefore} />
            </div>
            <div style={styles.toggleRow}>
              <span style={styles.toggleLabel}>하루 요약 알림</span>
              <Toggle value={dailySummary} onChange={setDailySummary} />
            </div>
            <div style={styles.toggleRow}>
              <span style={styles.toggleLabel}>주간 리포트 알림</span>
              <Toggle value={weeklyReport} onChange={setWeeklyReport} />
            </div>
          </section>

          <section style={styles.card}>
            <div style={styles.cardTitle}>AI 스케줄 도우미</div>
            <div style={styles.toggleRow}>
              <span style={styles.toggleLabel}>AI 자동 제안 사용</span>
              <Toggle value={aiAssist} onChange={setAiAssist} />
            </div>
            <div style={styles.toggleRow}>
              <span style={styles.toggleLabel}>우선순위 기반 추천</span>
              <Toggle value={aiPriority} onChange={setAiPriority} />
            </div>
          </section>

          <section style={styles.card}>
            <div style={styles.cardTitle}>데이터</div>
            <div style={styles.toggleRow}>
              <span style={styles.toggleLabel}>로컬 저장 사용</span>
              <Toggle value={localSave} onChange={setLocalSave} />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>캘린더 연동</label>
              <button type="button" style={styles.ghostButton}>Google Calendar 연동 준비중</button>
            </div>
          </section>
        </div>

        <div style={styles.logoutWrap}>
          <button style={styles.logoutButton} onClick={logout}>로그아웃</button>
        </div>
      </main>
    </div>
  );
}

const cardBase = {
  background: "rgba(255,255,255,0.9)",
  border: "1px solid rgba(15,23,42,0.08)",
  borderRadius: 18,
  padding: 16,
  boxShadow: "0 12px 24px rgba(15,23,42,0.08)",
};

const inputBase = {
  width: "100%",
  border: "1px solid rgba(15,23,42,0.12)",
  background: "rgba(255,255,255,0.9)",
  borderRadius: 12,
  padding: "10px 12px",
  fontSize: 13,
  color: "#0f172a",
  minWidth: 0,
};

const styles = {
  shell: {
    minHeight: "100vh",
    height: "100vh",
    display: "grid",
    gridTemplateColumns: "220px 1fr",
    background: "linear-gradient(180deg, #f6f7fb 0%, #eef1f7 60%, #e8ecf5 100%)",
    position: "relative",
    overflow: "hidden",
    color: "#0f172a",
    fontFamily: "'Pretendard','SF Pro Display','Apple SD Gothic Neo','Noto Sans KR',sans-serif",
  },
  shellBackdrop: {
    position: "absolute",
    inset: 0,
    background: "radial-gradient(circle at 12% 5%, rgba(59,130,246,0.12), transparent 45%), radial-gradient(circle at 80% 10%, rgba(255,59,48,0.12), transparent 45%)",
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
    padding: 22,
    overflow: "auto",
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  hTitle: { fontSize: 24, fontWeight: 900, letterSpacing: "-0.4px" },
  hSub: { fontSize: 12, opacity: 0.7 },
  settingsGrid: {
    display: "grid",
    gap: 16,
  },
  card: cardBase,
  cardTitle: { fontSize: 15, fontWeight: 700, marginBottom: 12 },
  fieldRow: {
    display: "grid",
    gap: 12,
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  },
  field: {
    display: "grid",
    gap: 8,
    minWidth: 0,
  },
  label: { fontSize: 13, fontWeight: 600 },
  input: inputBase,
  select: {
    ...inputBase,
    appearance: "none",
    backgroundImage: "linear-gradient(45deg, transparent 50%, #64748b 50%), linear-gradient(135deg, #64748b 50%, transparent 50%)",
    backgroundPosition: "calc(100% - 16px) 55%, calc(100% - 10px) 55%",
    backgroundSize: "6px 6px, 6px 6px",
    backgroundRepeat: "no-repeat",
  },
  toggleRow: {
    marginTop: 10,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  toggleLabel: { fontSize: 13, fontWeight: 600 },
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
  ghostButton: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px dashed rgba(15,23,42,0.2)",
    background: "rgba(15,23,42,0.04)",
    color: "#475569",
    fontSize: 12,
    cursor: "pointer",
    textAlign: "left",
  },
  logoutWrap: {
    marginTop: "auto",
    paddingTop: 6,
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
