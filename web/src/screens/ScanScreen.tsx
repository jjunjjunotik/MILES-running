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

const STEPS = [
  "사진 확인하기",
  "항목별로 살펴보기",
  "설명과 팁 정리하기",
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
      reject(new DOMException("취소되었습니다.", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new DOMException("취소되었습니다.", "AbortError"));
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function ScanScreen({
  settings,
  demoMode,
  online = true,
  signedIn = false,
  onDone,
}: {
  settings: Settings;
  demoMode: boolean;
  online?: boolean;
  /** 로그인했으면 결과는 계정에, 아니면 이 기기에 저장한다. */
  signedIn?: boolean;
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
          : "사진을 불러오지 못했습니다. 다른 사진으로 시도해 주세요.",
      );
    }
  }

  async function run() {
    if (!image || busy) return;
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
            finger: FINGER_LABELS[finger],
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
      setError(
        err instanceof ApiError
          ? err.message
          : "이 사진으로는 결과를 만들지 못했어요. 다른 사진으로 다시 시도해 주세요.",
      );
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }

  if (busy) {
    return (
      <>
        <TopBar title="분석 중" />
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
                <div className="an-title">사진을 살펴보고 있어요</div>
                <div className="an-sub">
                  {attempt > 1
                    ? "생각보다 오래 걸리고 있어요. 계속 시도하고 있으니 그대로 두셔도 돼요."
                    : "보통 10~30초 정도 걸려요."}
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
                {attempt}번째 시도 중이에요.
                {attempt > 4 && lastReason ? ` 서버 응답: ${lastReason}` : ""}
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
            그만두기
          </button>
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar title="손톱 스캔" />
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
          aria-label={image ? "사진 다시 고르기" : "손톱 사진 고르기"}
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
            <img src={image.previewUrl} alt="선택한 손톱 사진 미리보기" />
          ) : (
            <span className="picker-empty">
              <CameraIcon size={30} />
              <strong>손톱 사진을 올려 주세요</strong>
              <span>눌러서 고르거나 파일을 끌어다 놓으세요</span>
            </span>
          )}
        </button>

        <div className="btn-row mt-12">
          <button
            className="btn btn-secondary"
            onClick={() => cameraInput.current?.click()}
          >
            <CameraIcon size={19} />
            촬영
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => fileInput.current?.click()}
          >
            <AlbumIcon size={19} />
            {image ? "다시 고르기" : "앨범"}
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
              {image.quality.hint} 이대로도 분석할 수 있지만, 볼 수 있는 항목이
              줄어들 수 있어요.
            </Notice>
          </div>
        )}

        <details className="how-to mt-8">
          <summary>
            <ChevronIcon size={16} />잘 찍는 방법
          </summary>
          <ul>
            <li>밝은 자연광 아래에서, 그림자가 지지 않게 찍어 주세요.</li>
            <li>손톱 하나가 화면의 절반 이상을 채우도록 가까이 찍어 주세요.</li>
            <li>매니큐어나 젤을 지운 상태여야 손톱판이 보여요.</li>
            <li>손톱 주변 피부까지 함께 나오면 더 많은 항목을 볼 수 있어요.</li>
          </ul>
        </details>

        <section className="sec">
          <h3 className="sec-title">어느 손톱인가요?</h3>
          <div className="pick-group" role="group" aria-label="손">
            <div className="chips">
              {(["left", "right"] as const).map((value) => (
                <button
                  key={value}
                  className="chip"
                  aria-pressed={hand === value}
                  onClick={() => setHand(value)}
                >
                  {value === "left" ? "왼손" : "오른손"}
                </button>
              ))}
            </div>
          </div>
          <div className="pick-group" role="group" aria-label="손가락">
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
            메모 <span className="opt">(선택)</span>
          </label>
          <textarea
            id="scan-note"
            className="field"
            rows={3}
            maxLength={300}
            placeholder="최근 변화나 신경 쓰이는 점"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <p className="field-help">
            적어 두면 다음에 같은 손톱을 찍었을 때 비교하기 좋아요.
          </p>
        </section>

        {demoMode && (
          <div className="mt-24">
            <Notice tone="accent">
              데모 모드예요. 실제 사진 분석 대신 샘플 결과를 보여 드려요.
            </Notice>
          </div>
        )}

        <button
          className="btn btn-primary mt-24"
          disabled={!image || !online}
          onClick={() => void run()}
        >
          분석 시작
        </button>

        {!online ? (
          <p className="scan-hint">
            <OfflineIcon size={16} />
            네트워크가 연결되면 분석할 수 있어요
          </p>
        ) : !image ? (
          <p className="scan-hint">
            <InfoIcon size={16} />
            먼저 사진을 골라 주세요
          </p>
        ) : null}

        <p className="fineprint mt-24">
          사진은 분석할 때만 이 앱의 서버를 거치고 서버에는 저장되지 않아요.
          {settings.keepPhotos
            ? " 분석이 끝난 사진은 이 기기에만 함께 저장돼요."
            : " 지금 설정에서는 사진을 기기에 저장하지 않고 결과만 남겨요."}
        </p>
      </main>
    </>
  );
}
