import { useEffect, useMemo, useState, useCallback } from "react";
import Sidebar from "../components/Sidebar";
import { api } from "../lib/api";

const daysLabel = ["일", "월", "화", "수", "목", "금", "토"];

export default function Setup() {
  const [fixedSchedules, setFixedSchedules] = useState([]);
  const [blockedTemplates, setBlockedTemplates] = useState([]);
  const [showFixedForm, setShowFixedForm] = useState(false);
  const [showBlockedForm, setShowBlockedForm] = useState(false);
  const [notice, setNotice] = useState("");

  const [fixedForm, setFixedForm] = useState({
    title: "",
    days: [1, 3, 5],
    start: "09:00",
    end: "12:00",
    category: "수업",
  });

  const [blockedForm, setBlockedForm] = useState({
    title: "",
    days: [0, 1, 2, 3, 4, 5, 6],
    start: "00:00",
    end: "07:00",
    type: "수면",
  });

  const loadData = useCallback(async () => {
    setNotice("");
    try {
      const results = await Promise.allSettled([
        api("/fixed-schedules"),
        api("/blocked-templates"),
      ]);
      const [fixedResult, blockedResult] = results;
      if (fixedResult.status === "fulfilled") {
        setFixedSchedules(fixedResult.value);
      } else {
        setFixedSchedules([]);
        setNotice("고정 일정을 불러오지 못했어요.");
      }
      if (blockedResult.status === "fulfilled") {
        setBlockedTemplates(blockedResult.value);
      } else {
        setBlockedTemplates([]);
        setNotice((prev) => prev || "차단 시간을 불러오지 못했어요.");
      }
    } catch {
      setNotice("설정 데이터를 불러오지 못했어요.");
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const toggleDay = (current, day) =>
    current.includes(day) ? current.filter((d) => d !== day) : [...current, day];

  const addFixed = async () => {
    if (!fixedForm.title.trim()) return;
    try {
      await api("/fixed-schedules", {
        method: "POST",
        body: JSON.stringify({
          title: fixedForm.title.trim(),
          days: fixedForm.days,
          start: fixedForm.start,
          end: fixedForm.end,
          category: fixedForm.category,
        }),
      });
      await loadData();
      setShowFixedForm(false);
      setFixedForm({ ...fixedForm, title: "" });
    } catch {
      setNotice("고정 일정을 저장하지 못했어요.");
    }
  };

  const addBlocked = async () => {
    if (!blockedForm.title.trim()) return;
    try {
      await api("/blocked-templates", {
        method: "POST",
        body: JSON.stringify({
          title: blockedForm.title.trim(),
          days: blockedForm.days,
          start: blockedForm.start,
          end: blockedForm.end,
          type: blockedForm.type,
        }),
      });
      await loadData();
      setShowBlockedForm(false);
      setBlockedForm({ ...blockedForm, title: "" });
    } catch {
      setNotice("차단 시간을 저장하지 못했어요.");
    }
  };

  const removeFixed = async (id) => {
    try {
      await api(`/fixed-schedules/${id}`, { method: "DELETE" });
      await loadData();
    } catch {
      setNotice("고정 일정을 삭제하지 못했어요.");
    }
  };

  const removeBlocked = async (id) => {
    try {
      await api(`/blocked-templates/${id}`, { method: "DELETE" });
      await loadData();
    } catch {
      setNotice("차단 시간을 삭제하지 못했어요.");
    }
  };

  const stats = useMemo(() => {
    const baseMinutes = 12 * 60 * 7;
    const calcMinutes = (items) =>
      items.reduce((sum, item) => {
        const [sh, sm] = item.start.split(":").map(Number);
        const [eh, em] = item.end.split(":").map(Number);
        const duration = Math.max(0, eh * 60 + em - (sh * 60 + sm));
        return sum + duration * item.days.length;
      }, 0);
    const fixedMinutes = calcMinutes(fixedSchedules);
    const blockedMinutes = calcMinutes(blockedTemplates);
    const availableMinutes = Math.max(0, baseMinutes - fixedMinutes - blockedMinutes);
    return {
      fixed: fixedSchedules.length,
      blocked: blockedTemplates.length,
      available: Math.round((availableMinutes / 60) * 10) / 10,
    };
  }, [fixedSchedules, blockedTemplates]);

  return (
    <div style={styles.shell} className="tg-shell">
      <Sidebar />
      <main style={styles.main} className="tg-main">
        <div style={styles.header} className="tg-header">
          <div>
            <div style={styles.hTitle}>스케줄 설정</div>
            <div style={styles.hSub}>고정 일정과 차단 시간을 먼저 설정해 주세요.</div>
          </div>
        </div>
        {notice && <div style={styles.notice}>{notice}</div>}

        <div style={styles.infoBanner}>
          💡 고정 일정과 차단 시간은 AI 스케줄러가 항상 제외합니다.
        </div>

        <section style={styles.card}>
          <div style={styles.cardHeader}>
            <div>
              <div style={styles.cardTitle}>고정 일정</div>
              <div style={styles.cardSub}>매주 반복되는 수업, 알바 등을 등록하세요.</div>
            </div>
            <button style={styles.btnGhost} onClick={() => setShowFixedForm((v) => !v)}>+ 추가</button>
          </div>
          {showFixedForm && (
            <div style={styles.form}>
              <input
                style={styles.input}
                placeholder="일정 제목"
                value={fixedForm.title}
                onChange={(e) => setFixedForm({ ...fixedForm, title: e.target.value })}
              />
              <div style={styles.dayRow}>
                {daysLabel.map((label, idx) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setFixedForm({ ...fixedForm, days: toggleDay(fixedForm.days, idx) })}
                    style={{
                      ...styles.dayChip,
                      ...(fixedForm.days.includes(idx) ? styles.dayChipActive : {}),
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div style={styles.timeRow}>
                <input
                  type="time"
                  style={styles.input}
                  value={fixedForm.start}
                  onChange={(e) => setFixedForm({ ...fixedForm, start: e.target.value })}
                />
                <input
                  type="time"
                  style={styles.input}
                  value={fixedForm.end}
                  onChange={(e) => setFixedForm({ ...fixedForm, end: e.target.value })}
                />
                <select
                  style={styles.select}
                  value={fixedForm.category}
                  onChange={(e) => setFixedForm({ ...fixedForm, category: e.target.value })}
                >
                  <option value="수업">수업</option>
                  <option value="알바">알바</option>
                  <option value="동아리">동아리</option>
                  <option value="기타">기타</option>
                </select>
              </div>
              <div style={styles.formActions}>
                <button style={styles.btnGhost} onClick={() => setShowFixedForm(false)}>취소</button>
                <button style={styles.btnPrimary} onClick={addFixed}>저장</button>
              </div>
            </div>
          )}
          {fixedSchedules.length === 0 && (
            <div style={styles.empty}>고정 일정이 없습니다. AI가 자유롭게 배치할 수 있어요.</div>
          )}
          <div style={styles.itemList}>
            {fixedSchedules.map((item) => (
              <div key={item.id} style={styles.item}>
                <div>
                  <div style={styles.itemTitle}>{item.title}</div>
                  <div style={styles.itemSub}>
                    {item.days.map((d) => daysLabel[d]).join(", ")} · {item.start} - {item.end}
                  </div>
                </div>
                <button style={styles.linkButton} onClick={() => removeFixed(item.id)}>삭제</button>
              </div>
            ))}
          </div>
        </section>

        <section style={styles.card}>
          <div style={styles.cardHeader}>
            <div>
              <div style={styles.cardTitle}>차단 시간</div>
              <div style={styles.cardSub}>수면, 이동 등 학습이 불가능한 시간을 설정하세요.</div>
            </div>
            <button style={styles.btnGhost} onClick={() => setShowBlockedForm((v) => !v)}>+ 추가</button>
          </div>
          {showBlockedForm && (
            <div style={styles.form}>
              <input
                style={styles.input}
                placeholder="템플릿 이름"
                value={blockedForm.title}
                onChange={(e) => setBlockedForm({ ...blockedForm, title: e.target.value })}
              />
              <div style={styles.dayRow}>
                {daysLabel.map((label, idx) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setBlockedForm({ ...blockedForm, days: toggleDay(blockedForm.days, idx) })}
                    style={{
                      ...styles.dayChip,
                      ...(blockedForm.days.includes(idx) ? styles.dayChipBlocked : {}),
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div style={styles.timeRow}>
                <input
                  type="time"
                  style={styles.input}
                  value={blockedForm.start}
                  onChange={(e) => setBlockedForm({ ...blockedForm, start: e.target.value })}
                />
                <input
                  type="time"
                  style={styles.input}
                  value={blockedForm.end}
                  onChange={(e) => setBlockedForm({ ...blockedForm, end: e.target.value })}
                />
                <select
                  style={styles.select}
                  value={blockedForm.type}
                  onChange={(e) => setBlockedForm({ ...blockedForm, type: e.target.value })}
                >
                  <option value="수면">수면</option>
                  <option value="식사">식사</option>
                  <option value="이동">이동</option>
                  <option value="개인">개인</option>
                </select>
              </div>
              <div style={styles.formActions}>
                <button style={styles.btnGhost} onClick={() => setShowBlockedForm(false)}>취소</button>
                <button style={styles.btnPrimary} onClick={addBlocked}>저장</button>
              </div>
            </div>
          )}
          {blockedTemplates.length === 0 && (
            <div style={styles.empty}>차단 시간이 없습니다. 24시간 모두 사용 가능해요.</div>
          )}
          <div style={styles.itemList}>
            {blockedTemplates.map((item) => (
              <div key={item.id} style={styles.item}>
                <div>
                  <div style={styles.itemTitle}>{item.title}</div>
                  <div style={styles.itemSub}>
                    {item.days.map((d) => daysLabel[d]).join(", ")} · {item.start} - {item.end}
                  </div>
                </div>
                <button style={styles.linkButton} onClick={() => removeBlocked(item.id)}>삭제</button>
              </div>
            ))}
          </div>
        </section>

        <section style={styles.statsGrid}>
          <div style={styles.statCardBlue}>
            <div style={styles.statLabel}>고정 일정</div>
            <div style={styles.statValue}>{stats.fixed}</div>
          </div>
          <div style={styles.statCardRed}>
            <div style={styles.statLabel}>차단 시간</div>
            <div style={styles.statValue}>{stats.blocked}</div>
          </div>
          <div style={styles.statCardGreen}>
            <div style={styles.statLabel}>사용 가능 시간</div>
            <div style={styles.statValue}>{stats.available}h</div>
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
  notice: {
    padding: "10px 12px",
    borderRadius: 12,
    background: "rgba(239,68,68,0.12)",
    color: "#b91c1c",
    fontSize: 12,
    fontWeight: 600,
  },
  infoBanner: {
    background: "rgba(59,130,246,0.1)",
    border: "1px solid rgba(59,130,246,0.2)",
    padding: "10px 16px",
    borderRadius: 12,
    fontSize: 12,
  },
  card: {
    background: "white",
    borderRadius: 18,
    border: "1px solid rgba(15,23,42,0.08)",
    padding: 18,
    display: "grid",
    gap: 14,
  },
  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardTitle: { fontSize: 15, fontWeight: 700 },
  cardSub: { fontSize: 12, color: "#94a3b8" },
  btnGhost: {
    border: "1px solid rgba(15,23,42,0.12)",
    background: "white",
    padding: "8px 14px",
    borderRadius: 12,
    fontWeight: 700,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 34,
  },
  btnPrimary: {
    border: "none",
    padding: "8px 14px",
    borderRadius: 12,
    background: "linear-gradient(135deg, #3b82f6, #2563eb)",
    color: "white",
    fontWeight: 700,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 34,
  },
  form: { display: "grid", gap: 12 },
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
  dayRow: { display: "flex", gap: 8, flexWrap: "wrap" },
  dayChip: {
    border: "1px solid rgba(15,23,42,0.12)",
    borderRadius: 999,
    padding: "6px 10px",
    fontSize: 12,
    background: "white",
    cursor: "pointer",
  },
  dayChipActive: {
    background: "rgba(59,130,246,0.15)",
    borderColor: "rgba(59,130,246,0.4)",
    color: "#1d4ed8",
  },
  dayChipBlocked: {
    background: "rgba(239,68,68,0.12)",
    borderColor: "rgba(239,68,68,0.4)",
    color: "#b91c1c",
  },
  timeRow: {
    display: "grid",
    gap: 12,
    gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
  },
  formActions: { display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center" },
  empty: { fontSize: 12, color: "#94a3b8", padding: "8px 0" },
  itemList: { display: "grid", gap: 10 },
  item: {
    padding: "10px 12px",
    borderRadius: 12,
    background: "rgba(15,23,42,0.04)",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  itemTitle: { fontSize: 13, fontWeight: 700 },
  itemSub: { fontSize: 11, color: "#64748b" },
  linkButton: {
    border: "none",
    background: "transparent",
    color: "#ef4444",
    fontSize: 12,
    cursor: "pointer",
  },
  statsGrid: {
    display: "grid",
    gap: 12,
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  },
  statCardBlue: {
    background: "rgba(59,130,246,0.12)",
    borderRadius: 16,
    padding: 16,
  },
  statCardRed: {
    background: "rgba(239,68,68,0.12)",
    borderRadius: 16,
    padding: 16,
  },
  statCardGreen: {
    background: "rgba(34,197,94,0.12)",
    borderRadius: 16,
    padding: 16,
  },
  statLabel: { fontSize: 12, color: "#475569" },
  statValue: { fontSize: 22, fontWeight: 800, marginTop: 6 },
};
