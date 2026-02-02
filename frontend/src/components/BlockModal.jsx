import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

function toInputValue(dt) {
  // datetime-local input format: YYYY-MM-DDTHH:mm
  const pad = (n) => String(n).padStart(2, "0");
  const y = dt.getFullYear();
  const m = pad(dt.getMonth() + 1);
  const d = pad(dt.getDate());
  const hh = pad(dt.getHours());
  const mm = pad(dt.getMinutes());
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

export default function BlockModal({
  open,
  mode, // "create" | "edit"
  initialBlock, // may contain {id,title,note,start_at,end_at} or only {start_at,end_at} for preset
  onClose,
  onSubmit, // (payload) => Promise<void>
  onDelete, // () => Promise<void> (edit only)
}) {
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [startAt, setStartAt] = useState(toInputValue(new Date()));
  const [endAt, setEndAt] = useState(toInputValue(new Date(Date.now() + 30 * 60 * 1000)));
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const startDate = new Date(startAt);
  const endDate = new Date(endAt);
  const timeInvalid = Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || startDate >= endDate;
  const timeError = timeInvalid ? "끝 시간은 시작 시간 이후여야 합니다." : "";
  const isSubmitDisabled = loading || !title.trim() || timeInvalid;

  useEffect(() => {
    if (!open) return;
    setErr("");

    const hasPresetTimes = initialBlock?.start_at && initialBlock?.end_at;

    // edit mode: fill everything from initialBlock
    if (mode === "edit" && initialBlock) {
      setTitle(initialBlock.title || "");
      setNote(initialBlock.note || "");
      setStartAt(toInputValue(new Date(initialBlock.start_at)));
      setEndAt(toInputValue(new Date(initialBlock.end_at)));
      return;
    }

    // create mode
    setTitle("");
    setNote("");

    // If caller provided a preset time window, use it.
    if (hasPresetTimes) {
      setStartAt(toInputValue(new Date(initialBlock.start_at)));
      setEndAt(toInputValue(new Date(initialBlock.end_at)));
    } else {
      const now = new Date();
      setStartAt(toInputValue(now));
      setEndAt(toInputValue(new Date(now.getTime() + 30 * 60 * 1000)));
    }
  }, [open, mode, initialBlock]);

  if (!open) return null;

  const submit = async () => {
    if (timeInvalid) {
      setErr("");
      return;
    }
    setLoading(true);
    setErr("");
    try {
      const payload = {
        title: title.trim(),
        note: note || null,
        start_at: new Date(startAt).toISOString(),
        end_at: new Date(endAt).toISOString(),
      };
      await onSubmit(payload);
      onClose();
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  const del = async () => {
    if (!onDelete) return;
    setLoading(true);
    setErr("");
    try {
      await onDelete();
      onClose();
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  const content = (
    <div
      style={styles.overlay}
      onClick={onClose}
    >
      <style>{`
        .tg-modal-card { backdrop-filter: blur(18px); }
        .tg-input, .tg-textarea {
          width: 100%;
          border: 1px solid rgba(15,23,42,0.12);
          background: rgba(255,255,255,0.9);
          border-radius: 12px;
          padding: 10px 12px;
          font-size: 13px;
          color: #0f172a;
          min-width: 0;
          max-width: 100%;
          transition: border 0.15s ease, box-shadow 0.15s ease;
        }
        .tg-textarea { min-height: 90px; resize: vertical; }
        .tg-input:focus, .tg-textarea:focus {
          outline: none;
          border-color: rgba(59,130,246,0.5);
          box-shadow: 0 0 0 3px rgba(59,130,246,0.15);
        }
        .tg-btn {
          border-radius: 999px;
          padding: 8px 14px;
          font-weight: 700;
          cursor: pointer;
          border: 1px solid rgba(15,23,42,0.12);
          background: rgba(255,255,255,0.85);
          color: #0f172a;
          transition: transform 0.15s ease, box-shadow 0.15s ease;
        }
        .tg-btn:hover { transform: translateY(-1px); box-shadow: 0 8px 16px rgba(15,23,42,0.12); }
        .tg-btn-primary {
          background: linear-gradient(135deg, #0f172a, #1f2937);
          color: white;
          border-color: rgba(15,23,42,0.3);
        }
        .tg-btn-danger {
          background: linear-gradient(135deg, #ff453a, #ff3b30);
          color: white;
          border-color: rgba(255,59,48,0.4);
        }
        .tg-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          box-shadow: none;
          transform: none;
        }
        .tg-time-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
        .tg-time-grid > div { min-width: 0; }
        @media (max-width: 640px) {
          .tg-time-grid { grid-template-columns: 1fr; }
        }
      `}</style>
      <div
        style={styles.card}
        className="tg-modal-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div style={styles.header}>
          <div>
            <div style={styles.title}>{mode === "edit" ? "일정 편집" : "일정 생성"}</div>
            <div style={styles.subtitle}>시간과 내용을 입력하면 바로 반영됩니다.</div>
          </div>
          <div style={styles.badge}>{mode === "edit" ? "편집" : "새 일정"}</div>
        </div>

        <div style={styles.form}>
          <div style={styles.field}>
            <label style={styles.label}>제목</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="tg-input"
              placeholder="예: 운동, 회의, 공부"
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>메모</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="tg-textarea"
              placeholder="옵션"
            />
          </div>

          <div className="tg-time-grid">
            <div style={styles.field}>
              <label style={styles.label}>시작</label>
              <input
                type="datetime-local"
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
                className="tg-input"
              />
            </div>

            <div style={styles.field}>
              <label style={styles.label}>끝</label>
              <input
                type="datetime-local"
                value={endAt}
                onChange={(e) => setEndAt(e.target.value)}
                min={startAt}
                className="tg-input"
              />
            </div>
          </div>
        </div>

        {timeError && <p style={styles.error}>{timeError}</p>}
        {err && <p style={styles.error}>{err}</p>}

        <div style={styles.actions}>
          <button onClick={onClose} disabled={loading} className="tg-btn">닫기</button>
          {mode === "edit" && (
            <button onClick={del} disabled={loading} className="tg-btn tg-btn-danger">
              삭제
            </button>
          )}
          <button onClick={submit} disabled={isSubmitDisabled} className="tg-btn tg-btn-primary">
            {mode === "edit" ? "저장" : "생성"}
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return content;
  return createPortal(content, document.body);
}

const styles = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(15,23,42,0.35)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    zIndex: 10000,
  },
  card: {
    width: 520,
    maxWidth: "92vw",
    maxHeight: "90vh",
    overflowX: "hidden",
    overflowY: "auto",
    background: "rgba(255,255,255,0.92)",
    borderRadius: 24,
    padding: 22,
    border: "1px solid rgba(15,23,42,0.08)",
    boxShadow: "0 24px 60px rgba(15,23,42,0.2)",
    fontFamily: "'Pretendard','SF Pro Display','Apple SD Gothic Neo','Noto Sans KR',sans-serif",
    color: "#0f172a",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  title: { fontSize: 22, fontWeight: 800, letterSpacing: "-0.3px" },
  subtitle: { fontSize: 12, opacity: 0.7, marginTop: 4 },
  badge: {
    fontSize: 11,
    padding: "6px 10px",
    borderRadius: 999,
    background: "rgba(15,23,42,0.08)",
    fontWeight: 700,
  },
  form: {
    display: "grid",
    gap: 14,
  },
  field: {
    display: "grid",
    gap: 8,
    minWidth: 0,
  },
  label: {
    fontSize: 13,
    fontWeight: 600,
  },
  error: {
    color: "#dc2626",
    fontSize: 12,
    marginTop: 8,
  },
  actions: {
    display: "flex",
    gap: 8,
    justifyContent: "flex-end",
    marginTop: 16,
  },
};
