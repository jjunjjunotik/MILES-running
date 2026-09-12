import { useState } from "react";
import {
  DISCLAIMER_LONG,
  type NailRecord,
} from "../../../shared/analysis";
import {
  clearAll,
  clearImagesOnly,
  type Settings,
} from "../lib/storage";
import {
  InfoIcon,
  ShieldIcon,
  SparkIcon,
  StethoscopeIcon,
  TrashIcon,
} from "../components/Icons";
import { Notice, Sheet, TopBar } from "../components/ui";

type PendingAction = "photos" | "all" | null;

export function ProfileScreen({
  settings,
  records,
  demoMode,
  onChangeSettings,
  onChanged,
}: {
  settings: Settings;
  records: NailRecord[];
  demoMode: boolean;
  onChangeSettings: (settings: Settings) => void;
  onChanged: () => Promise<void> | void;
}) {
  const [pending, setPending] = useState<PendingAction>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const photoCount = records.filter((record) => record.hasImage).length;

  async function run(action: Exclude<PendingAction, null>) {
    setBusy(true);
    try {
      if (action === "photos") {
        await clearImagesOnly();
        setDone("저장된 사진을 모두 지웠어요. 분석 기록은 그대로 있어요.");
      } else {
        await clearAll();
        setDone("모든 기록과 사진을 지웠어요.");
      }
      await onChanged();
    } catch {
      setDone("삭제하지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  return (
    <>
      <TopBar title="프로필" />
      <main className="screen stagger">
        <div className="card">
          <label
            className="small muted"
            style={{ display: "block", marginBottom: 6 }}
            htmlFor="nickname"
          >
            어떻게 불러 드릴까요? (선택)
          </label>
          <input
            id="nickname"
            className="field"
            maxLength={12}
            placeholder="닉네임"
            value={settings.nickname}
            onChange={(event) =>
              onChangeSettings({ ...settings, nickname: event.target.value })
            }
          />
          <div className="small muted mt-8">
            이 이름은 기기에만 저장되고 서버로 보내지 않습니다.
          </div>
        </div>

        <div className="section-title">기록 요약</div>
        <div className="card">
          <div className="row">
            <div className="flex-1">
              <div className="label">분석 기록</div>
              <div className="sub">지금까지 저장된 관찰 결과</div>
            </div>
            <span className="pill pill-accent">{records.length}건</span>
          </div>
          <div className="row">
            <div className="flex-1">
              <div className="label">저장된 사진</div>
              <div className="sub">이 기기 안에만 보관됩니다</div>
            </div>
            <span className="pill pill-neutral">{photoCount}장</span>
          </div>
        </div>

        <div className="section-title">설정</div>
        <div className="card">
          <ToggleRow
            label="분석한 사진 저장하기"
            sub="끄면 결과만 남고 사진은 기기에 저장되지 않습니다."
            on={settings.keepPhotos}
            onToggle={() =>
              onChangeSettings({
                ...settings,
                keepPhotos: !settings.keepPhotos,
              })
            }
          />
          <ToggleRow
            label="결과 항목 펼쳐 보기"
            sub="결과 화면에서 항목 설명을 처음부터 펼쳐 둡니다."
            on={settings.expandByDefault}
            onToggle={() =>
              onChangeSettings({
                ...settings,
                expandByDefault: !settings.expandByDefault,
              })
            }
          />
        </div>

        <div className="section-title">내 데이터</div>
        <div className="card">
          <button className="row" onClick={() => setPending("photos")}>
            <div className="icon-badge">
              <TrashIcon size={16} />
            </div>
            <div className="flex-1">
              <div className="label">사진만 삭제</div>
              <div className="sub">분석 기록은 남기고 사진만 지웁니다</div>
            </div>
          </button>
          <button className="row" onClick={() => setPending("all")}>
            <div
              className="icon-badge"
              style={{
                background: "var(--consult-soft)",
                color: "var(--consult)",
              }}
            >
              <TrashIcon size={16} />
            </div>
            <div className="flex-1">
              <div className="label">전체 기록 삭제</div>
              <div className="sub">모든 분석 결과와 사진을 지웁니다</div>
            </div>
          </button>
        </div>

        {done && (
          <div className="mt-12">
            <Notice>{done}</Notice>
          </div>
        )}

        <div className="section-title">개인정보 처리</div>
        <div className="card">
          <InfoRow
            icon={<ShieldIcon size={17} />}
            title="계정도, 서버 저장도 없습니다"
            body="로그인이 없고, 분석 기록과 사진은 이 브라우저 저장소에만 남습니다. 서버는 분석 요청을 중계할 뿐 사진을 보관하거나 기록하지 않습니다."
          />
          <InfoRow
            icon={<ShieldIcon size={17} />}
            title="메타데이터를 지우고 보냅니다"
            body="업로드 전에 사진을 다시 인코딩해 촬영 위치·기기·시각 정보를 제거하고, 긴 변을 1280px 이하로 줄여 전송합니다."
          />
          <InfoRow
            icon={<ShieldIcon size={17} />}
            title="API 키는 서버에만 있습니다"
            body="분석에 쓰는 키는 서버 환경변수에만 두고 브라우저로 내려보내지 않습니다."
          />
        </div>

        <div className="section-title">이 앱에 대해</div>
        <div className="card">
          <InfoRow
            icon={<StethoscopeIcon size={17} />}
            title="진단하지 않습니다"
            body={DISCLAIMER_LONG}
          />
          <InfoRow
            icon={<InfoIcon size={17} />}
            title="관찰 지표는 무엇인가요?"
            body="사진 속 손톱 겉모습이 얼마나 고르게 보이는지를 0~100으로 나타낸 참고 수치입니다. 의학적 지표가 아니며, 같은 환경에서 찍은 사진끼리 변화를 비교할 때만 의미가 있습니다."
          />
          <InfoRow
            icon={<SparkIcon size={17} />}
            title="분석은 어떻게 이뤄지나요?"
            body={
              demoMode
                ? "현재 서버에 API 키가 없어 데모 모드로 동작 중입니다. 실제 분석 대신 샘플 결과가 표시됩니다."
                : "사진은 서버를 거쳐 Claude 비전 모델에 전달되고, 정해진 6개 항목의 관찰 결과만 구조화된 형식으로 돌려받습니다."
            }
          />
        </div>

        <div className="small muted center mt-24">NailSense · 참고용 도구</div>
      </main>

      {pending && (
        <Sheet onClose={() => !busy && setPending(null)}>
          <h3 style={{ margin: "0 0 6px", fontSize: 17 }}>
            {pending === "photos"
              ? "저장된 사진을 모두 지울까요?"
              : "모든 기록을 지울까요?"}
          </h3>
          <p className="small muted" style={{ marginTop: 0 }}>
            {pending === "photos"
              ? `이 기기에 저장된 사진 ${photoCount}장이 삭제됩니다. 분석 결과는 그대로 남습니다.`
              : `분석 기록 ${records.length}건과 사진이 모두 삭제됩니다. 되돌릴 수 없어요.`}
          </p>
          <div className="btn-row mt-16">
            <button
              className="btn btn-secondary"
              onClick={() => setPending(null)}
              disabled={busy}
            >
              취소
            </button>
            <button
              className="btn btn-primary"
              style={{ background: "var(--consult)", boxShadow: "none" }}
              disabled={busy}
              onClick={() => void run(pending)}
            >
              삭제
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}

function ToggleRow({
  label,
  sub,
  on,
  onToggle,
}: {
  label: string;
  sub: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      className="row"
      onClick={onToggle}
      role="switch"
      aria-checked={on}
      aria-label={label}
    >
      <div className="flex-1">
        <div className="label">{label}</div>
        <div className="sub">{sub}</div>
      </div>
      <span className={`switch${on ? " on" : ""}`} />
    </button>
  );
}

function InfoRow({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="tip">
      <div className="ico">{icon}</div>
      <div className="flex-1">
        <div className="t">{title}</div>
        <div className="d">{body}</div>
      </div>
    </div>
  );
}
