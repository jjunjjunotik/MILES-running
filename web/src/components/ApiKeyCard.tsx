import { useEffect, useState } from "react";
import { CheckIcon, ShieldIcon, SparkIcon } from "./Icons";
import { Notice } from "./ui";

/**
 * API 키를 넣는 카드.
 *
 * 앱을 실행 중인 기기에서만 열린다(서버가 루프백 요청만 받는다).
 * 저장된 키는 되돌려받지 않는다. 끝 4자리만 확인용으로 표시된다.
 */

interface KeyStatus {
  provider: "gemini" | "claude";
  envName: string;
  configured: boolean;
  masked: string | null;
  source: "env-file" | "environment" | "none";
}

interface SetupStatus {
  enabled: boolean;
  envFileDisplay: string;
  writable: boolean;
  keys: KeyStatus[];
}

const SOURCE_LABEL: Record<KeyStatus["source"], string> = {
  "env-file": ".env 파일",
  environment: "환경변수",
  none: "미설정",
};

export function ApiKeyCard() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<
    { tone: "ok" | "error"; text: string } | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/setup")
      .then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        return (await response.json()) as SetupStatus;
      })
      .then((data) => {
        if (!cancelled) setStatus(data);
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 다른 기기에서 열었거나 설정이 꺼져 있으면 카드를 아예 보여 주지 않는다.
  if (unavailable || !status?.enabled) return null;

  const gemini = status.keys.find((key) => key.provider === "gemini");

  async function save() {
    if (busy || !value.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/setup/key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "gemini", key: value }),
      });
      const data = (await response.json()) as SetupStatus & {
        ok: boolean;
        error?: string;
        note?: string | null;
        verified?: boolean;
      };

      if (!data.ok) {
        setMessage({ tone: "error", text: data.error ?? "저장하지 못했어요." });
        return;
      }

      // 입력값은 화면에 남기지 않는다.
      setValue("");
      setStatus(data);
      setMessage({
        tone: "ok",
        text: data.note
          ? `저장했어요. 다만 ${data.note}`
          : data.verified
            ? "저장했고, 키가 정상 동작하는 것까지 확인했어요."
            : "저장했어요.",
      });
    } catch {
      setMessage({ tone: "error", text: "서버에 연결하지 못했어요." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="section-title">API 키</div>
      <div className="card">
        <div className="flex gap-12" style={{ alignItems: "flex-start" }}>
          <div className="icon-badge">
            <SparkIcon size={17} />
          </div>
          <div className="flex-1">
            <div style={{ fontWeight: 600, fontSize: 14 }}>Gemini API 키</div>
            <div className="small muted" style={{ marginTop: 2 }}>
              {gemini?.configured ? (
                <>
                  설정됨 · {SOURCE_LABEL[gemini.source]}{" "}
                  <span
                    style={{
                      fontFamily: "ui-monospace, SFMono-Regular, monospace",
                    }}
                  >
                    {gemini.masked}
                  </span>
                </>
              ) : (
                "아직 설정되지 않았어요. 지금은 샘플 결과가 표시됩니다."
              )}
            </div>
          </div>
          {gemini?.configured && (
            <span className="pill pill-good">
              <CheckIcon size={11} />
              연결됨
            </span>
          )}
        </div>

        <div className="mt-16">
          <label
            className="small muted"
            style={{ display: "block", marginBottom: 6 }}
            htmlFor="gemini-key"
          >
            {gemini?.configured ? "새 키로 바꾸기" : "키 붙여넣기"}
          </label>
          <input
            id="gemini-key"
            className="field"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="AIza..."
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void save();
            }}
            style={{
              fontFamily: "ui-monospace, SFMono-Regular, monospace",
              fontSize: 14,
            }}
          />
          <button
            className="btn btn-primary mt-12"
            disabled={busy || !value.trim() || !status.writable}
            onClick={() => void save()}
          >
            {busy ? "확인하는 중…" : "저장하고 연결 확인"}
          </button>

          {!status.writable && (
            <div className="small muted mt-8">
              {status.envFileDisplay} 에 쓸 권한이 없어 저장할 수 없어요.
            </div>
          )}
        </div>

        {message && (
          <div className="mt-12">
            <Notice tone={message.tone === "ok" ? "strong" : "plain"}>
              {message.text}
            </Notice>
          </div>
        )}

        <div className="mt-12">
          <Notice icon={<ShieldIcon />}>
            키는 <strong>{status.envFileDisplay}</strong> 에 저장되며 브라우저에
            남지 않습니다. 저장된 키는 이 화면으로 다시 내려오지 않고 끝 4자리만
            표시됩니다. 이 설정은 앱을 실행 중인 기기에서만 열립니다.
          </Notice>
        </div>

        <div className="small muted mt-12">
          키 발급:{" "}
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noreferrer noopener"
            style={{ color: "var(--accent-ink)" }}
          >
            aistudio.google.com/apikey
          </a>
        </div>
      </div>
    </>
  );
}
