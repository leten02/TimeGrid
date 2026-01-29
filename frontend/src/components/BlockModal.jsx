import { useEffect, useState } from "react";

function toInputValue(dt) {
  // datetime-local input 형식: YYYY-MM-DDTHH:mm
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
  initialBlock, // edit일 때 {id,title,note,start_at,end_at}
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

  useEffect(() => {
    if (!open) return;
    setErr("");
    if (mode === "edit" && initialBlock) {
      setTitle(initialBlock.title || "");
      setNote(initialBlock.note || "");
      setStartAt(toInputValue(new Date(initialBlock.start_at)));
      setEndAt(toInputValue(new Date(initialBlock.end_at)));
    } else {
      setTitle("");
      setNote("");
      const now = new Date();
      setStartAt(toInputValue(now));
      setEndAt(toInputValue(new Date(now.getTime() + 30 * 60 * 1000)));
    }
  }, [open, mode, initialBlock]);

  if (!open) return null;

  const submit = async () => {
    setLoading(true);
    setErr("");
    try {
      const payload = {
        title,
        note: note || null,
        start_at: new Date(startAt).toISOString(),
        end_at: new Date(endAt).toISOString(),
      };
      await onSubmit(payload);
      onClose();
    } catch (e) {
      setErr(String(e.message || e));
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
      setErr(String(e.message || e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 50,
      }}
      onClick={onClose}
    >
      <div
        style={{ width: 420, background: "white", borderRadius: 12, padding: 16 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ marginTop: 0 }}>{mode === "edit" ? "일정 편집" : "일정 생성"}</h2>

        <label>제목</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} style={{ width: "100%" }} />

        <div style={{ height: 10 }} />

        <label>메모</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} style={{ width: "100%" }} />

        <div style={{ height: 10 }} />

        <label>시작</label>
        <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} style={{ width: "100%" }} />

        <div style={{ height: 10 }} />

        <label>끝</label>
        <input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} style={{ width: "100%" }} />

        {err && <p style={{ color: "crimson" }}>{err}</p>}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
          <button onClick={onClose} disabled={loading}>닫기</button>
          {mode === "edit" && (
            <button onClick={del} disabled={loading} style={{ background: "crimson", color: "white" }}>
              삭제
            </button>
          )}
          <button onClick={submit} disabled={loading || !title.trim()}>
            {mode === "edit" ? "저장" : "생성"}
          </button>
        </div>
      </div>
    </div>
  );
}