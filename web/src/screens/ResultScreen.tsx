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
        <TopBar title="Result" />
        <main className="screen">
          <Empty
            icon={<LibraryIcon size={26} />}
            title="No result yet"
            body="Analyze a nail photo and the area-by-area result will show up here."
            action={
              <button className="btn btn-primary btn-sm" onClick={onStartScan}>
                <CameraIcon size={18} />
                Scan a nail
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
      setShareMessage("We couldn't make the card. Please try again.");
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
          ? "Card image saved."
          : "Share sheet opened.",
      );
    } catch {
      setShareMessage(
        "Saving isn't available here. Press and hold the image to save it.",
      );
    }
  }

  return (
    <>
      <TopBar
        title="Result"
        left={
          onClose ? (
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              <BackIcon size={22} />
            </button>
          ) : undefined
        }
      />
      <main className="screen">
        {result.demo && (
          <div className="mt-8">
            <Notice tone="accent">
              This is a <strong>sample result</strong> from demo mode, not an
              analysis of your photo.
            </Notice>
          </div>
        )}

        {attention === "soon" && (
          <div className="refer mt-12" role="note">
            <StethoscopeIcon size={20} />
            <div>
              <div className="t">Don't put off seeing a doctor</div>
              <div className="b">
                A warning sign showed up in the findings below. A photo can't
                tell more than that, so show it to a dermatologist in person.
                This isn't a diagnosis; it means it needs to be checked.
              </div>
            </div>
          </div>
        )}

        <header className="result-head mt-12">
          {result.imageUrl && (
            <img
              className="photo"
              src={result.imageUrl}
              alt="The nail photo that was analyzed"
            />
          )}
          <div>
            <p className="result-meta">
              {formatDate(result.createdAt)}, {part}
            </p>
            <h2 className="result-title">{analysis.headline}</h2>
          </div>
          <p className="result-summary">{analysis.summary}</p>
          {result.note && <p className="memo">Your note: {result.note}</p>}
        </header>

        <section className="sec">
          <h3 className="sec-title">At a glance</h3>
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
              <span className="index-label">Observation index</span>
              <Reading value={analysis.observationScore} />
            </div>
            <p className="index-note">
              {delta !== null && (
                <>
                  <Delta value={delta} />
                  Change since your last photo of this nail.{" "}
                </>
              )}
              A reference number for how even the nail looks in the photo. It
              is not a health score.
            </p>
          </div>

          <div className="btn-row result-actions">
            <button
              className="btn btn-secondary"
              onClick={() => void buildCard()}
              disabled={sharing}
            >
              <ShareIcon size={18} />
              {sharing ? "Making card" : "Share card"}
            </button>
            <button className="btn btn-secondary" onClick={onGoHistory}>
              View history
            </button>
          </div>
          {shareMessage && (
            <p className="fineprint" role="status">
              {shareMessage}
            </p>
          )}
          <p className="fineprint">
            The share card has a summary only, never your photo.
          </p>
        </section>

        <section className="sec">
          <h3 className="sec-title">
            Findings
            {findings.length > 0 && (
              <span className="count">{findings.length}</span>
            )}
          </h3>
          <FindingList findings={findings} />
          {findings.length > 0 && (
            <p className="fineprint">
              The condition names are things usually considered for a look like
              this, not a conclusion about any one of them. A photo can't tell
              them apart; a clinic checks with magnification or tests.
            </p>
          )}
        </section>

        <section className="sec">
          <h3 className="sec-title">By area</h3>
          <MetricList
            metrics={analysis.metrics}
            expandByDefault={settings.expandByDefault}
          />
        </section>

        <section className="sec">
          <h3 className="sec-title">Everyday care tips</h3>
          <TipList tips={analysis.tips} />
          <p className="fineprint">
            General care that suits most people. We don't recommend specific
            supplements or treatments.
          </p>
        </section>

        <section className="sec">
          <h3 className="sec-title">When to see a professional</h3>
          <ul className="consult-list">
            {analysis.consultSignals.map((signal) => (
              <li key={signal}>{signal}</li>
            ))}
          </ul>
        </section>

        <p className="fineprint-block">{DISCLAIMER_LONG}</p>

        <button className="btn btn-secondary mt-24" onClick={onStartScan}>
          <CameraIcon size={19} />
          Scan another nail
        </button>
      </main>

      {cardUrl && (
        <Sheet label="Share card" onClose={() => setCardUrl(null)}>
          <h3>Share card</h3>
          <img
            className="preview"
            src={cardUrl}
            alt="Preview of the summary share card"
          />
          <div className="btn-row mt-16">
            <button
              className="btn btn-secondary"
              onClick={() => setCardUrl(null)}
            >
              Close
            </button>
            <button className="btn btn-primary" onClick={() => void saveCard()}>
              <DownloadIcon size={18} />
              Save or share
            </button>
          </div>
          <p className="fineprint">You can also press and hold the image to save it.</p>
        </Sheet>
      )}
    </>
  );
}
