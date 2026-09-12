import {
  DISCLAIMER_SHORT,
  FINGER_LABELS,
  type NailRecord,
} from "../../../shared/analysis";
import type { Settings } from "../lib/storage";
import {
  CameraIcon,
  ChevronIcon,
  HistoryIcon,
  ShieldIcon,
  SparkIcon,
  TrendIcon,
} from "../components/Icons";
import { Empty, Notice, TopBar, formatRelative } from "../components/ui";
import { TrendChart } from "../components/TrendChart";

export function HomeScreen({
  records,
  settings,
  demoMode,
  onStartScan,
  onOpenRecord,
  onGoHistory,
}: {
  records: NailRecord[];
  settings: Settings;
  demoMode: boolean;
  onStartScan: () => void;
  onOpenRecord: (record: NailRecord) => void;
  onGoHistory: () => void;
}) {
  const latest = records[0];
  const greeting = settings.nickname ? `${settings.nickname}님, ` : "";

  return (
    <>
      <TopBar title="NailSense" />
      <main className="screen stagger">
        <section>
          <h2
            style={{
              margin: "4px 0 6px",
              fontSize: 24,
              letterSpacing: "-0.03em",
              lineHeight: 1.35,
            }}
          >
            {greeting}오늘 손톱은
            <br />
            어떤 모습인가요?
          </h2>
          <p className="muted small" style={{ margin: "0 0 18px" }}>
            사진 한 장으로 손톱의 겉모습을 차분히 정리해 드릴게요.
          </p>
        </section>

        {demoMode && (
          <Notice tone="strong" icon={<SparkIcon size={15} />}>
            지금은 <strong>데모 모드</strong>입니다. 서버에 API 키가 없어 실제
            분석 대신 샘플 결과가 표시됩니다.
          </Notice>
        )}

        <button className="btn btn-primary mt-12" onClick={onStartScan}>
          <CameraIcon size={19} />
          손톱 스캔 시작하기
        </button>

        <Notice>
          {DISCLAIMER_SHORT} 결과는 참고용이며, 변화가 이어지면 의료 전문가와
          상담하세요.
        </Notice>

        {latest ? (
          <>
            <div className="section-title">최근 관찰</div>
            <button
              className="card"
              style={{ width: "100%", textAlign: "left" }}
              onClick={() => onOpenRecord(latest)}
            >
              <div className="flex gap-12">
                <div
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 16,
                    background: "var(--accent-soft)",
                    color: "var(--accent)",
                    display: "grid",
                    placeItems: "center",
                    flex: "none",
                    fontWeight: 700,
                    fontSize: 18,
                  }}
                >
                  {Math.round(latest.analysis.observationScore)}
                </div>
                <div className="flex-1">
                  <div style={{ fontWeight: 600, fontSize: 15 }}>
                    {latest.analysis.headline}
                  </div>
                  <div className="small muted mt-8">
                    {formatRelative(latest.createdAt)} ·{" "}
                    {latest.hand === "left" ? "왼손" : "오른손"}{" "}
                    {FINGER_LABELS[latest.finger]}
                  </div>
                </div>
                <ChevronIcon />
              </div>
            </button>
          </>
        ) : (
          <Empty
            icon={<CameraIcon size={24} />}
            title="아직 기록이 없어요"
            body="첫 사진을 올리면 항목별 관찰 결과와 생활 관리 팁을 정리해 드려요."
          />
        )}

        {records.length >= 2 && (
          <>
            <div className="section-title">관찰 지표 추이</div>
            <div className="card">
              <div className="flex gap-8" style={{ marginBottom: 6 }}>
                <TrendIcon size={16} />
                <span style={{ fontWeight: 600, fontSize: 14 }}>
                  최근 {Math.min(records.length, 12)}회 기록
                </span>
              </div>
              <TrendChart records={records} />
              <button
                className="btn btn-secondary btn-sm mt-8"
                onClick={onGoHistory}
                style={{ width: "100%" }}
              >
                <HistoryIcon size={16} />
                전체 기록 보기
              </button>
            </div>
          </>
        )}

        <div className="section-title">사진은 이렇게 다뤄요</div>
        <div className="card">
          <PrivacyRow
            title="사진은 기기 안에 남습니다"
            body="분석 기록과 사진은 이 브라우저 저장소에만 저장되고 서버에는 보관되지 않습니다."
          />
          <PrivacyRow
            title="위치 정보는 지워집니다"
            body="업로드 전에 사진을 다시 인코딩해 촬영 위치·기기 정보 같은 메타데이터를 제거합니다."
          />
          <PrivacyRow
            title="언제든 지울 수 있습니다"
            body="프로필 화면에서 사진만, 또는 전체 기록을 한 번에 삭제할 수 있습니다."
          />
        </div>
      </main>
    </>
  );
}

function PrivacyRow({ title, body }: { title: string; body: string }) {
  return (
    <div className="tip">
      <div className="ico">
        <ShieldIcon size={17} />
      </div>
      <div className="flex-1">
        <div className="t">{title}</div>
        <div className="d">{body}</div>
      </div>
    </div>
  );
}
