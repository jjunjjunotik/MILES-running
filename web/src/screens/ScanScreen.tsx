import { useEffect, useRef, useState } from "react";
import {
  FINGER_KEYS,
  FINGER_LABELS,
  type FingerKey,
} from "../../../shared/analysis";
import type { ResultView } from "../App";
import { analyze, ApiError } from "../lib/api";
import { ImageError, prepareImage, type PreparedImage } from "../lib/image";
import { putImage, saveRecord, type Settings } from "../lib/storage";
import { STANDALONE_DEMO } from "../lib/api";
import {
  AlbumIcon,
  CameraIcon,
  CheckCircleIcon,
  ChevronIcon,
  CircleIcon,
  InfoIcon,
  OfflineIcon,
} from "../components/Icons";
import { Notice, TopBar } from "../components/ui";
import { ConsentSheet } from "../components/ConsentSheet";
import { giveConsent, hasConsent, withdrawConsent } from "../lib/consent";
import { formatBillingDate, usageExhausted, usageLine } from "../lib/billing";
import type { UsageInfo } from "../../../shared/billing";

const STEPS = [
  "Checking the photo",
  "Looking at each area",
  "Writing up notes and tips",
];

/**
 * 서버가 잠깐 막히거나 모델이 혼잡한 것 때문에 사용자를 오류 화면으로 내보내지 않는다.
 * 될 때까지 계속 다시 시도하고, 그동안 화면은 분석 중인 상태 그대로 둔다.
 * 빠져나갈 길은 언제나 "취소" 버튼이다.
 *
 * 다만 아무리 다시 보내도 답이 달라지지 않는 것들은 여기서 걸러 낸다.
 * 사진에 손톱이 없거나, 너무 흐리거나, 애초에 보낼 수 없는 파일인 경우가 그렇다.
 * 이건 실패가 아니라 "다시 찍어 주세요"라는 결과이므로 바로 알려 주는 편이 맞다.
 */
const STOP_CODES = new Set([
  "unauthorized",
  "not_a_nail_photo",
  "unusable_image",
  "bad_request",
  "declined",
  // 이번 기간의 분석 횟수를 다 썼거나, 동의 없이 보낸 요청. 다시 보내도 같다.
  "quota_exceeded",
  "consent_required",
]);

const RETRY_FIRST_MS = 2000;
const RETRY_MAX_MS = 15000;

/** 1차 2초에서 시작해 15초까지 늘린다. 상한을 둬서 영원히 느려지지는 않게 한다. */
function retryDelay(attempt: number): number {
  return Math.min(RETRY_FIRST_MS * 1.6 ** (attempt - 1), RETRY_MAX_MS);
}

/** 기다리는 동안에도 취소가 먹어야 한다. */
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Cancelled", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new DOMException("Cancelled", "AbortError"));
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function ScanScreen({
  settings,
  demoMode,
  online = true,
  signedIn = false,
  usage = null,
  onUsage,
  onOpenPlan,
  onSignIn,
  onDone,
}: {
  settings: Settings;
  demoMode: boolean;
  online?: boolean;
  /** 로그인했으면 결과는 계정에, 아니면 이 기기에 저장한다. */
  signedIn?: boolean;
  /** 이번 기간의 사용량. 한도가 없거나 아직 모르면 null */
  usage?: UsageInfo | null;
  onUsage?: (usage: UsageInfo) => void;
  onOpenPlan?: () => void;
  onSignIn?: () => void;
  onDone: (view: ResultView) => Promise<void> | void;
}) {
  const [image, setImage] = useState<PreparedImage | null>(null);
  const [hand, setHand] = useState<"left" | "right">("right");
  const [finger, setFinger] = useState<FingerKey>("index");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /** 몇 번째 시도인지. 1보다 커지면 분석 화면에 조용히 진행 상황을 덧붙인다. */
  const [attempt, setAttempt] = useState(1);
  /** 마지막으로 막힌 이유. 오래 걸릴 때만, 참고 정보로 보여 준다. */
  const [lastReason, setLastReason] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  /** 첫 분석 전 건강 데이터 처리 동의 창 */
  const [askConsent, setAskConsent] = useState(false);

  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const imageRef = useRef<PreparedImage | null>(null);

  imageRef.current = image;

  useEffect(
    () => () => {
      abort.current?.abort();
      if (imageRef.current) URL.revokeObjectURL(imageRef.current.previewUrl);
    },
    [],
  );

  // 분석이 진행되는 동안 단계 표시를 순차적으로 켠다.
  useEffect(() => {
    if (!busy) {
      setStep(0);
      return;
    }
    const timers = [
      setTimeout(() => setStep(1), 1200),
      setTimeout(() => setStep(2), 4500),
    ];
    return () => timers.forEach(clearTimeout);
  }, [busy]);

  async function pick(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const prepared = await prepareImage(file);
      setImage((previous) => {
        if (previous) URL.revokeObjectURL(previous.previewUrl);
        return prepared;
      });
    } catch (err) {
      setError(
        err instanceof ImageError
          ? err.message
          : "We couldn't open that photo. Please try another one.",
      );
    }
  }

  async function run() {
    if (!image || busy) return;
    // 사진을 보내기 전에 동의부터 받는다. 서버 없는 데모는 사진이 기기를 떠나지 않으므로 묻지 않는다.
    if (!STANDALONE_DEMO && !hasConsent()) {
      setAskConsent(true);
      return;
    }
    setBusy(true);
    setError(null);
    setAttempt(1);
    setLastReason(null);
    abort.current = new AbortController();
    const signal = abort.current.signal;

    try {
      // 될 때까지 시도한다. 끝내는 길은 성공, 취소, 그리고 다시 보내도 소용없는 응답뿐이다.
      let result: Awaited<ReturnType<typeof analyze>> | null = null;
      for (let tries = 1; result === null; tries += 1) {
        try {
          result = await analyze({
            base64: image.base64,
            mediaType: image.mediaType,
            hand,
            fingerKey: finger,
            note,
            keepPhoto: settings.keepPhotos,
            signal,
          });
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") throw err;
          if (err instanceof ApiError && STOP_CODES.has(err.code)) throw err;

          setLastReason(err instanceof Error ? err.message : null);
          setAttempt(tries + 1);
          const backoff = retryDelay(tries);
          const asked = err instanceof ApiError ? err.retryAfterMs ?? 0 : 0;
          await wait(Math.max(backoff, asked), signal);
        }
      }

      const { analysis, demo, scanId } = result;
      if (result.usage) onUsage?.(result.usage);

      // 로그인 상태에서는 서버가 기록 아이디를 정한다. 사진은 그 아이디로 기기에 저장한다.
      const recordId = scanId ?? crypto.randomUUID();
      const record = {
        id: recordId,
        createdAt: Date.now(),
        hand,
        finger,
        note,
        analysis,
        hasImage: settings.keepPhotos,
      };

      try {
        if (STANDALONE_DEMO || !signedIn) {
          // 계정이 없으면 결과도 사진도 이 기기에만 남는다.
          await saveRecord(record, settings.keepPhotos ? image.blob : null);
        } else if (settings.keepPhotos) {
          await putImage(recordId, image.blob);
        }
      } catch {
        // 저장소를 못 쓰더라도 결과는 보여 준다.
      }

      // 결과 화면이 소유할 별도의 URL 을 만들어 스캔 화면의 미리보기와 수명을 분리한다.
      await onDone({
        recordId: record.id,
        analysis,
        createdAt: record.createdAt,
        hand,
        finger,
        note,
        imageUrl: URL.createObjectURL(image.blob),
        demo,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (err instanceof ApiError && err.code === "quota_exceeded" && err.usage) {
        // 한도 안내는 분석 버튼 자리에 따로 그린다.
        onUsage?.(err.usage);
        return;
      }
      if (err instanceof ApiError && err.code === "consent_required") {
        // 동의 문구가 바뀌었다. 다시 묻는다.
        withdrawConsent();
        setAskConsent(true);
        return;
      }
      setError(
        err instanceof ApiError
          ? err.message
          : "We couldn't get a result from this photo. Please try another one.",
      );
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }

  if (busy) {
    return (
      <>
        <TopBar title="Analyzing" />
        <main className="screen">
          {/* 진행 상황을 화면 낭독기에도 알린다. */}
          <div role="status" aria-live="polite">
            <div className="an-head">
              {image ? (
                <img className="thumb" src={image.previewUrl} alt="" />
              ) : (
                <div className="thumb" aria-hidden="true" />
              )}
              <div>
                <div className="an-title">Looking at your photo</div>
                <div className="an-sub">
                  {attempt > 1
                    ? "This is taking longer than usual. We're still trying, so you can leave it running."
                    : "This usually takes 10 to 30 seconds."}
                </div>
              </div>
            </div>

            <ol className="steps">
              {STEPS.map((label, index) => {
                const state =
                  index < step ? "done" : index === step ? "current" : "";
                return (
                  <li key={label} className={`step ${state}`}>
                    {index < step ? (
                      <CheckCircleIcon size={20} weight="fill" />
                    ) : (
                      <CircleIcon size={20} weight={index === step ? "bold" : "regular"} />
                    )}
                    {label}
                  </li>
                );
              })}
            </ol>

            {attempt > 1 && (
              <p className="retry-note">
                Attempt {attempt}.
                {attempt > 4 && lastReason ? ` Server said: ${lastReason}` : ""}
              </p>
            )}
          </div>

          {/* 결과가 들어올 자리를 미리 그려 둔다. */}
          <div className="skel-result" aria-hidden="true">
            <span className="skel" style={{ height: 22, width: "72%" }} />
            <span className="skel" style={{ height: 14, width: "100%" }} />
            <span className="skel" style={{ height: 14, width: "88%" }} />
            <div className="skel-grid">
              {Array.from({ length: 6 }, (_, index) => (
                <div key={index} style={{ display: "grid", gap: 6 }}>
                  <span className="skel" style={{ height: 12, width: "40%" }} />
                  <span className="skel" style={{ height: 16, width: "70%" }} />
                </div>
              ))}
            </div>
          </div>

          <button
            className="btn btn-secondary mt-24"
            onClick={() => abort.current?.abort()}
          >
            Stop
          </button>
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar title="Scan a nail" />
      <main className="screen">
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => void pick(event.target.files?.[0])}
        />
        <input
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(event) => void pick(event.target.files?.[0])}
        />

        <button
          type="button"
          className={`picker${dragging ? " dragging" : ""}`}
          aria-label={image ? "Choose a different photo" : "Choose a nail photo"}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void pick(event.dataTransfer.files?.[0]);
          }}
          onClick={() => fileInput.current?.click()}
        >
          {image ? (
            <img src={image.previewUrl} alt="Preview of the selected nail photo" />
          ) : (
            <span className="picker-empty">
              <CameraIcon size={30} />
              <strong>Add a photo of your nail</strong>
              <span>Tap to choose, or drop a file here</span>
            </span>
          )}
        </button>

        <div className="btn-row mt-12">
          <button
            className="btn btn-secondary"
            onClick={() => cameraInput.current?.click()}
          >
            <CameraIcon size={19} />
            Camera
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => fileInput.current?.click()}
          >
            <AlbumIcon size={19} />
            {image ? "Replace" : "Library"}
          </button>
        </div>

        {error && (
          <div className="mt-12">
            <Notice tone="consult">{error}</Notice>
          </div>
        )}

        {image && image.quality.level === "warn" && (
          <div className="mt-12">
            <Notice tone="monitor">
              <strong>{image.quality.issues.join(", ")}</strong>
              <br />
              {image.quality.hint} You can still analyze it, but fewer areas
              may be visible.
            </Notice>
          </div>
        )}

        <details className="how-to mt-8">
          <summary>
            <ChevronIcon size={16} />Tips for a good photo
          </summary>
          <ul>
            <li>Use bright, natural light and avoid shadows.</li>
            <li>Get close so one nail fills at least half the frame.</li>
            <li>Remove polish or gel so the nail plate is visible.</li>
            <li>Include the skin around the nail so more areas can be checked.</li>
          </ul>
        </details>

        <section className="sec">
          <h3 className="sec-title">Which nail is it?</h3>
          <div className="pick-group" role="group" aria-label="Hand">
            <div className="chips">
              {(["left", "right"] as const).map((value) => (
                <button
                  key={value}
                  className="chip"
                  aria-pressed={hand === value}
                  onClick={() => setHand(value)}
                >
                  {value === "left" ? "Left hand" : "Right hand"}
                </button>
              ))}
            </div>
          </div>
          <div className="pick-group" role="group" aria-label="Finger">
            <div className="chips">
              {FINGER_KEYS.map((key) => (
                <button
                  key={key}
                  className="chip"
                  aria-pressed={finger === key}
                  onClick={() => setFinger(key)}
                >
                  {FINGER_LABELS[key]}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="sec">
          <label className="field-label" htmlFor="scan-note">
            Note <span className="opt">(optional)</span>
          </label>
          <textarea
            id="scan-note"
            className="field"
            rows={3}
            maxLength={300}
            placeholder="Recent changes or anything bothering you"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <p className="field-help">
            Helps you compare the next time you photograph this nail.
          </p>
        </section>

        {demoMode && (
          <div className="mt-24">
            <Notice tone="accent">
              Demo mode. You'll see sample results instead of a real analysis.
            </Notice>
          </div>
        )}

        {usageExhausted(usage) && usage ? (
          <QuotaPanel
            usage={usage}
            signedIn={signedIn}
            onOpenPlan={onOpenPlan}
            onSignIn={onSignIn}
          />
        ) : (
          <>
            <button
              className="btn btn-primary mt-24"
              disabled={!image || !online}
              onClick={() => void run()}
            >
              Analyze
            </button>
            {usage && usageLine(usage) && (
              <p className="usage-line">
                {usageLine(usage)}
                {usage.plan === "free" && onOpenPlan && (
                  <>
                    {" · "}
                    <button className="link" onClick={onOpenPlan}>
                      See Pro
                    </button>
                  </>
                )}
              </p>
            )}
          </>
        )}

        {usageExhausted(usage) ? null : !online ? (
          <p className="scan-hint">
            <OfflineIcon size={16} />
            You can analyze once you're back online
          </p>
        ) : !image ? (
          <p className="scan-hint">
            <InfoIcon size={16} />
            Choose a photo first
          </p>
        ) : null}

        <p className="fineprint mt-24">
          Your photo passes through our server only for analysis and is never stored there.
          {settings.keepPhotos
            ? " After analysis, it's saved on this device only."
            : " With your current settings, only the result is kept, not the photo."}
        </p>
      </main>

      {askConsent && (
        <ConsentSheet
          signedIn={signedIn}
          onClose={() => setAskConsent(false)}
          onAgree={() => {
            giveConsent();
            setAskConsent(false);
            void run();
          }}
        />
      )}
    </>
  );
}

/** 이번 기간의 분석 횟수를 다 썼을 때 분석 버튼 자리에 보여 준다. */
function QuotaPanel({
  usage,
  signedIn,
  onOpenPlan,
  onSignIn,
}: {
  usage: UsageInfo;
  signedIn: boolean;
  onOpenPlan?: () => void;
  onSignIn?: () => void;
}) {
  const pro = usage.plan === "pro";
  return (
    <div className="quota mt-24" role="status">
      <div className="t">
        {pro
          ? `You've reached today's limit of ${usage.limit} scans`
          : `You've used your ${usage.limit} free ${usage.limit === 1 ? "scan" : "scans"} this month`}
      </div>
      <p>
        {pro
          ? "You can scan again tomorrow (the limit resets at midnight UTC)."
          : `They reset on ${formatBillingDate(usage.resetsAt)}.`}{" "}
        Your past results, including warning-sign checks, are still in History.
      </p>
      {!pro && (
        <div className={signedIn || !onSignIn ? "mt-12" : "btn-row mt-12"}>
          {!signedIn && onSignIn && (
            <button className="btn btn-secondary" onClick={onSignIn}>
              Log in
            </button>
          )}
          {onOpenPlan && (
            <button className="btn btn-primary" onClick={onOpenPlan}>
              See Pro
            </button>
          )}
        </div>
      )}
    </div>
  );
}
