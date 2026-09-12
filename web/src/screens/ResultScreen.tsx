import { useMemo, useState } from "react";
import {
  DISCLAIMER_LONG,
  FINGER_LABELS,
  METRIC_LABELS,
  STATUS_LABELS,
  type NailRecord,
} from "../../../shared/analysis";
import type { ResultView } from "../App";
import type { Settings } from "../lib/storage";
import { renderShareCard, shareOrDownload } from "../lib/share";
import { MetricList } from "../components/MetricList";
import { TipList } from "../components/TipList";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CameraIcon,
  MinusIcon,
  ResultIcon,
  ShareIcon,
  SparkIcon,
  StethoscopeIcon,
} from "../components/Icons";
import {
  Empty,
  Notice,
  ScoreRing,
  TopBar,
  formatDate,
} from "../components/ui";

export function ResultScreen({
  result,
  settings,
  records,
  onStartScan,
  onGoHistory,
}: {
  result: ResultView | null;
  settings: Settings;
  records: NailRecord[];
  onStartScan: () => void;
  onGoHistory: () => void;
}) {
  const [sharing, setSharing] = useState(false);
  const [shareMessage, setShareMessage] = useState<string | null>(null);

  // 같은 손가락의 바로 이전 기록과 비교한다. 부위가 다르면 비교하지 않는다.
  const previous = useMemo(() => {
    if (!result) return null;
    return (
      records.find(
        (record) =>
          record.id !== result.recordId &&
          record.createdAt < result.createdAt &&
          record.hand === result.hand &&
          record.finger === result.finger,
      ) ?? null
    );
  }, [records, result]);

  if (!result) {
    return (
      <>
        <TopBar title="결과" />
        <main className="screen">
          <Empty
            icon={<ResultIcon size={24} />}
            title="아직 볼 결과가 없어요"
            body="손톱 사진을 한 장 분석하면 항목별 관찰 결과가 여기에 정리됩니다."
            action={
              <button
                className="btn btn-primary btn-sm"
                onClick={onStartScan}
                style={{ width: "auto" }}
              >
                <CameraIcon size={17} />
                스캔하러 가기
              </button>
            }
          />
        </main>
      </>
    );
  }

  const { analysis } = result;
  const partLabel = `${result.hand === "left" ? "왼손" : "오른손"} ${FINGER_LABELS[result.finger]}`;
  const delta = previous
    ? Math.round(
        analysis.observationScore - previous.analysis.observationScore,
      )
    : null;

  async function share() {
    if (sharing || !result) return;
    setSharing(true);
    setShareMessage(null);
    try {
      const blob = await renderShareCard(result.analysis, {
        dateLabel: formatDate(result.createdAt),
        partLabel,
        nickname: settings.nickname,
      });
      const how = await shareOrDownload(
        blob,
        `nailsense-${new Date(result.createdAt).toISOString().slice(0, 10)}.png`,
      );
      setShareMessage(
        how === "downloaded"
          ? "카드 이미지를 내려받았어요."
          : "공유 시트를 열었어요.",
      );
    } catch {
      setShareMessage("카드를 만들지 못했어요. 다시 시도해 주세요.");
    } finally {
      setSharing(false);
    }
  }

  return (
    <>
      <TopBar title="분석 결과" />
      <main className="screen stagger">
        {result.demo && (
          <Notice tone="strong" icon={<SparkIcon size={15} />}>
            데모 모드로 만든 <strong>샘플 결과</strong>입니다. 실제 사진을
            분석한 내용이 아닙니다.
          </Notice>
        )}

        {/* 공유용 카드 미리보기. 실제 공유 이미지는 이 구성을 캔버스로 다시 그린다. */}
        <div className="sharecard mt-12">
          <div className="brand">
            <SparkIcon size={14} />
            NailSense
          </div>
          <div className="headline">{analysis.headline}</div>
          <div className="meta">
            {formatDate(result.createdAt)} · {partLabel}
          </div>

          <div
            className="flex gap-12 mt-16"
            style={{ alignItems: "center" }}
          >
            <ScoreRing score={analysis.observationScore} />
            <div className="flex-1">
              <div style={{ fontWeight: 700, fontSize: 15 }}>관찰 지표</div>
              <div className="small muted mt-8">
                사진 속 겉모습이 얼마나 고르게 보이는지를 나타낸 참고 수치예요.
                건강 점수가 아닙니다.
              </div>
              {delta !== null && (
                <div className="mt-8">
                  <DeltaBadge value={delta} />
                  <span className="small muted"> 지난 같은 부위 기록 대비</span>
                </div>
              )}
            </div>
          </div>

          <div className="grid">
            {analysis.metrics.slice(0, 6).map((metric) => (
              <div className="cell" key={metric.key}>
                <div className="k">{METRIC_LABELS[metric.key]}</div>
                <span className={`pill pill-${metric.status}`}>
                  <span className="dot" />
                  {STATUS_LABELS[metric.status]}
                </span>
              </div>
            ))}
          </div>

          <div className="foot">
            이 카드는 의료 진단이 아닙니다. 사진에 보이는 겉모습만 정리한
            참고용 요약입니다.
          </div>
        </div>

        <div className="btn-row mt-12">
          <button
            className="btn btn-ghost"
            onClick={() => void share()}
            disabled={sharing}
          >
            <ShareIcon size={17} />
            {sharing ? "만드는 중…" : "카드 공유하기"}
          </button>
          <button className="btn btn-secondary" onClick={onGoHistory}>
            기록 보기
          </button>
        </div>

        {shareMessage && (
          <div className="small muted center mt-8">{shareMessage}</div>
        )}
        <div className="small muted center mt-8">
          공유 카드에는 손톱 사진이 들어가지 않고 요약만 담깁니다.
        </div>

        {result.imageUrl && (
          <>
            <div className="section-title">분석한 사진</div>
            <img
              src={result.imageUrl}
              alt="분석에 사용한 손톱 사진"
              style={{
                width: "100%",
                borderRadius: "var(--radius)",
                border: "1px solid var(--line)",
                display: "block",
              }}
            />
          </>
        )}

        <div className="section-title">요약</div>
        <div className="card">
          <p style={{ margin: 0, color: "var(--ink-soft)", lineHeight: 1.7 }}>
            {analysis.summary}
          </p>
          {result.note && (
            <div className="small muted mt-12">내 메모: {result.note}</div>
          )}
        </div>

        <div className="section-title">항목별 관찰</div>
        <MetricList
          metrics={analysis.metrics}
          expandByDefault={settings.expandByDefault}
        />

        <div className="section-title">생활 관리 팁</div>
        <TipList tips={analysis.tips} />
        <div className="small muted mt-8">
          누구에게나 무리 없는 일반적인 관리 방법이에요. 특정 영양제나 치료를
          권하지 않습니다.
        </div>

        <div className="section-title">이럴 땐 전문가에게</div>
        <div className="card">
          <div className="flex gap-12" style={{ alignItems: "flex-start" }}>
            <div className="icon-badge">
              <StethoscopeIcon size={18} />
            </div>
            <ul
              style={{
                margin: 0,
                paddingLeft: 18,
                color: "var(--ink-soft)",
                lineHeight: 1.8,
                fontSize: 14,
              }}
            >
              {analysis.consultSignals.map((signal) => (
                <li key={signal}>{signal}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-16">
          <Notice>{DISCLAIMER_LONG}</Notice>
        </div>

        <button className="btn btn-secondary mt-16" onClick={onStartScan}>
          <CameraIcon size={18} />
          다른 손톱도 스캔하기
        </button>
      </main>
    </>
  );
}

export function DeltaBadge({ value }: { value: number }) {
  if (value === 0) {
    return (
      <span className="delta delta-flat">
        <MinusIcon />
        변화 없음
      </span>
    );
  }
  return value > 0 ? (
    <span className="delta delta-up">
      <ArrowUpIcon />+{value}
    </span>
  ) : (
    <span className="delta delta-down">
      <ArrowDownIcon />
      {value}
    </span>
  );
}
