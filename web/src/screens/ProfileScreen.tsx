import { useEffect, useState } from "react";
import {
  DISCLAIMER_LONG,
  type NailRecord,
} from "../../../shared/analysis";
import {
  clearImagesOnly,
  clearScopedImages,
  listRecords,
  type Settings,
} from "../lib/storage";
import { STANDALONE_DEMO } from "../lib/api";
import {
  ServerError,
  clearServerImages,
  deleteAccount,
  importScans,
  type AuthUser,
} from "../lib/server";
import {
  InfoIcon,
  ProfileIcon,
  ShieldIcon,
  SparkIcon,
  StethoscopeIcon,
  TrashIcon,
} from "../components/Icons";
import { Notice, Sheet, TopBar } from "../components/ui";

type PendingAction = "photos" | "all" | "account" | null;

export const APP_VERSION = "1.0.0";

export function ProfileScreen({
  user,
  settings,
  records,
  demoMode,
  provider,
  onChangeSettings,
  onChanged,
  onDeleteAll,
  onSignOut,
  onSignIn,
}: {
  user: AuthUser | null;
  settings: Settings;
  records: NailRecord[];
  demoMode: boolean;
  provider: string | null;
  onChangeSettings: (settings: Settings) => void;
  onChanged: () => Promise<void> | void;
  onDeleteAll: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onSignIn?: () => void;
}) {
  const [pending, setPending] = useState<PendingAction>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** 계정을 만들기 전에 이 기기에 쌓여 있던 기록. 있으면 가져올 수 있게 안내한다. */
  const [localCount, setLocalCount] = useState(0);

  const photoCount = records.filter((record) => record.hasImage).length;

  useEffect(() => {
    if (STANDALONE_DEMO || !user) return;
    void listRecords()
      .then((found) => setLocalCount(found.length))
      .catch(() => setLocalCount(0));
  }, [user]);

  async function importLocal() {
    setBusy(true);
    try {
      const found = await listRecords();
      const imported = await importScans(found);
      setDone(
        imported > 0
          ? `이 기기에 있던 기록 ${imported}건을 계정으로 가져왔어요.`
          : "가져올 새 기록이 없었어요.",
      );
      setLocalCount(0);
      await onChanged();
    } catch (err) {
      setDone(
        err instanceof ServerError ? err.message : "기록을 가져오지 못했어요.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function run(action: Exclude<PendingAction, null>) {
    setBusy(true);
    setError(null);
    try {
      if (action === "photos") {
        if (STANDALONE_DEMO || !user) {
          await clearImagesOnly();
        } else {
          // 사진은 기기에서 지우고, 서버에는 "사진 없음"으로 표시만 남긴다.
          await clearScopedImages();
          await clearServerImages();
        }
        setDone("저장된 사진을 모두 지웠어요. 분석 기록은 그대로 있어요.");
        await onChanged();
      } else if (action === "all") {
        await clearScopedImages();
        await onDeleteAll();
        setDone("모든 기록과 사진을 지웠어요.");
      } else {
        // 비밀번호가 없는 소셜 계정은 이메일을 그대로 적어 확인한다.
        await deleteAccount(
          user?.hasPassword ? { password } : { confirmEmail: password },
        );
        await clearScopedImages();
        setPassword("");
        await onSignOut();
        return;
      }
    } catch (err) {
      if (action === "account") {
        setError(
          err instanceof ServerError
            ? err.message
            : "계정을 삭제하지 못했어요.",
        );
        setBusy(false);
        return;
      }
      setDone("삭제하지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
      if (action !== "account") setPending(null);
    }
  }

  return (
    <>
      <TopBar title="프로필" />
      <main className="screen stagger">
        {user && (
          <div className="card account-card">
            <div className="icon-badge">
              <ProfileIcon size={18} />
            </div>
            <div className="flex-1">
              <div className="label">{user.displayName || "이름 없음"}</div>
              <div className="sub">{user.email}</div>
            </div>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => void onSignOut()}
            >
              로그아웃
            </button>
          </div>
        )}

        {!user && !STANDALONE_DEMO && (
          <div className="card account-card">
            <div className="icon-badge">
              <ProfileIcon size={18} />
            </div>
            <div className="flex-1">
              <div className="label">이 기기에 저장 중</div>
              <div className="sub">
                계정을 만들면 다른 기기에서도 기록을 볼 수 있어요
              </div>
            </div>
            {onSignIn && (
              <button
                className="btn btn-ghost btn-sm signin-btn"
                onClick={onSignIn}
                aria-label="로그인 또는 계정 만들기"
              >
                로그인
              </button>
            )}
          </div>
        )}

        {localCount > 0 && (
          <div className="card mt-12">
            <div className="label">이 기기에 남아 있는 기록 {localCount}건</div>
            <div className="sub mt-8">
              계정을 만들기 전에 저장한 기록이에요. 계정으로 가져오면 다른 기기에서도
              볼 수 있어요.
            </div>
            <button
              className="btn btn-ghost btn-sm mt-12"
              onClick={() => void importLocal()}
              disabled={busy}
            >
              계정으로 가져오기
            </button>
          </div>
        )}

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
            결과 화면과 공유 카드에 표시됩니다. 계정에 저장되어 다른 기기에서도
            이어집니다.
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
            title="사진은 이 기기에만 남습니다"
            body="손톱 사진은 분석할 때만 서버를 거치고 저장되지 않습니다. 사진은 이 브라우저 저장소에 사용자별로 나뉘어 보관되고, 분석 결과만 계정에 저장됩니다."
          />
          <InfoRow
            icon={<ShieldIcon size={17} />}
            title="내 기록은 나만 봅니다"
            body="기록을 읽고 지우는 모든 요청은 로그인한 사용자의 것인지 서버에서 먼저 확인합니다. 남의 기록은 아이디를 알아도 열리지 않습니다."
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
                : `사진은 서버를 거쳐 ${provider ?? "AI"} 비전 모델에 전달되고, 정해진 6개 항목의 관찰 결과만 구조화된 형식으로 돌려받습니다. API 키는 서버에만 있으며 이 화면으로 내려오지 않습니다.`
            }
          />
        </div>

        {user && (
          <>
            <div className="section-title">계정</div>
            <div className="card">
              <button className="row" onClick={() => setPending("account")}>
                <div
                  className="icon-badge"
                  style={{
                    background: "var(--alert-soft)",
                    color: "var(--alert)",
                  }}
                >
                  <TrashIcon size={16} />
                </div>
                <div className="flex-1">
                  <div className="label">계정 삭제</div>
                  <div className="sub">
                    계정과 모든 분석 기록이 지워집니다. 되돌릴 수 없어요.
                  </div>
                </div>
              </button>
            </div>
          </>
        )}

        <div className="small muted center mt-24">
          NailSense v{APP_VERSION} · 참고용 도구
        </div>
      </main>

      {pending && (
        <Sheet
          onClose={() => {
            if (busy) return;
            setPending(null);
            setPassword("");
            setError(null);
          }}
        >
          <h3 style={{ margin: "0 0 6px", fontSize: 17 }}>
            {pending === "photos"
              ? "저장된 사진을 모두 지울까요?"
              : pending === "all"
                ? "모든 기록을 지울까요?"
                : "계정을 삭제할까요?"}
          </h3>
          <p className="small muted" style={{ marginTop: 0 }}>
            {pending === "photos"
              ? `이 기기에 저장된 사진 ${photoCount}장이 삭제됩니다. 분석 결과는 그대로 남습니다.`
              : pending === "all"
                ? `분석 기록 ${records.length}건과 사진이 모두 삭제됩니다. 되돌릴 수 없어요.`
                : "계정과 모든 분석 기록, 이 기기의 사진이 함께 삭제됩니다. 되돌릴 수 없어요."}
          </p>

          {pending === "account" && (
            <>
              <label className="field-row mt-12">
                <span>
                  {user?.hasPassword
                    ? "확인을 위해 비밀번호를 입력해 주세요"
                    : `확인을 위해 ${user?.email} 을(를) 그대로 입력해 주세요`}
                </span>
                <input
                  className="field"
                  type={user?.hasPassword ? "password" : "email"}
                  value={password}
                  autoComplete={user?.hasPassword ? "current-password" : "off"}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              {error && (
                <div className="auth-error" role="alert">
                  {error}
                </div>
              )}
            </>
          )}
          <div className="btn-row mt-16">
            <button
              className="btn btn-secondary"
              onClick={() => {
                setPending(null);
                setPassword("");
                setError(null);
              }}
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
