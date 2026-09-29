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
              err instanceof ServerError ? err.message : "Google sign-in failed.",
            ),
          )
          .finally(() => setBusy(false));
      },
    }).catch(() =>
      setError("Google sign-in couldn't load. Please continue with email."),
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
          : "Apple sign-in was cancelled or failed.",
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
          : "Something went wrong while signing in. Please try again in a moment.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="screen auth">
      <div className="flow-top">
        {onBack ? (
          <button className="icon-btn" onClick={onBack} aria-label="Back" style={{ marginLeft: -10 }}>
            <BackIcon size={22} />
          </button>
        ) : (
          <span />
        )}
        <span className="wordmark">NailSense</span>
        <span style={{ width: 40 }} />
      </div>

      <h2 className="auth-title">
        {mode === "login" ? "Log in" : "Create account"}
      </h2>
      <p className="auth-lede">
        Your history is saved to your account and follows you to new devices.
        You can keep using the app without logging in.
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
            Continue with Apple
          </button>
        )}

        {(providers?.google || providers?.apple) && !emailOpen && (
          <>
            <div className="divider">or</div>
            <button
              className="btn btn-secondary"
              onClick={() => setEmailOpen(true)}
            >
              Continue with email
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
                Name or nickname <span className="opt">(optional)</span>
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
              <p className="field-help">Shown on your results.</p>
            </div>
          )}

          <div>
            <label className="field-label" htmlFor="auth-email">
              Email
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
              Password
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
              At least 8 characters
            </p>
          </div>

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy
              ? "One moment"
              : mode === "login"
                ? "Log in"
                : "Create account"}
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
              ? "No account? Sign up"
              : "Already have an account? Log in"}
          </button>
        </form>
      )}

      <div className="auth-foot">
        <p className="fineprint" style={{ margin: 0 }}>
          Passwords are never stored as plain text. Nail photos stay in this
          browser, not in your account. {DISCLAIMER_SHORT}
        </p>
        {onBack && (
          <button className="link link-quiet" onClick={onBack}>
            Continue without an account
          </button>
        )}
      </div>
    </main>
  );
}
