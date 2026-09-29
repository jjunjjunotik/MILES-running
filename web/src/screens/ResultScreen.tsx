import { useEffect, useMemo, useRef, useState } from "react";
import {
  DISCLAIMER_LONG,
  FINGER_LABELS,
  METRIC_LABELS,
  STATUS_LABELS,
  topAttention,
  type NailRecord,
} from "../../../shared/analysis";
import type { ResultView } from "../App";
import type { Settings } from "../lib/storage";
import { renderShareCard, shareOrDownload } from "../lib/share";
import { FindingList } from "../components/FindingList";
import { MetricList } from "../components/MetricList";
import { TipList } from "../components/TipList";
import {
  BackIcon,
  CameraIcon,
  DownloadIcon,
  LibraryIcon,
  ShareIcon,
  StethoscopeIcon,
} from "../components/Icons";
import {
  Delta,
  Empty,
  Notice,
  Reading,
  STATUS_TONE,
  Sheet,
  ToneIcon,
  TopBar,
  formatDate,
  partLabel,
} from "../components/ui";

export function ResultScreen({
  result,
  settings,
  records,
  onStartScan,
  onGoHistory,
  onClose,
}: {
  result: ResultView | null;
  settings: Settings;
  records: NailRecord[];
  onStartScan: () => void;
  onGoHistory: () => void;
  onClose?: () => void;
}) {
  const [sharing, setSharing] = useState(false);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [cardUrl, setCardUrl] = useState<string | null>(null);
  const cardBlob = useRef<Blob | null>(null);

  // 카드 미리보기용 blob URL 은 시트를 닫을 때 함께 해제한다.
  useEffect(
    () => () => {
      if (cardUrl) URL.revokeObjectURL(cardUrl);
    },
    [cardUrl],
  );

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
            icon={<LibraryIcon size={26} />}
            title="아직 볼 결과가 없어요"
            body="손톱 사진을 한 장 분석하면 항목별 관찰 결과가 여기에 정리돼요."
            action={
              <button className="btn btn-primary btn-sm" onClick={onStartScan}>
                <CameraIcon size={18} />
                스캔하러 가기
              </button>
            }
          />
        </main>
      </>
    );
  }

  const { analysis } = result;
  // 이전 버전에서 저장된 기록에는 findings 가 없다.
  const findings = analysis.findings ?? [];
  const attention = topAttention(findings);
  const part = partLabel(result.hand, FINGER_LABELS[result.finger]);
  const delta = previous
    ? Math.round(
        analysis.observationScore - previous.analysis.observationScore,
      )
    : null;

  const cardFilename = `nailsense-${new Date(result.createdAt)
    .toISOString()
    .slice(0, 10)}.png`;

  /** 카드를 그려 미리보기 시트로 먼저 보여 준다. 저장은 사용자가 고른다. */
  async function buildCard() {
    if (sharing || !result) return;
    setSharing(true);
    setShareMessage(null);
    try {
      const blob = await renderShareCard(result.analysis, {
        dateLabel: formatDate(result.createdAt),
        partLabel: part,
        nickname: settings.nickname,
      });
      cardBlob.current = blob;
      setCardUrl(URL.createObjectURL(blob));
    } catch {
      setShareMessage("카드를 만들지 못했어요. 다시 시도해 주세요.");
    } finally {
      setSharing(false);
    }
  }

  async function saveCard() {
    if (!cardBlob.current) return;
    try {
      const how = await shareOrDownload(cardBlob.current, cardFilename);
      if (how === "declined") {
        setShareMessage(null);
        return;
      }
      setShareMessage(
        how === "downloaded"
          ? "카드 이미지를 저장했어요."
          : "공유 시트를 열었어요.",
      );
    } catch {
      setShareMessage(
        "이 환경에서는 바로 저장할 수 없어요. 이미지를 길게 눌러 저장해 주세요.",
      );
    }
  }

  return (
    <>
      <TopBar
        title="분석 결과"
        left={
          onClose ? (
            <button className="icon-btn" onClick={onClose} aria-label="닫기">
              <BackIcon size={22} />
            </button>
          ) : undefined
        }
      />
      <main className="screen">
        {result.demo && (
          <div className="mt-8">
            <Notice tone="accent">
              데모 모드로 만든 <strong>샘플 결과</strong>예요. 실제 사진을
              분석한 내용이 아니에요.
            </Notice>
          </div>
        )}

        {attention === "soon" && (
          <div className="refer mt-12" role="note">
            <StethoscopeIcon size={20} />
            <div>
              <div className="t">진료를 미루지 않는 편이 좋아요</div>
              <div className="b">
                아래 특이 사항에서 눈여겨보는 신호가 보였어요. 사진으로는 그
                이상을 가릴 수 없으니 피부과에서 직접 보여 주세요. 확정된 진단이
                아니라 확인이 필요하다는 뜻이에요.
              </div>
            </div>
          </div>
        )}

        <header className="result-head mt-12">
          {result.imageUrl && (
            <img
              className="photo"
              src={result.imageUrl}
              alt="분석에 사용한 손톱 사진"
            />
          )}
          <div>
            <p className="result-meta">
              {formatDate(result.createdAt)}, {part}
            </p>
            <h2 className="result-title">{analysis.headline}</h2>
          </div>
          <p className="result-summary">{analysis.summary}</p>
          {result.note && <p className="memo">내 메모: {result.note}</p>}
        </header>

        <section className="sec">
          <h3 className="sec-title">한눈에 보기</h3>
          <dl className="glance">
            {analysis.metrics.slice(0, 6).map((metric) => {
              const tone = STATUS_TONE[metric.status];
              return (
                <div key={metric.key} className={`tone-${tone}`}>
                  <dt>{METRIC_LABELS[metric.key]}</dt>
                  <dd>
                    <ToneIcon tone={tone} size={15} />
                    {STATUS_LABELS[metric.status]}
                  </dd>
                </div>
              );
            })}
          </dl>

          <div className="index">
            <div className="index-row">
              <span className="index-label">관찰 지표</span>
              <Reading value={analysis.observationScore} />
            </div>
            <p className="index-note">
              {delta !== null && (
                <>
                  <Delta value={delta} />
                  지난번 같은 부위 기록과 비교한 변화예요.{" "}
                </>
              )}
              사진 속 겉모습이 얼마나 고르게 보이는지 나타낸 참고 수치예요.
              건강 점수가 아니에요.
            </p>
          </div>

          <div className="btn-row result-actions">
            <button
              className="btn btn-secondary"
              onClick={() => void buildCard()}
              disabled={sharing}
            >
              <ShareIcon size={18} />
              {sharing ? "만드는 중" : "카드 공유하기"}
            </button>
            <button className="btn btn-secondary" onClick={onGoHistory}>
              기록 보기
            </button>
          </div>
          {shareMessage && (
            <p className="fineprint" role="status">
              {shareMessage}
            </p>
          )}
          <p className="fineprint">
            공유 카드에는 손톱 사진이 들어가지 않고 요약만 담겨요.
          </p>
        </section>

        <section className="sec">
          <h3 className="sec-title">
            특이 사항
            {findings.length > 0 && (
              <span className="count">{findings.length}건</span>
            )}
          </h3>
          <FindingList findings={findings} />
          {findings.length > 0 && (
            <p className="fineprint">
              상태 이름은 이런 모습에서 함께 검토되는 것들을 나열한 목록이고,
              그중 하나로 확정한 것이 아니에요. 사진으로는 가릴 수 없어서
              진료실에서 확대경이나 검사로 확인해요.
            </p>
          )}
        </section>

        <section className="sec">
          <h3 className="sec-title">항목별 관찰</h3>
          <MetricList
            metrics={analysis.metrics}
            expandByDefault={settings.expandByDefault}
          />
        </section>

        <section className="sec">
          <h3 className="sec-title">생활 관리 팁</h3>
          <TipList tips={analysis.tips} />
          <p className="fineprint">
            누구에게나 무리 없는 일반적인 관리 방법이에요. 특정 영양제나 치료를
            권하지 않아요.
          </p>
        </section>

        <section className="sec">
          <h3 className="sec-title">이럴 땐 전문가에게</h3>
          <ul className="consult-list">
            {analysis.consultSignals.map((signal) => (
              <li key={signal}>{signal}</li>
            ))}
          </ul>
        </section>

        <p className="fineprint-block">{DISCLAIMER_LONG}</p>

        <button className="btn btn-secondary mt-24" onClick={onStartScan}>
          <CameraIcon size={19} />
          다른 손톱도 스캔하기
        </button>
      </main>

      {cardUrl && (
        <Sheet label="공유 카드" onClose={() => setCardUrl(null)}>
          <h3>공유 카드</h3>
          <img
            className="preview"
            src={cardUrl}
            alt="공유용 요약 카드 미리보기"
          />
          <div className="btn-row mt-16">
            <button
              className="btn btn-secondary"
              onClick={() => setCardUrl(null)}
            >
              닫기
            </button>
            <button className="btn btn-primary" onClick={() => void saveCard()}>
              <DownloadIcon size={18} />
              저장 · 공유
            </button>
          </div>
          <p className="fineprint">이미지를 길게 눌러 저장할 수도 있어요.</p>
        </Sheet>
      )}
    </>
  );
}
