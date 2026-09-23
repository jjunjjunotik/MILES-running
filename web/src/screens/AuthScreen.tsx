import { useState } from "react";
import { DISCLAIMER_SHORT } from "../../../shared/analysis";
import { ServerError, login, signup, type AuthUser } from "../lib/server";
import { ShieldIcon, SparkIcon } from "../components/Icons";
import { Notice } from "../components/ui";

type Mode = "login" | "signup";

/**
 * 이메일 계정으로 들어오는 화면.
 *
 * 비밀번호는 이 화면을 떠나면 어디에도 남지 않는다. 상태에만 잠깐 있다가
 * 요청과 함께 사라지고, 기기에 저장하지 않는다. 로그인 유지는 서버가 내려 주는
 * httpOnly 쿠키가 맡는다.
 */
export function AuthScreen({
  onSignedIn,
  onBack,
}: {
  onSignedIn: (user: AuthUser, justSignedUp: boolean) => void;
  onBack?: () => void;
}) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return; // 버튼을 여러 번 눌러도 요청은 한 번만 나간다.

    setBusy(true);
    setError(null);
    try {
      const user =
        mode === "signup"
          ? await signup({ email, password, displayName })
          : await login({ email, password });
      setPassword("");
      onSignedIn(user, mode === "signup");
    } catch (err) {
      setError(
        err instanceof ServerError
          ? err.message
          : "로그인 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="screen auth">
      <div className="brandmark center" style={{ justifyContent: "center" }}>
        <SparkIcon size={15} />
        NailSense
      </div>

      <h2 className="auth-title">
        {mode === "login" ? "다시 오셨네요" : "계정을 만들어요"}
      </h2>
      <p className="small muted center">
        {mode === "login"
          ? "기록은 계정에 저장되어 기기를 바꿔도 이어집니다."
          : "분석 기록을 계정에 저장해 날짜별로 비교할 수 있어요."}
      </p>

      <form className="card mt-16" onSubmit={submit}>
        {mode === "signup" && (
          <label className="field-row">
            <span>이름 또는 닉네임 (선택)</span>
            <input
              className="field"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoComplete="nickname"
              maxLength={40}
              placeholder="결과 화면에 표시돼요"
            />
          </label>
        )}

        <label className="field-row">
          <span>이메일</span>
          <input
            className="field"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
            inputMode="email"
            placeholder="you@example.com"
          />
        </label>

        <label className="field-row">
          <span>비밀번호</span>
          <input
            className="field"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            required
            minLength={8}
            placeholder="8자 이상"
          />
        </label>

        {error && (
          <div className="auth-error" role="alert">
            {error}
          </div>
        )}

        <button className="btn btn-primary mt-12" type="submit" disabled={busy}>
          {busy
            ? "잠시만요…"
            : mode === "login"
              ? "로그인"
              : "가입하고 시작하기"}
        </button>

        <button
          type="button"
          className="link-btn center mt-12"
          style={{ width: "100%" }}
          onClick={() => {
            setMode(mode === "login" ? "signup" : "login");
            setError(null);
          }}
        >
          {mode === "login"
            ? "계정이 없으신가요? 가입하기"
            : "이미 계정이 있으신가요? 로그인"}
        </button>
      </form>

      <div className="mt-16">
        <Notice icon={<ShieldIcon size={15} />}>
          비밀번호는 서버에 원문으로 저장되지 않습니다. 손톱 사진은 계정이 아니라
          이 기기의 브라우저 안에만 보관됩니다.
        </Notice>
      </div>

      <div className="small muted center mt-16">{DISCLAIMER_SHORT}</div>

      {onBack && (
        <button className="link-btn center mt-16" style={{ width: "100%" }} onClick={onBack}>
          앱 소개 다시 보기
        </button>
      )}
    </main>
  );
}
