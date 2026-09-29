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
import { AppleLogoIcon, BackIcon } from "../components/Icons";

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
      <div className="flow-top">
        {onBack ? (
          <button className="icon-btn" onClick={onBack} aria-label="돌아가기" style={{ marginLeft: -10 }}>
            <BackIcon size={22} />
          </button>
        ) : (
          <span />
        )}
        <span className="wordmark">NailSense</span>
        <span style={{ width: 40 }} />
      </div>

      <h2 className="auth-title">
        {mode === "login" ? "로그인" : "계정 만들기"}
      </h2>
      <p className="auth-lede">
        기록이 계정에 저장되어 기기를 바꿔도 이어져요. 로그인하지 않아도 앱은
        그대로 쓸 수 있어요.
      </p>

      <div className="social">
        {providers?.google && <div ref={googleSlot} className="google-slot" />}

        {providers?.apple && (
          <button
            className="btn btn-apple"
            onClick={() => void appleSignIn()}
            disabled={busy}
          >
            <AppleLogoIcon size={19} weight="fill" />
            Apple로 계속하기
          </button>
        )}

        {(providers?.google || providers?.apple) && !emailOpen && (
          <>
            <div className="divider">또는</div>
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
        <p className="form-error mt-12" role="alert">
          {error}
        </p>
      )}

      {emailOpen && (
        <form className="auth-form form-stack" onSubmit={submit}>
          {mode === "signup" && (
            <div>
              <label className="field-label" htmlFor="auth-name">
                이름 또는 닉네임 <span className="opt">(선택)</span>
              </label>
              <input
                id="auth-name"
                className="field"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoComplete="nickname"
                maxLength={40}
              />
              <p className="field-help">결과 화면에 표시돼요.</p>
            </div>
          )}

          <div>
            <label className="field-label" htmlFor="auth-email">
              이메일
            </label>
            <input
              id="auth-email"
              className="field"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              inputMode="email"
            />
          </div>

          <div>
            <label className="field-label" htmlFor="auth-password">
              비밀번호
            </label>
            <input
              id="auth-password"
              className="field"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              required
              minLength={8}
              aria-describedby="auth-password-help"
            />
            <p className="field-help" id="auth-password-help">
              8자 이상
            </p>
          </div>

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy
              ? "잠시만요"
              : mode === "login"
                ? "로그인"
                : "가입하고 시작하기"}
          </button>

          <button
            type="button"
            className="link"
            style={{ justifySelf: "center" }}
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

      <div className="auth-foot">
        <p className="fineprint" style={{ margin: 0 }}>
          비밀번호는 서버에 원문으로 저장되지 않아요. 손톱 사진은 계정이 아니라
          이 기기의 브라우저 안에만 보관돼요. {DISCLAIMER_SHORT}
        </p>
        {onBack && (
          <button className="link link-quiet" onClick={onBack}>
            로그인하지 않고 계속 쓰기
          </button>
        )}
      </div>
    </main>
  );
}
