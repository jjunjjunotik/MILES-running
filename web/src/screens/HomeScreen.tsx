import {
  topAttention,
  type NailRecord,
} from "../../../shared/analysis";
import {
  DISCLAIMER_SHORT,
  FINGER_LABELS,
} from "../labels";
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
import { KO, L } from "../i18n";

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
  const title = KO
    ? `${settings.nickname ? `${settings.nickname}님, ` : ""}오늘 손톱은 어떤 모습인가요?`
    : `${settings.nickname ? `${settings.nickname}, how` : "How"} do your nails look today?`;

  return (
    <>
      <TopBar title="NailSense" brand />
      <main className="screen">
        <section className="page-head">
          <p className="date">{formatToday()}</p>
          <h2>{title}</h2>
          <p className="lede">
            {L("Take one photo and we'll describe how your nail looks, area by area.", "사진 한 장으로 손톱의 겉모습을 항목별로 정리해 드려요.")}
          </p>
        </section>

        {demoMode && (
          <div className="mt-16">
            <Notice tone="accent">
              {KO ? (
                <>
                  지금은 <strong>데모 모드</strong>예요. 서버에 분석 키가 없어서 실제 분석
                  대신 샘플 결과를 보여 드려요.
                </>
              ) : (
                <>
                  You're in <strong>demo mode</strong>. The server has no analysis
                  key, so you'll see sample results instead of a real analysis.
                </>
              )}
            </Notice>
          </div>
        )}

        <div className="home-cta">
          <button className="btn btn-primary" onClick={onStartScan}>
            <CameraIcon size={20} />
            {L("Scan a nail", "손톱 스캔 시작하기")}
          </button>
          <p className="fineprint">
            {DISCLAIMER_SHORT}{" "}
            {L("If a change keeps going, talk to a healthcare professional.", "변화가 이어지면 의료 전문가와 상담하세요.")}
          </p>
        </div>

        <section className="sec">
          <h3 className="sec-title">{L("Latest scan", "최근 관찰")}</h3>
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
              title={L("No scans yet", "아직 기록이 없어요")}
              body={L("Add your first photo to get an area-by-area description and everyday care tips.", "첫 사진을 올리면 항목별 관찰 결과와 생활 관리 팁을 정리해 드려요.")}
            />
          )}
        </section>

        {records.length >= 2 && (
          <section className="sec">
            <h3 className="sec-title">
              {L("Observation index", "관찰 지표 추이")}
              <span className="count">
                {L(`last ${Math.min(records.length, 12)}`, `최근 ${Math.min(records.length, 12)}회`)}
              </span>
            </h3>
            <TrendChart records={records} />
            <div className="trend-foot">
              <button className="link" onClick={onGoHistory}>
                <HistoryIcon size={17} />
                {L("See all history", "전체 기록 보기")}
              </button>
            </div>
          </section>
        )}

        <section className="sec">
          <h3 className="sec-title">{L("Nail health guides", "손톱 건강 정보")}</h3>
          <ul className="list">
            <li>
              <button className="row" onClick={onGoLibrary}>
                <div className="row-main">
                  <div className="row-title">
                    {L("What to look for, and when to see a doctor", "무엇을 보고, 언제 진료를 생각할까")}
                  </div>
                  <div className="row-sub">
                    {L(
                      "Plain guides on nail care, common changes and the signs that need a professional.",
                      "손톱 관리, 흔한 변화, 상담이 필요한 신호를 일반 정보로 정리했어요.",
                    )}
                  </div>
                </div>
                <ChevronIcon size={18} className="chev" />
              </button>
            </li>
          </ul>
        </section>

        <section className="sec">
          <h3 className="sec-title">{L("Your photos", "사진은 이렇게 다뤄요")}</h3>
          <ul className="list">
            <li className="row">
              <div className="row-main">
                <div className="row-title">{L("Photos stay on this device", "사진은 이 기기에만 남아요")}</div>
                <div className="row-sub">
                  {signedIn
                    ? L("They pass through our server only for analysis and are never stored there. Your account keeps only the results.", "분석할 때만 서버를 거치고 서버에는 보관하지 않아요. 계정에는 분석 결과만 저장돼요.")
                    : L("They pass through our server only for analysis and are never stored there. Right now your results are saved on this device too.", "분석할 때만 서버를 거치고 서버에는 보관하지 않아요. 지금은 분석 결과도 이 기기에만 저장돼요.")}
                </div>
              </div>
            </li>
            <li className="row">
              <div className="row-main">
                <div className="row-title">{L("Delete anytime", "언제든 지울 수 있어요")}</div>
                <div className="row-sub">
                  {L("In Profile you can delete just the photos, or all your history at once.", "프로필에서 사진만, 또는 기록 전체를 한 번에 지울 수 있어요.")}
                </div>
              </div>
            </li>
          </ul>
        </section>
      </main>
    </>
  );
}
