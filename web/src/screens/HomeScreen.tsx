import {
  DISCLAIMER_SHORT,
  FINGER_LABELS,
  topAttention,
  type NailRecord,
} from "../../../shared/analysis";
import type { Settings } from "../lib/storage";
import { CameraIcon, ChevronIcon, HistoryIcon } from "../components/Icons";
import {
  AttentionTag,
  Empty,
  Notice,
  TopBar,
  formatRelative,
  formatToday,
  partLabel,
} from "../components/ui";
import { TrendChart } from "../components/TrendChart";
import { Thumb } from "../components/Thumb";

export function HomeScreen({
  records,
  settings,
  demoMode,
  signedIn = false,
  onStartScan,
  onOpenRecord,
  onGoHistory,
  onGoLibrary,
}: {
  records: NailRecord[];
  settings: Settings;
  demoMode: boolean;
  /** 로그인했는지에 따라 기록이 어디에 저장되는지 설명이 달라진다. */
  signedIn?: boolean;
  onStartScan: () => void;
  onOpenRecord: (record: NailRecord) => void;
  onGoHistory: () => void;
  onGoLibrary: () => void;
}) {
  const latest = records[0];
  const latestAttention = topAttention(latest?.analysis.findings);
  const greeting = settings.nickname ? `${settings.nickname}, how` : "How";

  return (
    <>
      <TopBar title="NailSense" brand />
      <main className="screen">
        <section className="page-head">
          <p className="date">{formatToday()}</p>
          <h2>{greeting} do your nails look today?</h2>
          <p className="lede">
            Take one photo and we'll describe how your nail looks, area by area.
          </p>
        </section>

        {demoMode && (
          <div className="mt-16">
            <Notice tone="accent">
              You're in <strong>demo mode</strong>. The server has no analysis
              key, so you'll see sample results instead of a real analysis.
            </Notice>
          </div>
        )}

        <div className="home-cta">
          <button className="btn btn-primary" onClick={onStartScan}>
            <CameraIcon size={20} />
            Scan a nail
          </button>
          <p className="fineprint">
            {DISCLAIMER_SHORT} If a change keeps going, talk to a healthcare professional.
          </p>
        </div>

        <section className="sec">
          <h3 className="sec-title">Latest scan</h3>
          {latest ? (
            <button className="entry" onClick={() => onOpenRecord(latest)}>
              <Thumb record={latest} />
              <div style={{ minWidth: 0 }}>
                <div className="entry-title">{latest.analysis.headline}</div>
                <div className="entry-meta">
                  {formatRelative(latest.createdAt)},{" "}
                  {partLabel(latest.hand, FINGER_LABELS[latest.finger])}
                </div>
                {latestAttention && (
                  <div className="tags">
                    <AttentionTag attention={latestAttention} />
                  </div>
                )}
              </div>
              <ChevronIcon size={18} className="chev" />
            </button>
          ) : (
            <Empty
              icon={<CameraIcon size={26} />}
              title="No scans yet"
              body="Add your first photo to get an area-by-area description and everyday care tips."
            />
          )}
        </section>

        {records.length >= 2 && (
          <section className="sec">
            <h3 className="sec-title">
              Observation index
              <span className="count">last {Math.min(records.length, 12)}</span>
            </h3>
            <TrendChart records={records} />
            <div className="trend-foot">
              <button className="link" onClick={onGoHistory}>
                <HistoryIcon size={17} />
                See all history
              </button>
            </div>
          </section>
        )}

        <section className="sec">
          <h3 className="sec-title">Nail health guides</h3>
          <ul className="list">
            <li>
              <button className="row" onClick={onGoLibrary}>
                <div className="row-main">
                  <div className="row-title">
                    What to look for, and when to see a doctor
                  </div>
                  <div className="row-sub">
                    Plain guides on nail care, common changes and the signs that
                    need a professional.
                  </div>
                </div>
                <ChevronIcon size={18} className="chev" />
              </button>
            </li>
          </ul>
        </section>

        <section className="sec">
          <h3 className="sec-title">Your photos</h3>
          <ul className="list">
            <li className="row">
              <div className="row-main">
                <div className="row-title">Photos stay on this device</div>
                <div className="row-sub">
                  {signedIn
                    ? "They pass through our server only for analysis and are never stored there. Your account keeps only the results."
                    : "They pass through our server only for analysis and are never stored there. Right now your results are saved on this device too."}
                </div>
              </div>
            </li>
            <li className="row">
              <div className="row-main">
                <div className="row-title">Delete anytime</div>
                <div className="row-sub">
                  In Profile you can delete just the photos, or all your history at once.
                </div>
              </div>
            </li>
          </ul>
        </section>
      </main>
    </>
  );
}
