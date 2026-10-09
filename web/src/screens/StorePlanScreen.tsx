import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import type { BillingStatus } from "../../../shared/billing";
import type { LegalDocId } from "../../../shared/legal";
import { formatBillingDate, storeLabel, usageLine } from "../lib/billing";
import {
  loadPackages,
  openManageSubscriptions,
  prepareStore,
  purchase,
  restore,
  syncWithServer,
  type StorePackage,
} from "../lib/store";
import { ServerError, type AuthUser } from "../lib/server";
import { BackIcon, CheckIcon } from "../components/Icons";
import { Notice, TopBar } from "../components/ui";
import { L } from "../i18n";

/**
 * 휴대폰 앱의 요금제 화면. 결제는 App Store · Google Play 가 한다.
 *
 * 스토어 심사가 요구하는 것을 결제 버튼 가까이에 둔다:
 * 상품 이름과 기간, 현지 통화 가격, 체험 뒤 청구 금액, 자동 갱신과 해지 방법,
 * 구매 복원, 이용약관·개인정보처리방침 링크.
 */

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const IS_ANDROID = Capacitor.getPlatform() === "android";
const STORE_NAME = IS_ANDROID ? "Google Play" : "App Store";
/** 이 기기의 스토어. 다른 스토어에서 산 구독은 이 기기에서 관리할 수 없다. */
const THIS_STORE = IS_ANDROID ? "play_store" : "app_store";
const ACCOUNT_NAME = IS_ANDROID ? L("Google account", "Google 계정") : L("Apple Account", "Apple 계정");

function trialText(trial: NonNullable<StorePackage["trial"]>): string {
  const en = { DAY: "day", WEEK: "week", MONTH: "month", YEAR: "year" }[trial.unit] ?? "day";
  const ko = { DAY: "일", WEEK: "주", MONTH: "개월", YEAR: "년" }[trial.unit] ?? "일";
  return L(`${trial.count}-${en}`, `${trial.count}${ko}`);
}

/** 문장 속 체험 기간: "7 days", "1 month", "7일" */
function trialDuration(trial: NonNullable<StorePackage["trial"]>): string {
  const en = { DAY: "day", WEEK: "week", MONTH: "month", YEAR: "year" }[trial.unit] ?? "day";
  const ko = { DAY: "일", WEEK: "주", MONTH: "개월", YEAR: "년" }[trial.unit] ?? "일";
  return L(`${trial.count} ${en}${trial.count === 1 ? "" : "s"}`, `${trial.count}${ko}`);
}

function perPeriod(pkg: StorePackage): string {
  return pkg.interval === "month" ? L(`${pkg.price}/month`, `월 ${pkg.price}`) : L(`${pkg.price}/year`, `연 ${pkg.price}`);
}

function yearlySaving(packages: StorePackage[]): number | null {
  const month = packages.find((pkg) => pkg.interval === "month")?.raw.product.price;
  const year = packages.find((pkg) => pkg.interval === "year")?.raw.product.price;
  if (!month || !year) return null;
  const saving = Math.round((1 - year / (month * 12)) * 100);
  return saving >= 5 ? saving : null;
}

export function StorePlanScreen({
  billing,
  user,
  onBack,
  onSignIn,
  onBillingChange,
  onOpenLegal,
}: {
  billing: BillingStatus | null;
  user: AuthUser | null;
  onBack: () => void;
  onSignIn: () => void;
  onBillingChange: (status: BillingStatus) => void;
  onOpenLegal: (doc: LegalDocId) => void;
}) {
  const [packages, setPackages] = useState<StorePackage[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [chosen, setChosen] = useState<StorePackage["interval"]>("year");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const storeOn = Boolean(billing?.enabled && billing.store);
  const userId = user?.id ?? null;

  // 스토어를 준비하고 상품을 불러온다. 로그인 상태가 바뀌면 RevenueCat 쪽 사용자도 맞춘다.
  useEffect(() => {
    if (!billing || !storeOn) return;
    let cancelled = false;
    setLoadFailed(false);
    void (async () => {
      try {
        if (!(await prepareStore(billing, userId))) throw new Error("no key");
        const loaded = await loadPackages();
        if (cancelled) return;
        setPackages(loaded);
        if (loaded.length > 0 && !loaded.some((pkg) => pkg.interval === "year")) {
          setChosen(loaded[0]!.interval);
        }
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // billing 전체가 아니라 스토어 설정과 사용자만 바뀔 때 다시 준비한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeOn, userId, billing?.store?.iosKey, billing?.store?.androidKey]);

  const subscription = billing?.subscription ?? null;
  const usage = billing?.usage;
  const isPro = usage?.plan === "pro";
  const selected = packages?.find((pkg) => pkg.interval === chosen) ?? packages?.[0];

  function failWith(err: unknown, fallback: string) {
    setError(err instanceof ServerError ? err.message : fallback);
  }

  /** 스토어 결제가 끝나면 서버가 RevenueCat 에 직접 확인해 Pro 를 켠다. 늦게 반영될 수 있어 몇 번 묻는다. */
  async function confirmPro(): Promise<boolean> {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        const status = await syncWithServer();
        if (!mounted.current) return false;
        onBillingChange(status);
        if (status.usage.plan === "pro") return true;
      } catch {
        // 잠시 뒤 다시 묻는다.
      }
      await wait(1500);
    }
    return false;
  }

  async function subscribe() {
    if (!selected || busy || !user) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const outcome = await purchase(selected);
      if (outcome === "cancelled") return;
      if (outcome === "pending") {
        setMessage(
          L(
            "Your purchase is waiting for approval. Pro will turn on once it's approved.",
            "구매 승인을 기다리고 있어요. 승인되면 Pro가 켜져요.",
          ),
        );
        return;
      }
      const pro = await confirmPro();
      if (!mounted.current) return;
      setMessage(
        pro
          ? L("You're on Pro now. Thanks for supporting NailSense.", "이제 Pro예요. NailSense를 응원해 주셔서 고마워요.")
          : L(
              "Your purchase went through, but Pro hasn't shown up yet. It usually appears within a few minutes. You can also tap Restore purchases.",
              "구매는 완료됐지만 아직 Pro로 바뀌지 않았어요. 보통 몇 분 안에 반영돼요. '구매 복원'을 눌러도 돼요.",
            ),
      );
    } catch (err) {
      failWith(err, L("The purchase couldn't be completed. You haven't been charged.", "구매를 마치지 못했어요. 결제되지 않았어요."));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function restorePurchases() {
    if (busy || !user) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await restore();
      const status = await syncWithServer();
      onBillingChange(status);
      setMessage(
        status.usage.plan === "pro"
          ? L("Your subscription is restored.", "구독을 복원했어요.")
          : L(
              `We didn't find an active subscription for this ${ACCOUNT_NAME}.`,
              `이 ${ACCOUNT_NAME}에서 이용 중인 구독을 찾지 못했어요.`,
            ),
      );
    } catch (err) {
      failWith(err, L("We couldn't restore purchases. Please try again in a moment.", "구매를 복원하지 못했어요. 잠시 후 다시 시도해 주세요."));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function manage() {
    setError(null);
    try {
      await openManageSubscriptions();
    } catch {
      setError(
        L(
          `Open ${STORE_NAME} and go to your subscriptions to manage or cancel.`,
          `${STORE_NAME}에서 구독 메뉴를 열어 관리하거나 해지해 주세요.`,
        ),
      );
    }
  }

  const saving = packages ? yearlySaving(packages) : null;

  return (
    <>
      <TopBar
        title={L("Plan", "요금제")}
        left={
          <button className="icon-btn" onClick={onBack} aria-label={L("Back", "돌아가기")}>
            <BackIcon size={22} />
          </button>
        }
      />
      <main className="screen">
        {!billing || !storeOn ? (
          <p className="tier-sub mt-16">{L("Plans aren't available right now.", "지금은 요금제를 이용할 수 없어요.")}</p>
        ) : (
          <>
            <section className="tier-now">
              <div className="tier-kicker">{L("Your plan", "내 요금제")}</div>
              <h2 className="tier-name">{isPro ? "Pro" : "Free"}</h2>
              {usage && usageLine(usage) && <p className="tier-usage">{usageLine(usage)}</p>}
              {subscription && (
                <p className="tier-sub">
                  {subscription.cancelAt
                    ? L(
                        `Ends ${formatBillingDate(subscription.cancelAt)}. You won't be charged again.`,
                        `${formatBillingDate(subscription.cancelAt)}에 끝나요. 더 이상 결제되지 않아요.`,
                      )
                    : subscription.status === "trialing" && subscription.currentPeriodEnd
                      ? L(
                          `Free trial until ${formatBillingDate(subscription.currentPeriodEnd)}.`,
                          `${formatBillingDate(subscription.currentPeriodEnd)}까지 무료 체험.`,
                        )
                      : subscription.currentPeriodEnd
                        ? L(
                            `Renews ${formatBillingDate(subscription.currentPeriodEnd)}.`,
                            `${formatBillingDate(subscription.currentPeriodEnd)}에 갱신.`,
                          )
                        : L("Active.", "이용 중.")}
                </p>
              )}
            </section>

            {message && (
              <div className="mt-16" role="status">
                <Notice tone="accent">{message}</Notice>
              </div>
            )}
            {error && (
              <p className="form-error mt-12" role="alert">
                {error}
              </p>
            )}

            {subscription?.status === "past_due" && (
              <div className="mt-16">
                <Notice tone="monitor">
                  <strong>{L("Your last payment didn't go through.", "지난 결제가 처리되지 않았어요.")}</strong>{" "}
                  {L(
                    `Update your payment method in ${storeLabel(subscription.source)} to keep Pro.`,
                    `Pro를 계속 쓰려면 ${storeLabel(subscription.source)}에서 결제 수단을 바꿔 주세요.`,
                  )}
                </Notice>
              </div>
            )}

            {subscription ? (
              <section className="sec">
                <h3 className="sec-title">{L("Manage", "관리")}</h3>
                <div className="list">
                  {subscription.source === "other" ? (
                    // 스토어 결제가 아닌 Pro(예: RevenueCat 에서 직접 준 이용권)는 관리할 스토어가 없다.
                    <div className="row">
                      <div className="row-main">
                        <div className="row-title">{L("Pro is active on your account", "계정에 Pro가 적용되어 있어요")}</div>
                        <div className="row-sub">
                          {L(
                            "It wasn't bought through a store, so there's nothing to manage or cancel.",
                            "스토어에서 산 구독이 아니라서 관리하거나 해지할 것이 없어요.",
                          )}
                        </div>
                      </div>
                    </div>
                  ) : subscription.source !== THIS_STORE ? (
                    // 다른 스토어(예: 아이폰에서 구독하고 안드로이드에서 연 경우)의 구독은 여기서 열 수 없다.
                    <div className="row">
                      <div className="row-main">
                        <div className="row-title">
                          {L(
                            `Subscribed through ${storeLabel(subscription.source)}`,
                            `${storeLabel(subscription.source)}에서 구독함`,
                          )}
                        </div>
                        <div className="row-sub">
                          {L(
                            `Manage or cancel it in ${storeLabel(subscription.source)} on the device you subscribed with.`,
                            `구독한 기기의 ${storeLabel(subscription.source)}에서 관리하거나 해지해 주세요.`,
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <button className="row" onClick={() => void manage()}>
                      <div className="row-main">
                        <div className="row-title">{L("Manage or cancel subscription", "구독 관리·해지")}</div>
                        <div className="row-sub">
                          {L(`Opens your ${STORE_NAME} subscriptions`, `${STORE_NAME} 구독 화면이 열려요`)}
                        </div>
                      </div>
                    </button>
                  )}
                </div>
              </section>
            ) : (
              <section className="sec">
                <h3 className="sec-title">Pro</h3>
                <ul className="tier-points">
                  <li>
                    <CheckIcon size={16} weight="bold" />
                    <span>{L(`Up to ${billing.limits.proPerDay} scans a day`, `하루 ${billing.limits.proPerDay}번까지 분석`)}</span>
                  </li>
                  <li>
                    <CheckIcon size={16} weight="bold" />
                    <span>{L("Everything in Free", "무료 요금제의 모든 기능")}</span>
                  </li>
                </ul>
                <p className="tier-free">
                  {L(
                    `Free includes ${billing.limits.freePerMonth} scans a month with full results.`,
                    `무료 요금제는 한 달에 ${billing.limits.freePerMonth}번, 결과 전체를 볼 수 있어요.`,
                  )}
                </p>

                {!user ? (
                  <>
                    <p className="fineprint">
                      {L(
                        "Log in or create an account to subscribe, so Pro stays with your account on every device.",
                        "구독하려면 로그인하거나 계정을 만들어 주세요. Pro가 계정에 붙어 어느 기기에서든 쓸 수 있어요.",
                      )}
                    </p>
                    <button className="btn btn-primary mt-12" onClick={onSignIn}>
                      {L("Log in to subscribe", "로그인하고 구독하기")}
                    </button>
                  </>
                ) : loadFailed ? (
                  <p className="fineprint">
                    {L(
                      `Plans couldn't be loaded from ${STORE_NAME}. Please check your connection and try again.`,
                      `${STORE_NAME}에서 요금제를 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.`,
                    )}
                  </p>
                ) : !packages ? (
                  <p className="fineprint" role="status">{L("Loading plans…", "요금제를 불러오는 중…")}</p>
                ) : packages.length === 0 ? (
                  <p className="fineprint">{L("No plans are on sale right now.", "지금 판매 중인 요금제가 없어요.")}</p>
                ) : (
                  <>
                    <div className="price-options" role="radiogroup" aria-label={L("Billing period", "결제 주기")}>
                      {packages.map((pkg) => {
                        const active = selected?.id === pkg.id;
                        return (
                          <button
                            key={pkg.id}
                            className="price-option"
                            role="radio"
                            aria-checked={active}
                            onClick={() => setChosen(pkg.interval)}
                          >
                            <span className="po-name">{pkg.interval === "month" ? L("Monthly", "월간") : L("Yearly", "연간")}</span>
                            <span className="po-price">{perPeriod(pkg)}</span>
                            <span className="po-note">
                              {pkg.trial
                                ? L(`${trialText(pkg.trial)} free trial`, `${trialText(pkg.trial)} 무료 체험`)
                                : pkg.interval === "year" && saving
                                  ? L(`Save ${saving}%`, `${saving}% 할인`)
                                  : pkg.perMonth
                                    ? L(`${pkg.perMonth}/month`, `월 ${pkg.perMonth}`)
                                    : " "}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {selected && (
                      <ul className="disclosure">
                        <li>
                          {selected.trial
                            ? L(
                                `Free for ${trialDuration(selected.trial)}, then ${perPeriod(selected)}. Cancel at least 24 hours before the trial ends and you won't be charged.`,
                                `${trialDuration(selected.trial)} 동안 무료, 이후 ${perPeriod(selected)}이 결제돼요. 체험이 끝나기 24시간 전까지 해지하면 결제되지 않아요.`,
                              )
                            : L(
                                `${perPeriod(selected)}, charged to your ${ACCOUNT_NAME} when you confirm.`,
                                `${perPeriod(selected)}, 구매를 확인하면 ${ACCOUNT_NAME}으로 결제돼요.`,
                              )}
                        </li>
                        <li>
                          {L(
                            `Renews automatically every ${selected.interval} unless you cancel at least 24 hours before the end of the current period. Manage or cancel anytime in your ${STORE_NAME} subscriptions.`,
                            `현재 기간이 끝나기 24시간 전까지 해지하지 않으면 ${selected.interval === "month" ? "매달" : "매년"} 자동으로 갱신돼요. ${STORE_NAME} 구독 메뉴에서 언제든 관리하거나 해지할 수 있어요.`,
                          )}
                        </li>
                      </ul>
                    )}

                    <button
                      className="btn btn-primary mt-12"
                      disabled={busy || !selected}
                      onClick={() => void subscribe()}
                    >
                      {selected?.trial ? L("Start free trial", "무료 체험 시작") : L("Subscribe", "구독하기")}
                    </button>
                    <p className="fineprint mt-12">
                      {L(
                        "By subscribing you agree to the Terms of Use and Privacy Policy below.",
                        "구독하면 아래 이용약관과 개인정보처리방침에 동의하는 것으로 봐요.",
                      )}
                    </p>
                  </>
                )}
              </section>
            )}

            {user && (
              <button className="link mt-16" onClick={() => void restorePurchases()} disabled={busy}>
                {L("Restore purchases", "구매 복원")}
              </button>
            )}

            <p className="fineprint mt-24">
              {L(
                "Warning-sign checks and advice on when to see a doctor are always free, on every plan.",
                "위험 신호 점검과 진료 안내는 어떤 요금제에서든 늘 무료예요.",
              )}
            </p>
            <div className="legal-links">
              <button className="link link-quiet" onClick={() => onOpenLegal("terms")}>
                {L("Terms of Use", "이용약관")}
              </button>
              <button className="link link-quiet" onClick={() => onOpenLegal("privacy")}>
                {L("Privacy Policy", "개인정보처리방침")}
              </button>
            </div>
          </>
        )}
      </main>
    </>
  );
}
