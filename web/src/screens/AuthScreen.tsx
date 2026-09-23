import { useEffect, useRef, useState } from "react";
import { DISCLAIMER_SHORT } from "../../../shared/analysis";
import {
  ServerError,
  fetchProviders,
  login,
  signInWithApple,
  signInWithGoogle,
  signup,
  type AuthUser,
  type Providers,
} from "../lib/server";
import { mountGoogleButton, signInWithApplePopup } from "../lib/social";
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
  const [providers, setProviders] = useState<Providers | null>(null);
  /** 이메일 폼은 접어 둔다. 대부분은 소셜 버튼 하나로 끝나기 때문이다. */
  const [emailOpen, setEmailOpen] = useState(false);
  const googleSlot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchProviders()
      .then((found) => {
        if (cancelled) return;
        setProviders(found);
        // 소셜이 하나도 없으면 이메일 폼을 처음부터 펼쳐 둔다.
        if (!found.google && !found.apple) setEmailOpen(true);
      })
      .catch(() => {
        if (!cancelled) {
          setProviders({ password: true, google: false, apple: false });
          setEmailOpen(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 구글 버튼은 구글이 직접 그린다. 설정돼 있을 때만 스크립트를 불러온다.
  useEffect(() => {
    const google = providers?.google;
    if (!google || !googleSlot.current) return;
    void mountGoogleButton({
      clientId: google.clientId,
      parent: googleSlot.current,
      onToken: (idToken) => {
        setBusy(true);
        setError(null);
        void signInWithGoogle(idToken)
          .then((user) => onSignedIn(user, false))
          .catch((err) =>
            setError(
              err instanceof ServerError ? err.message : "구글 로그인에 실패했어요.",
            ),
          )
          .finally(() => setBusy(false));
      },
    }).catch(() =>
      setError("구글 로그인을 불러오지 못했어요. 이메일로 계속해 주세요."),
    );
  }, [providers, onSignedIn]);

  async function appleSignIn() {
    const apple = providers?.apple;
    if (!apple || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await signInWithApplePopup(apple.clientId);
      const user = await signInWithApple(result);
      onSignedIn(user, false);
    } catch (err) {
      setError(
        err instanceof ServerError
          ? err.message
          : "애플 로그인이 취소되었거나 실패했어요.",
      );
    } finally {
      setBusy(false);
    }
  }

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
        기록이 계정에 저장되어 기기를 바꿔도 이어집니다. 로그인하지 않아도 앱은
        그대로 쓸 수 있어요.
      </p>

      <div className="social-row mt-16">
        {providers?.google && <div ref={googleSlot} className="google-slot" />}

        {providers?.apple && (
          <button
            className="btn social-btn apple"
            onClick={() => void appleSignIn()}
            disabled={busy}
          >
            <AppleMark />
            Apple로 계속하기
          </button>
        )}

        {(providers?.google || providers?.apple) && !emailOpen && (
          <>
            <div className="social-divider">
              <span>또는</span>
            </div>
            <button
              className="btn btn-secondary"
              onClick={() => setEmailOpen(true)}
            >
              이메일로 계속하기
            </button>
          </>
        )}
      </div>

      {error && !emailOpen && (
        <div className="auth-error" role="alert">
          {error}
        </div>
      )}

      {emailOpen && (
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
      )}

      <div className="mt-16">
        <Notice icon={<ShieldIcon size={15} />}>
          비밀번호는 서버에 원문으로 저장되지 않습니다. 손톱 사진은 계정이 아니라
          이 기기의 브라우저 안에만 보관됩니다.
        </Notice>
      </div>

      <div className="small muted center mt-16">{DISCLAIMER_SHORT}</div>

      {onBack && (
        <button className="link-btn center mt-16" style={{ width: "100%" }} onClick={onBack}>
          로그인하지 않고 계속 쓰기
        </button>
      )}
    </main>
  );
}

/** 애플 가이드라인상 버튼에는 애플 마크가 들어가야 한다. */
function AppleMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16.36 12.73c-.02-2.3 1.88-3.4 1.96-3.46-1.07-1.56-2.73-1.78-3.32-1.8-1.42-.14-2.76.83-3.48.83-.72 0-1.82-.81-2.99-.79-1.54.02-2.96.89-3.75 2.27-1.6 2.77-.41 6.87 1.15 9.12.76 1.1 1.67 2.34 2.86 2.29 1.15-.05 1.58-.74 2.97-.74 1.39 0 1.78.74 2.99.72 1.23-.02 2.01-1.12 2.76-2.23.87-1.28 1.23-2.52 1.25-2.58-.03-.01-2.4-.92-2.4-3.63zM14.1 5.3c.63-.77 1.06-1.83.94-2.9-.91.04-2.02.61-2.67 1.37-.58.68-1.09 1.77-.95 2.81 1.02.08 2.05-.52 2.68-1.28z" />
    </svg>
  );
}
