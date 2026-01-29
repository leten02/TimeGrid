import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

export default function Onboarding() {
  const loginRef = useRef(null);
  const signupRef = useRef(null);
  const [err, setErr] = useState("");

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
          // resp.credential = base64 인코딩된 JWT ID token :contentReference[oaicite:1]{index=1}
          await api("/auth/google", {
            method: "POST",
            body: JSON.stringify({ id_token: resp.credential }),
          });
          window.location.href = "/week";
        } catch (e) {
          setErr(String(e.message || e));
        }
      },
    });

    // 버튼 2개 (text만 다르게)
    g.accounts.id.renderButton(loginRef.current, {
      theme: "outline",
      size: "large",
      text: "signin_with", // "Sign in with Google" :contentReference[oaicite:2]{index=2}
      shape: "rectangular",
      state: "login",
    });

    g.accounts.id.renderButton(signupRef.current, {
      theme: "filled_black",
      size: "large",
      text: "signup_with", // "Sign up with Google" :contentReference[oaicite:3]{index=3}
      shape: "rectangular",
      state: "signup",
    });
  }, []);

  return (
    <div style={{ padding: 24, maxWidth: 420 }}>
      <h1>TimeGrid</h1>
      <p>온보딩</p>

      <h3>로그인</h3>
      <div ref={loginRef} />

      <div style={{ height: 16 }} />

      <h3>계정이 없나요?</h3>
      <div ref={signupRef} />

      {err && <p style={{ marginTop: 16, color: "crimson" }}>{err}</p>}
    </div>
  );
}
