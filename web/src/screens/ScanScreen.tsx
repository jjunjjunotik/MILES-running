import { useEffect, useRef, useState } from "react";
import {
  FINGER_KEYS,
  FINGER_LABELS,
  type FingerKey,
} from "../../../shared/analysis";
import type { ResultView } from "../App";
import { analyze, ApiError } from "../lib/api";
import { ImageError, prepareImage, type PreparedImage } from "../lib/image";
import { saveRecord, type Settings } from "../lib/storage";
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

export function ScanScreen({
  settings,
  demoMode,
  onDone,
}: {
  settings: Settings;
  demoMode: boolean;
  onDone: (view: ResultView) => Promise<void> | void;
}) {
  const [image, setImage] = useState<PreparedImage | null>(null);
  const [hand, setHand] = useState<"left" | "right">("right");
  const [finger, setFinger] = useState<FingerKey>("index");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
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
    abort.current = new AbortController();

    try {
      const { analysis, demo } = await analyze({
        base64: image.base64,
        mediaType: image.mediaType,
        hand,
        finger: FINGER_LABELS[finger],
        note,
        signal: abort.current.signal,
      });

      const record = {
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        hand,
        finger,
        note,
        analysis,
        hasImage: settings.keepPhotos,
      };

      try {
        await saveRecord(record, settings.keepPhotos ? image.blob : null);
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
          : "분석 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.",
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
          <div className="analyzing">
            <div className="pulse-ring" />
            <div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                사진을 살펴보고 있어요
              </div>
              <div className="small muted">보통 10~30초 정도 걸려요</div>
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
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => abort.current?.abort()}
            >
              취소
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
          disabled={!image}
          onClick={() => void run()}
        >
          <SparkIcon size={18} />
          분석 시작
        </button>

        {!image && (
          <div className="small muted center mt-8">
            <InfoIcon size={13} /> 먼저 사진을 선택해 주세요
          </div>
        )}
      </main>
    </>
  );
}
