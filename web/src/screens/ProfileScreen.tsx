import { useEffect, useState } from "react";
import {
  type NailRecord,
} from "../../../shared/analysis";
import {
  DISCLAIMER_LONG,
} from "../labels";
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
  savePreferences,
  type AuthUser,
} from "../lib/server";
import { Notice, Sheet, TopBar } from "../components/ui";
import { ChevronIcon } from "../components/Icons";
import type { BillingStatus } from "../../../shared/billing";
import type { LegalDocId } from "../../../shared/legal";
import { consentGivenAt, withdrawConsent } from "../lib/consent";
import { formatBillingDate, usageLine } from "../lib/billing";
import { L, localePreference, setLocalePreference } from "../i18n";

type PendingAction = "photos" | "all" | "account" | "consent" | null;

export const APP_VERSION = "1.0.0";

export function ProfileScreen({
  user,
  settings,
  records,
  onChangeSettings,
  onChanged,
  onDeleteAll,
  onSignOut,
  onSignIn,
  billing = null,
  onOpenPlan,
  onOpenLegal,
}: {
  user: AuthUser | null;
  settings: Settings;
  records: NailRecord[];
  onChangeSettings: (settings: Settings) => void;
  onChanged: () => Promise<void> | void;
  onDeleteAll: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onSignIn?: () => void;
  billing?: BillingStatus | null;
  onOpenPlan?: () => void;
  onOpenLegal?: (doc: LegalDocId) => void;
}) {
  const [pending, setPending] = useState<PendingAction>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  /** 기록 가져오기 결과. 가져오기 안내가 있던 자리에 보여 준다. */
  const [imported, setImported] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** 계정을 만들기 전에 이 기기에 쌓여 있던 기록. 있으면 가져올 수 있게 안내한다. */
  const [localCount, setLocalCount] = useState(0);

  const photoCount = records.filter((record) => record.hasImage).length;
  /** 이 기기에서 건강 데이터 처리에 동의한 시각 */
  const [consentAt, setConsentAt] = useState<number | null>(() => consentGivenAt());
  const subscription = billing?.subscription ?? null;
  /** 화면 언어 고르기. 바꾸면 페이지를 다시 불러온다. */
  const language = localePreference();

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
      const count = await importScans(found);
      setImported(
        count > 0
          ? L(`Moved ${count} ${count === 1 ? "scan" : "scans"} from this device to your account.`, `이 기기에 있던 기록 ${count}건을 계정으로 가져왔어요.`)
          : L("There were no new scans to move.", "가져올 새 기록이 없었어요."),
      );
      setLocalCount(0);
      await onChanged();
    } catch (err) {
      setImported(
        err instanceof ServerError ? err.message : L("We couldn't move your scans.", "기록을 가져오지 못했어요."),
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
        setDone(L("All saved photos were deleted. Your scan history is still here.", "저장된 사진을 모두 지웠어요. 분석 기록은 그대로 있어요."));
        await onChanged();
      } else if (action === "all") {
        await clearScopedImages();
        await onDeleteAll();
        setDone(L("All scans and photos were deleted.", "모든 기록과 사진을 지웠어요."));
      } else if (action === "consent") {
        // 계정에 남은 동의 기록도 함께 거둔다. 다음 분석 전에 다시 묻는다.
        if (!STANDALONE_DEMO && user) await savePreferences({ healthConsent: false });
        withdrawConsent();
        setConsentAt(null);
        setDone(null);
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
            : L("We couldn't delete your account.", "계정을 삭제하지 못했어요."),
        );
        setBusy(false);
        return;
      }
      setDone(
        action === "consent"
          ? L("We couldn't update your consent. Please try again in a moment.", "동의 상태를 바꾸지 못했어요. 잠시 후 다시 시도해 주세요.")
          : L("Delete didn't work. Please try again in a moment.", "삭제하지 못했어요. 잠시 후 다시 시도해 주세요."),
      );
    } finally {
      setBusy(false);
      if (action !== "account") setPending(null);
    }
  }

  return (
    <>
      <TopBar title={L("Profile", "프로필")} />
      <main className="screen">
        {user ? (
          <section className="account">
            <div style={{ minWidth: 0 }}>
              <div className="name">{user.displayName || L("No name", "이름 없음")}</div>
              <div className="sub">{user.email}</div>
            </div>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => void onSignOut()}
            >
              {L("Log out", "로그아웃")}
            </button>
          </section>
        ) : !STANDALONE_DEMO ? (
          <section className="account">
            <div>
              <div className="name">{L("Saving on this device", "이 기기에 저장 중")}</div>
              <div className="sub">
                {L("Create an account to see your history on other devices.", "계정을 만들면 다른 기기에서도 기록을 볼 수 있어요.")}
              </div>
            </div>
            {onSignIn && (
              <button
                className="btn btn-primary btn-sm signin-btn"
                onClick={onSignIn}
                aria-label={L("Log in or create an account", "로그인 또는 계정 만들기")}
              >
                {L("Log in", "로그인")}
              </button>
            )}
          </section>
        ) : null}

        {localCount > 0 && (
          <div className="import-box">
            <div className="t">{L(`${localCount} ${localCount === 1 ? "scan" : "scans"} saved on this device`, `이 기기에 남아 있는 기록 ${localCount}건`)}</div>
            <p>
              {L(
                "These were saved before you had an account. Move them to your account to see them on other devices.",
                "계정을 만들기 전에 저장한 기록이에요. 계정으로 가져오면 다른 기기에서도 볼 수 있어요.",
              )}
            </p>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => void importLocal()}
              disabled={busy}
            >
              {L("Move to account", "계정으로 가져오기")}
            </button>
          </div>
        )}

        {imported && (
          <div className="mt-16" role="status">
            <Notice>{imported}</Notice>
          </div>
        )}

        {billing?.enabled && onOpenPlan && (
          <section className="sec" style={{ marginTop: 28 }}>
            <h3 className="sec-title">{L("Plan", "요금제")}</h3>
            <div className="list">
              <button className="row plan-row" onClick={onOpenPlan}>
                <div className="row-main">
                  <div className="row-title">
                    {billing.usage.plan === "pro" ? "Pro" : "Free"}
                  </div>
                  <div className="row-sub">
                    {subscription?.cancelAt
                      ? L(`Pro ends ${formatBillingDate(subscription.cancelAt)}`, `Pro 종료 예정: ${formatBillingDate(subscription.cancelAt)}`)
                      : subscription?.status === "past_due"
                        ? L("Payment needs attention", "결제 확인이 필요해요")
                        : usageLine(billing.usage)}
                  </div>
                </div>
                <span className="row-end">
                  {billing.usage.plan === "pro" ? L("Manage", "관리") : L("See Pro", "Pro 보기")}
                </span>
                <ChevronIcon size={18} className="chev" />
              </button>
            </div>
          </section>
        )}

        <section className="sec" style={{ marginTop: 28 }}>
          <label className="field-label" htmlFor="nickname">
            {L("Nickname", "닉네임")} <span className="opt">{L("(optional)", "(선택)")}</span>
          </label>
          <input
            id="nickname"
            className="field"
            maxLength={12}
            autoComplete="nickname"
            value={settings.nickname}
            onChange={(event) =>
              onChangeSettings({ ...settings, nickname: event.target.value })
            }
          />
          <p className="field-help">
            {L("Shown on your results and share cards.", "결과 화면과 공유 카드에 표시돼요.")}
            {user ? L(" Saved to your account, so it follows you to other devices.", " 계정에 저장되어 다른 기기에서도 이어져요.") : ""}
          </p>
        </section>

        <section className="sec">
          <h3 className="sec-title">{L("Your history", "기록 요약")}</h3>
          <ul className="list">
            <li className="row">
              <div className="row-main">
                <div className="row-title">{L("Scans", "분석 기록")}</div>
                <div className="row-sub">{L("Results saved so far", "지금까지 저장된 관찰 결과")}</div>
              </div>
              <span className="row-end num">{L(`${records.length}`, `${records.length}건`)}</span>
            </li>
            <li className="row">
              <div className="row-main">
                <div className="row-title">{L("Saved photos", "저장된 사진")}</div>
                <div className="row-sub">{L("Kept on this device only", "이 기기 안에만 보관돼요")}</div>
              </div>
              <span className="row-end num">{L(`${photoCount}`, `${photoCount}장`)}</span>
            </li>
          </ul>
        </section>

        <section className="sec">
          <h3 className="sec-title">{L("Settings", "설정")}</h3>
          <div className="list">
            <ToggleRow
              label={L("Save analyzed photos", "분석한 사진 저장하기")}
              sub={L("When off, only results are kept and photos aren't saved.", "끄면 결과만 남고 사진은 기기에 저장하지 않아요.")}
              on={settings.keepPhotos}
              onToggle={() =>
                onChangeSettings({
                  ...settings,
                  keepPhotos: !settings.keepPhotos,
                })
              }
            />
            <ToggleRow
              label={L("Expand result details", "결과 항목 펼쳐 보기")}
              sub={L("Show each area's details open on the result screen.", "결과 화면에서 항목 설명을 처음부터 펼쳐 둬요.")}
              on={settings.expandByDefault}
              onToggle={() =>
                onChangeSettings({
                  ...settings,
                  expandByDefault: !settings.expandByDefault,
                })
              }
            />
          </div>
          <div className="pick-group mt-16" role="group" aria-label={L("Language", "언어")}>
            <div className="field-label">{L("Language", "언어")}</div>
            <div className="chips">
              {(
                [
                  ["auto", L("Device setting", "기기 설정")],
                  ["en", "English"],
                  ["ko", "한국어"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  className="chip"
                  aria-pressed={language === value}
                  onClick={() => {
                    if (value !== language) setLocalePreference(value);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="sec">
          <h3 className="sec-title">{L("Your data", "내 데이터")}</h3>
          <div className="list">
            <button className="row" onClick={() => setPending("photos")}>
              <div className="row-main">
                <div className="row-title">{L("Delete photos only", "사진만 삭제")}</div>
                <div className="row-sub">{L("Keeps your scan history, removes the photos", "분석 기록은 남기고 사진만 지워요")}</div>
              </div>
            </button>
            <button className="row danger" onClick={() => setPending("all")}>
              <div className="row-main">
                <div className="row-title">{L("Delete all history", "전체 기록 삭제")}</div>
                <div className="row-sub">{L("Removes every result and photo", "모든 분석 결과와 사진을 지워요")}</div>
              </div>
            </button>
          </div>
          {done && (
            <div className="mt-12">
              <Notice>{done}</Notice>
            </div>
          )}
        </section>

        <section className="sec">
          <h3 className="sec-title">{L("Privacy", "개인정보")}</h3>
          <QA
            title={L("Photos stay on this device", "사진은 이 기기에만 남아요")}
            body={L("Nail photos are used only for analysis and are never stored on our server.", "손톱 사진은 분석할 때만 쓰고 서버에 저장하지 않아요.")}
          />
          <QA
            title={L("Only you see your history", "내 기록은 나만 봐요")}
            body={L("Only you can view or delete your scans.", "기록은 본인만 보고 지울 수 있어요.")}
          />
          {!STANDALONE_DEMO && (
            <div className="list mt-8">
              <div className="row">
                <div className="row-main">
                  <div className="row-title">{L("Consent to process nail photos", "손톱 사진 처리 동의")}</div>
                  <div className="row-sub">
                    {consentAt
                      ? L(`Given ${formatBillingDate(consentAt)}`, `${formatBillingDate(consentAt)}에 동의함`)
                      : L("Not given. We'll ask before your next scan.", "동의하지 않음. 다음 분석 전에 다시 여쭤볼게요.")}
                  </div>
                </div>
                {consentAt && (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setPending("consent")}
                  >
                    {L("Withdraw", "철회")}
                  </button>
                )}
              </div>
              {onOpenLegal && (
                <>
                  <button className="row" onClick={() => onOpenLegal("privacy")}>
                    <div className="row-main">
                      <div className="row-title">{L("Privacy Policy", "개인정보처리방침")}</div>
                    </div>
                    <ChevronIcon size={18} className="chev" />
                  </button>
                  <button className="row" onClick={() => onOpenLegal("terms")}>
                    <div className="row-main">
                      <div className="row-title">{L("Terms of Service", "이용약관")}</div>
                    </div>
                    <ChevronIcon size={18} className="chev" />
                  </button>
                </>
              )}
            </div>
          )}
        </section>

        <section className="sec">
          <h3 className="sec-title">{L("About", "이 앱에 대해")}</h3>
          <QA title={L("Not a diagnosis", "진단하지 않아요")} body={DISCLAIMER_LONG} />
          <QA
            title={L("What is the observation index?", "관찰 지표는 무엇인가요?")}
            body={L(
              "A reference number from 0 to 100 for how even the nail looks in the photo. It is not a health score, and it only means something when comparing photos taken in similar conditions.",
              "사진 속 손톱 겉모습이 얼마나 고르게 보이는지를 0에서 100 사이로 나타낸 참고 수치예요. 건강 점수가 아니고, 같은 환경에서 찍은 사진끼리 비교할 때만 의미가 있어요.",
            )}
          />
        </section>

        {user && (
          <section className="sec">
            <h3 className="sec-title">{L("Account", "계정")}</h3>
            <div className="list">
              <button
                className="row danger"
                onClick={() => setPending("account")}
              >
                <div className="row-main">
                  <div className="row-title">{L("Delete account", "계정 삭제")}</div>
                  <div className="row-sub">
                    {L("Removes your account and all scans. This can't be undone.", "계정과 모든 분석 기록이 지워져요. 되돌릴 수 없어요.")}
                  </div>
                </div>
              </button>
            </div>
          </section>
        )}

        <p className="version">NailSense v{APP_VERSION}</p>
      </main>

      {pending && (
        <Sheet
          label={
            pending === "photos"
              ? L("Delete photos", "사진 삭제")
              : pending === "all"
                ? L("Delete all history", "전체 기록 삭제")
                : pending === "consent"
                  ? L("Withdraw consent", "동의 철회")
                  : L("Delete account", "계정 삭제")
          }
          onClose={() => {
            if (busy) return;
            setPending(null);
            setPassword("");
            setError(null);
          }}
        >
          <h3>
            {pending === "photos"
              ? L("Delete all saved photos?", "저장된 사진을 모두 지울까요?")
              : pending === "all"
                ? L("Delete all history?", "모든 기록을 지울까요?")
                : pending === "consent"
                  ? L("Withdraw consent?", "동의를 철회할까요?")
                  : L("Delete your account?", "계정을 삭제할까요?")}
          </h3>
          <p>
            {pending === "photos"
              ? L(`${photoCount} ${photoCount === 1 ? "photo" : "photos"} on this device will be deleted. Your results stay.`, `이 기기에 저장된 사진 ${photoCount}장이 지워져요. 분석 결과는 그대로 남아요.`)
              : pending === "all"
                ? L(`${records.length} ${records.length === 1 ? "scan" : "scans"} and their photos will be deleted. This can't be undone.`, `분석 기록 ${records.length}건과 사진이 모두 지워져요. 되돌릴 수 없어요.`)
                : pending === "consent"
                  ? L("We won't analyze any more photos until you agree again before your next scan. Your saved history isn't deleted; you can delete it under Your data.", "다음 분석 전에 다시 동의하기 전까지는 사진을 분석하지 않아요. 저장된 기록은 지워지지 않으니, 지우려면 내 데이터에서 삭제해 주세요.")
                  : L("Your account, all scans and the photos on this device will be deleted. This can't be undone.", "계정과 모든 분석 기록, 이 기기의 사진이 함께 지워져요. 되돌릴 수 없어요.")}
          </p>
          {pending === "account" && subscription && (
            <div className="mt-12">
              <Notice tone="monitor">
                {subscription.source === "paddle"
                  ? L("Your Pro subscription will be canceled right away, and you won't be charged again.", "Pro 구독이 바로 해지되고, 더 이상 결제되지 않아요.")
                  : (() => {
                      // 스토어 구독은 스토어에서만 해지된다. 계정을 지워도 결제는 계속되므로 먼저 알린다.
                      const store = subscription.source === "play_store" ? "Google Play" : "App Store";
                      return L(
                        `Deleting your account doesn't cancel your ${store} subscription. Cancel it in your ${store} subscriptions first, or you'll keep being charged.`,
                        `계정을 지워도 ${store} 구독은 해지되지 않아요. 먼저 ${store} 구독 메뉴에서 해지하지 않으면 계속 결제돼요.`,
                      );
                    })()}
              </Notice>
            </div>
          )}

          {pending === "account" && (
            <div className="mt-16">
              <label className="field-label" htmlFor="confirm-delete">
                {user?.hasPassword
                  ? L("Enter your password to confirm", "확인을 위해 비밀번호를 입력해 주세요")
                  : L(`Type ${user?.email} to confirm`, `확인을 위해 ${user?.email} 을(를) 그대로 입력해 주세요`)}
              </label>
              <input
                id="confirm-delete"
                className="field"
                type={user?.hasPassword ? "password" : "email"}
                value={password}
                autoComplete={user?.hasPassword ? "current-password" : "off"}
                onChange={(event) => setPassword(event.target.value)}
              />
              {error && (
                <p className="form-error mt-8" role="alert">
                  {error}
                </p>
              )}
            </div>
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
              {L("Cancel", "취소")}
            </button>
            <button
              className="btn btn-danger"
              disabled={busy}
              onClick={() => void run(pending)}
            >
              {pending === "consent" ? L("Withdraw", "철회") : L("Delete", "삭제")}
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
      <div className="row-main">
        <div className="row-title">{label}</div>
        <div className="row-sub">{sub}</div>
      </div>
      <span className={`switch${on ? " on" : ""}`} />
    </button>
  );
}

function QA({ title, body }: { title: string; body: string }) {
  return (
    <div className="qa">
      <h4>{title}</h4>
      <p>{body}</p>
    </div>
  );
}
