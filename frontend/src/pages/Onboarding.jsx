import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

function Logo() {
  return (
    <img
      src="/brand/timegrid_header_light.png"
      alt="TimeGrid"
      style={styles.logo}
    />
  );
}

export default function Onboarding() {
  const loginRef = useRef(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const g = window.google;
    if (!g) return;

    if (!CLIENT_ID) {
      setErr("VITE_GOOGLE_CLIENT_ID가 비어있음 (.env 확인)");
      return;
    }

    g.accounts.id.initialize({
      client_id: CLIENT_ID,
      callback: async (resp) => {
        try {
          setErr("");
          setLoading(true);
          // resp.credential = base64 인코딩된 JWT ID token
          await api("/auth/google", {
            method: "POST",
            body: JSON.stringify({ id_token: resp.credential }),
          });
          window.location.href = "/week";
        } catch (e) {
          setErr(String(e?.message || e));
          setLoading(false);
        }
      },
    });

    // Single button only
    g.accounts.id.renderButton(loginRef.current, {
      theme: "outline",
      size: "large",
      text: "signin_with",
      shape: "rectangular",
      state: "login",
      width: 280,
    });
  }, []);

  return (
    <div style={styles.page}>
      <div style={styles.heroPattern} />
      <div style={styles.heroGlow} />

      <div style={styles.content}>
        <Logo />

        <div style={styles.title}>주간 계획을 한 번에 정리하세요</div>
        <div style={styles.sub}>
          TimeGrid는 주간 시간표 기반으로 공부/일정 루틴을 정리하고,
          다음 행동을 빠르게 이어가도록 도와줍니다.
        </div>

        <div style={styles.ctaWrap}>
          <div style={styles.googleButtonWrap}>
            <div ref={loginRef} />
          </div>

          {loading && <div style={styles.loading}>로그인 처리 중…</div>}

          <div style={styles.helper}>
            * Google 계정 1개로만 로그인합니다. (MVP)
          </div>
        </div>

        {err && <div style={styles.err}>{err}</div>}

        <div style={styles.footer}>
          <span style={{ opacity: 0.6 }}>© {new Date().getFullYear()} TimeGrid</span>
        </div>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    display: "grid",
    placeItems: "center",
    padding: "clamp(20px, 4vw, 40px)",
    background: "linear-gradient(180deg, #f5f7fb, #f5f7fb)",
    position: "relative",
    overflow: "hidden",
  },
  heroPattern: {
    position: "absolute",
    inset: 0,
    backgroundImage: "url('/brand/hero_pattern.png')",
    backgroundRepeat: "no-repeat",
    backgroundSize: "cover",
    backgroundPosition: "center",
    opacity: 0.95,
    filter: "saturate(1.1)",
    pointerEvents: "none",
  },
  heroGlow: {
    position: "absolute",
    inset: 0,
    background:
      "radial-gradient(500px 300px at 20% 20%, rgba(90,140,255,0.35), transparent 60%)," +
      "radial-gradient(520px 320px at 85% 25%, rgba(0,200,200,0.30), transparent 60%)," +
      "radial-gradient(520px 320px at 15% 85%, rgba(0,220,140,0.22), transparent 60%)",
    opacity: 0.6,
    pointerEvents: "none",
  },
  content: {
    width: "min(720px, 92vw)",
    textAlign: "center",
    display: "grid",
    gap: 12,
    position: "relative",
    zIndex: 1,
  },
  logo: {
    height: 36,
    width: "auto",
    margin: "0 auto",
  },
  title: {
    fontSize: "clamp(24px, 3.2vw, 34px)",
    fontWeight: 900,
    letterSpacing: -0.2,
  },
  sub: {
    fontSize: "clamp(13px, 1.6vw, 15px)",
    lineHeight: 1.55,
    opacity: 0.75,
  },
  ctaWrap: {
    display: "grid",
    gap: 10,
    justifyItems: "center",
    marginTop: 6,
  },
  googleButtonWrap: {
    padding: "8px 12px",
    borderRadius: 12,
    background: "rgba(255,255,255,0.9)",
    border: "1px solid rgba(0,0,0,0.08)",
    boxShadow: "0 12px 30px rgba(0,0,0,0.08)",
  },
  loading: {
    fontSize: 12.5,
    opacity: 0.75,
  },
  helper: {
    fontSize: 12,
    opacity: 0.65,
  },
  err: {
    marginTop: 6,
    padding: "10px 12px",
    borderRadius: 12,
    background: "rgba(220, 38, 38, 0.08)",
    border: "1px solid rgba(220, 38, 38, 0.18)",
    color: "rgb(185, 28, 28)",
    fontSize: 13,
    lineHeight: 1.4,
  },
  footer: {
    marginTop: 8,
    fontSize: 12,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
  },
};
