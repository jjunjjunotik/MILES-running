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
  CameraIcon,
  CheckIcon,
  InfoIcon,
  ShieldIcon,
  SparkIcon,
  UploadIcon,
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
  onDone,
}: {
  settings: Settings;
  demoMode: boolean;
  online?: boolean;
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
        if (STANDALONE_DEMO) {
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
          <div className="analyzing" role="status" aria-live="polite">
            <div className="pulse-ring" />
            <div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                사진을 살펴보고 있어요
              </div>
              <div className="small muted">
                {attempt > 1
                  ? "생각보다 오래 걸리고 있어요. 계속 시도하고 있으니 그대로 두셔도 돼요."
                  : "보통 10~30초 정도 걸려요"}
              </div>
            </div>
            <div className="step-list">
              {STEPS.map((label, index) => (
                <div
                  key={label}
                  className={`step${index <= step ? " done" : ""}`}
                >
                  <span className="mark">
                    {index < step ? <CheckIcon size={10} /> : null}
                  </span>
                  {label}
                </div>
              ))}
            </div>
            {attempt > 1 && (
              <div className="small muted center">
                {attempt}번째 시도 중
                {attempt > 4 && lastReason ? (
                  <>
                    <br />
                    <span style={{ opacity: 0.8 }}>서버 응답: {lastReason}</span>
                  </>
                ) : null}
              </div>
            )}
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => abort.current?.abort()}
            >
              그만두기
            </button>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar title="손톱 스캔" />
      <main className="screen stagger">
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

        <div
          className={`dropzone${dragging ? " dragging" : ""}`}
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
          onClick={() => !image && fileInput.current?.click()}
        >
          {image ? (
            <img src={image.previewUrl} alt="선택한 손톱 사진 미리보기" />
          ) : (
            <div className="dropzone-empty">
              <div className="big">
                <CameraIcon size={26} />
              </div>
              <strong>손톱 사진을 올려 주세요</strong>
              여기를 눌러 사진을 고르거나
              <br />
              파일을 끌어다 놓을 수 있어요
            </div>
          )}
        </div>

        <div className="btn-row mt-12">
          <button
            className="btn btn-secondary"
            onClick={() => cameraInput.current?.click()}
          >
            <CameraIcon size={18} />
            촬영
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => fileInput.current?.click()}
          >
            <UploadIcon size={18} />
            {image ? "다시 고르기" : "앨범"}
          </button>
        </div>

        {error && (
          <div className="mt-12">
            <Notice>{error}</Notice>
          </div>
        )}

        {image && image.quality.level === "warn" && (
          <div className="mt-12">
            <Notice tone="strong" icon={<InfoIcon size={15} />}>
              <strong>{image.quality.issues.join(" · ")}</strong>
              <br />
              {image.quality.hint}
              <br />
              이대로도 분석할 수 있지만, 볼 수 있는 항목이 줄어들 수 있어요.
            </Notice>
          </div>
        )}

        <div className="section-title">어느 손톱인가요?</div>
        <div className="card">
          <div className="chip-row">
            {(["left", "right"] as const).map((value) => (
              <button
                key={value}
                className={`chip${hand === value ? " active" : ""}`}
                onClick={() => setHand(value)}
              >
                {value === "left" ? "왼손" : "오른손"}
              </button>
            ))}
          </div>
          <div className="chip-row mt-12">
            {FINGER_KEYS.map((key) => (
              <button
                key={key}
                className={`chip${finger === key ? " active" : ""}`}
                onClick={() => setFinger(key)}
              >
                {FINGER_LABELS[key]}
              </button>
            ))}
          </div>
        </div>

        <div className="section-title">메모 (선택)</div>
        <textarea
          className="field"
          rows={3}
          maxLength={300}
          placeholder="최근 변화나 신경 쓰이는 점을 적어 두면 다음에 비교하기 좋아요."
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />

        <div className="section-title">잘 찍는 방법</div>
        <div className="card">
          <ul
            className="small muted"
            style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9 }}
          >
            <li>밝은 자연광 아래에서, 그림자가 지지 않게 찍어 주세요.</li>
            <li>손톱 하나가 화면의 절반 이상을 채우도록 가까이 찍어 주세요.</li>
            <li>매니큐어나 젤을 지운 상태여야 손톱판이 보입니다.</li>
            <li>손톱 주변 피부까지 함께 나오면 더 많은 항목을 볼 수 있어요.</li>
          </ul>
        </div>

        <div className="mt-16">
          <Notice icon={<ShieldIcon />}>
            사진은 분석을 위해 이 앱의 서버로만 전송되며 저장되지 않습니다.
            {settings.keepPhotos
              ? " 분석이 끝난 사진은 이 기기에만 함께 저장됩니다."
              : " 현재 설정에서는 사진을 기기에 저장하지 않고 결과만 남깁니다."}
          </Notice>
        </div>

        {demoMode && (
          <div className="mt-12">
            <Notice tone="strong" icon={<SparkIcon size={15} />}>
              데모 모드입니다. 실제 사진 분석 대신 샘플 결과가 표시됩니다.
            </Notice>
          </div>
        )}

        <button
          className="btn btn-primary mt-16"
          disabled={!image || !online}
          onClick={() => void run()}
        >
          <SparkIcon size={18} />
          분석 시작
        </button>

        {!online ? (
          <div className="small muted center mt-8">
            <InfoIcon size={13} /> 네트워크가 연결되면 분석할 수 있어요
          </div>
        ) : !image ? (
          <div className="small muted center mt-8">
            <InfoIcon size={13} /> 먼저 사진을 선택해 주세요
          </div>
        ) : null}
      </main>
    </>
  );
}
