import { useEffect, useRef, useState } from "react";
import {
  trialDuration,
  trialLabel,
  type BillingInterval,
  type BillingStatus,
  type PriceInfo,
} from "../../../shared/billing";
import type { LegalDocId } from "../../../shared/legal";
import {
  billingPortalUrl,
  cancelSubscription,
  confirmCheckout,
  createCheckout,
  fetchBillingStatus,
  formatBillingDate,
  openCheckout,
  perInterval,
  resumeSubscription,
  usageLine,
  yearlySaving,
} from "../lib/billing";
import { ServerError, type AuthUser } from "../lib/server";
import { BackIcon, CheckIcon } from "../components/Icons";
import { Notice, Sheet, TopBar } from "../components/ui";
import { L } from "../i18n";

/**
 * 요금제 화면.
 *
 * 결제 전에 알려야 할 것(금액, 갱신 주기, 체험이 끝나면 청구된다는 것, 해지 방법)을
 * 결제 버튼 바로 위에 적고, 사용자가 직접 체크해야 결제 창이 열린다.
 * 해지는 결제와 같은 화면에서 두 번 눌러 끝난다.
 */

const INTERVAL_NAME: Record<BillingInterval, string> = {
  month: L("Monthly", "월간"),
  year: L("Yearly", "연간"),
};

/** 체험 기간을 한국어로: "7일", "1개월" */
function trialKo(trial: NonNullable<PriceInfo["trial"]>): string {
  const unit = { day: "일", week: "주", month: "개월", year: "년" }[trial.interval];
  return `${trial.frequency}${unit}`;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function PlanScreen({
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
  const prices = billing?.prices ?? [];
  const [chosen, setChosen] = useState<BillingInterval>(
    prices.some((price) => price.interval === "month") ? "month" : "year",
  );
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [activating, setActivating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // 화면을 열 때마다 최신 상태로 맞춘다. 다른 기기에서 해지했을 수도 있다.
  useEffect(() => {
    void fetchBillingStatus().then((status) => {
      if (status && mounted.current) onBillingChange(status);
    });
  }, [onBillingChange]);

  const selected = prices.find((price) => price.interval === chosen) ?? prices[0];
  const subscription = billing?.subscription ?? null;
  const usage = billing?.usage;
  const isPro = usage?.plan === "pro";

  function failWith(err: unknown, fallback: string) {
    setError(err instanceof ServerError ? err.message : fallback);
  }

  /** 결제가 끝났다는 신호를 받으면, 서버가 Paddle 에 직접 확인해 Pro 를 켠다. */
  async function activate(transactionId: string) {
    setActivating(true);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        const status = await confirmCheckout(transactionId);
        if (!mounted.current) return;
        onBillingChange(status);
        if (status.usage.plan === "pro") {
          setActivating(false);
          setMessage(L("You're on Pro now. Thanks for supporting NailSense.", "이제 Pro예요. NailSense를 응원해 주셔서 고마워요."));
          return;
        }
      } catch {
        // 결제 직후에는 구독이 아직 만들어지지 않았을 수 있다. 조금 뒤 다시 묻는다.
      }
      await wait(2000);
    }
    if (!mounted.current) return;
    setActivating(false);
    setMessage(
      L(
        "Your payment went through, but Pro hasn't shown up yet. It usually appears within a few minutes. If it doesn't, contact support.",
        "결제는 완료됐지만 아직 Pro로 바뀌지 않았어요. 보통 몇 분 안에 반영돼요. 그래도 안 되면 고객 지원에 문의해 주세요.",
      ),
    );
  }

  async function subscribe() {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const checkout = await createCheckout(selected.interval);
      await openCheckout({
        ...checkout,
        onCompleted: (transactionId) => void activate(transactionId),
        onClosed: () => {
          if (mounted.current) setBusy(false);
        },
      });
    } catch (err) {
      failWith(err, L("We couldn't open checkout. Please try again in a moment.", "결제 창을 열지 못했어요. 잠시 후 다시 시도해 주세요."));
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      const status = await cancelSubscription();
      onBillingChange(status);
      const end = status.subscription?.cancelAt;
      setMessage(
        end
          ? L(`Your subscription is canceled. You'll keep Pro until ${formatBillingDate(end)}, and you won't be charged again.`, `구독을 해지했어요. ${formatBillingDate(end)}까지 Pro를 그대로 쓸 수 있고, 더 이상 결제되지 않아요.`)
          : L("Your subscription is canceled.", "구독을 해지했어요."),
      );
      setConfirmCancel(false);
    } catch (err) {
      failWith(err, L("We couldn't cancel your subscription. Please try again in a moment.", "구독을 해지하지 못했어요. 잠시 후 다시 시도해 주세요."));
    } finally {
      setBusy(false);
    }
  }

  async function resume() {
    setBusy(true);
    setError(null);
    try {
      onBillingChange(await resumeSubscription());
      setMessage(L("Your subscription will keep renewing.", "구독이 계속 갱신돼요."));
    } catch (err) {
      failWith(err, L("We couldn't update your subscription. Please try again in a moment.", "구독을 바꾸지 못했어요. 잠시 후 다시 시도해 주세요."));
    } finally {
      setBusy(false);
    }
  }

  async function managePayment() {
    // 결제 업체 페이지는 새 창으로 연다. 기다린 뒤에 열면 팝업 차단에 걸리므로 창부터 연다.
    const popup = window.open("about:blank", "_blank");
    setError(null);
    try {
      const url = await billingPortalUrl();
      if (popup) {
        popup.opener = null;
        popup.location.href = url;
      } else {
        window.location.assign(url);
      }
    } catch (err) {
      popup?.close();
      failWith(err, L("We couldn't open the billing page. Please try again in a moment.", "결제 관리 페이지를 열지 못했어요. 잠시 후 다시 시도해 주세요."));
    }
  }

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
        {!billing || !billing.enabled ? (
          <p className="tier-sub mt-16">{L("Plans aren't available right now.", "지금은 요금제를 이용할 수 없어요.")}</p>
        ) : (
          <>
            <section className="tier-now">
              <div className="tier-kicker">{L("Your plan", "내 요금제")}</div>
              <h2 className="tier-name">{isPro ? "Pro" : "Free"}</h2>
              {usage && usageLine(usage) && (
                <p className="tier-usage">{usageLine(usage)}</p>
              )}
              {subscription && (
                <SubscriptionLine
                  status={billing}
                  priceFor={(value) => prices.find((price) => price.interval === value)}
                />
              )}
            </section>

            {message && (
              <div className="mt-16" role="status">
                <Notice tone="accent">{message}</Notice>
              </div>
            )}
            {activating && (
              <div className="mt-16" role="status">
                <Notice>{L("Confirming your payment…", "결제를 확인하고 있어요…")}</Notice>
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
                  {L("Update your payment method to keep Pro.", "Pro를 계속 쓰려면 결제 수단을 바꿔 주세요.")}
                </Notice>
              </div>
            )}

            {subscription ? (
              <section className="sec">
                <h3 className="sec-title">{L("Manage", "관리")}</h3>
                <div className="list">
                  <button className="row" onClick={() => void managePayment()} disabled={busy}>
                    <div className="row-main">
                      <div className="row-title">{L("Payment method and receipts", "결제 수단과 영수증")}</div>
                      <div className="row-sub">{L("Opens our payment provider, Paddle", "결제 대행사 Paddle 페이지가 열려요")}</div>
                    </div>
                  </button>
                  {subscription.cancelAt ? (
                    <button className="row" onClick={() => void resume()} disabled={busy}>
                      <div className="row-main">
                        <div className="row-title">{L("Keep my subscription", "구독 유지하기")}</div>
                        <div className="row-sub">{L("Undo the cancellation and keep renewing", "해지를 취소하고 계속 갱신해요")}</div>
                      </div>
                    </button>
                  ) : (
                    subscription.status !== "paused" && (
                      <button
                        className="row danger"
                        onClick={() => setConfirmCancel(true)}
                        disabled={busy}
                      >
                        <div className="row-main">
                          <div className="row-title">{L("Cancel subscription", "구독 해지")}</div>
                          <div className="row-sub">{L("You keep Pro until the end of this period", "이번 결제 기간이 끝날 때까지 Pro가 유지돼요")}</div>
                        </div>
                      </button>
                    )
                  )}
                </div>
              </section>
            ) : (
              <UpgradeSection
                billing={billing}
                prices={prices}
                selected={selected}
                onSelect={setChosen}
                agreed={agreed}
                onAgree={setAgreed}
                busy={busy || activating}
                signedIn={Boolean(user)}
                onSubscribe={() => void subscribe()}
                onSignIn={onSignIn}
                onOpenLegal={onOpenLegal}
              />
            )}

            <p className="fineprint mt-24">
              {L(
                "Warning-sign checks and advice on when to see a doctor are always free, on every plan.",
                "위험 신호 점검과 진료 안내는 어떤 요금제에서든 늘 무료예요.",
              )}
            </p>
            <div className="legal-links">
              <button className="link link-quiet" onClick={() => onOpenLegal("terms")}>
                {L("Terms of Service", "이용약관")}
              </button>
              <button className="link link-quiet" onClick={() => onOpenLegal("privacy")}>
                {L("Privacy Policy", "개인정보처리방침")}
              </button>
            </div>
          </>
        )}
      </main>

      {confirmCancel && subscription && (
        <Sheet label={L("Cancel subscription", "구독 해지")} onClose={() => !busy && setConfirmCancel(false)}>
          <h3>{L("Cancel Pro?", "Pro를 해지할까요?")}</h3>
          <p>
            {subscription.currentPeriodEnd
              ? L(`You'll keep Pro until ${formatBillingDate(subscription.currentPeriodEnd)}. `, `${formatBillingDate(subscription.currentPeriodEnd)}까지는 Pro가 유지돼요. `)
              : ""}
            {L(
              `After that you'll move to Free, with ${billing?.limits.freePerMonth} scans a month. Your history stays.`,
              `그 뒤에는 한 달에 ${billing?.limits.freePerMonth}번 분석할 수 있는 무료 요금제로 바뀌어요. 기록은 그대로 남아요.`,
            )}
          </p>
          <div className="btn-row mt-16">
            <button
              className="btn btn-secondary"
              onClick={() => setConfirmCancel(false)}
              disabled={busy}
            >
              {L("Keep Pro", "Pro 유지")}
            </button>
            <button className="btn btn-danger" onClick={() => void cancel()} disabled={busy}>
              {L("Cancel Pro", "Pro 해지")}
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}

function SubscriptionLine({
  status,
  priceFor,
}: {
  status: BillingStatus;
  priceFor: (interval: BillingInterval) => PriceInfo | undefined;
}) {
  const subscription = status.subscription!;
  const price = subscription.interval ? priceFor(subscription.interval) : undefined;
  const end = subscription.currentPeriodEnd;
  const intervalName = subscription.interval ? INTERVAL_NAME[subscription.interval] : null;

  let text: string;
  if (subscription.cancelAt) {
    text = L(`Ends ${formatBillingDate(subscription.cancelAt)}. You won't be charged again.`, `${formatBillingDate(subscription.cancelAt)}에 끝나요. 더 이상 결제되지 않아요.`);
  } else if (subscription.status === "trialing" && end) {
    text = L(
      `Free trial until ${formatBillingDate(end)}${price ? `, then ${perInterval(price)}` : ""}.`,
      `${formatBillingDate(end)}까지 무료 체험${price ? `, 이후 ${perInterval(price)}` : ""}.`,
    );
  } else if (subscription.status === "paused") {
    text = L("Paused.", "일시 정지됨.");
  } else if (end) {
    text = L(
      `Renews ${formatBillingDate(end)}${price ? ` at ${perInterval(price)}` : ""}.`,
      `${formatBillingDate(end)}에 갱신${price ? ` (${perInterval(price)})` : ""}.`,
    );
  } else {
    text = L("Active.", "이용 중.");
  }

  return (
    <p className="tier-sub">
      {intervalName ? `${intervalName}. ` : ""}
      {text}
    </p>
  );
}

function UpgradeSection({
  billing,
  prices,
  selected,
  onSelect,
  agreed,
  onAgree,
  busy,
  signedIn,
  onSubscribe,
  onSignIn,
  onOpenLegal,
}: {
  billing: BillingStatus;
  prices: PriceInfo[];
  selected: PriceInfo | undefined;
  onSelect: (interval: BillingInterval) => void;
  agreed: boolean;
  onAgree: (value: boolean) => void;
  busy: boolean;
  signedIn: boolean;
  onSubscribe: () => void;
  onSignIn: () => void;
  onOpenLegal: (doc: LegalDocId) => void;
}) {
  const saving = yearlySaving(prices);

  return (
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

      {prices.length === 0 ? (
        <p className="fineprint">{L("Prices couldn't be loaded. Please try again later.", "가격을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.")}</p>
      ) : (
        <>
          <div className="price-options" role="radiogroup" aria-label={L("Billing period", "결제 주기")}>
            {prices.map((price) => {
              const active = selected?.interval === price.interval;
              return (
                <button
                  key={price.interval}
                  className="price-option"
                  role="radio"
                  aria-checked={active}
                  onClick={() => onSelect(price.interval)}
                >
                  <span className="po-name">{INTERVAL_NAME[price.interval]}</span>
                  <span className="po-price">{perInterval(price)}</span>
                  <span className="po-note">
                    {price.trial
                      ? L(`${trialLabel(price.trial)} free trial`, `${trialKo(price.trial)} 무료 체험`)
                      : price.interval === "year" && saving
                        ? L(`Save ${saving}%`, `${saving}% 할인`)
                        : " "}
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
                      `Free for ${trialDuration(selected.trial)}, then ${perInterval(selected)} plus any applicable tax. If you cancel during the trial, you won't be charged.`,
                      `${trialKo(selected.trial)} 동안 무료, 이후 ${perInterval(selected)}(세금 별도)이 청구돼요. 체험 중에 해지하면 결제되지 않아요.`,
                    )
                  : L(
                      `${perInterval(selected)} plus any applicable tax, charged today.`,
                      `${perInterval(selected)}(세금 별도)이 오늘 결제돼요.`,
                    )}
              </li>
              <li>
                {L(
                  `Renews automatically every ${selected.interval} until you cancel. Cancel anytime in Profile > Plan and keep Pro until the end of the period you've paid for.`,
                  `해지할 때까지 ${selected.interval === "month" ? "매달" : "매년"} 자동으로 갱신돼요. 프로필 > 요금제에서 언제든 해지할 수 있고, 결제한 기간이 끝날 때까지 Pro가 유지돼요.`,
                )}
              </li>
              <li>
                {L(
                  "Paddle, our reseller, handles payment and shows the final price in your currency.",
                  "결제는 판매 대행사 Paddle이 처리하며, 최종 금액은 결제 창에서 원화 등 현지 통화로 보여 드려요.",
                )}
              </li>
            </ul>
          )}

          {signedIn ? (
            <>
              <label className="check mt-16">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(event) => onAgree(event.target.checked)}
                />
                <span>
                  {L(
                    "I agree to the Terms of Service and understand Pro renews automatically until I cancel.",
                    "이용약관에 동의하며, 해지할 때까지 Pro가 자동으로 갱신된다는 것을 확인했습니다.",
                  )}
                </span>
              </label>
              <button className="link" onClick={() => onOpenLegal("terms")}>
                {L("Read the Terms of Service", "이용약관 보기")}
              </button>
              <button
                className="btn btn-primary mt-12"
                disabled={!agreed || busy || !selected}
                onClick={onSubscribe}
              >
                {selected?.trial ? L("Start free trial", "무료 체험 시작") : L("Continue to payment", "결제하기")}
              </button>
            </>
          ) : (
            <>
              <p className="fineprint">
                {L(
                  "Log in or create an account to subscribe, so Pro works on every device you use.",
                  "구독하려면 로그인하거나 계정을 만들어 주세요. 어느 기기에서든 Pro를 쓸 수 있어요.",
                )}
              </p>
              <button className="btn btn-primary mt-12" onClick={onSignIn}>
                {L("Log in to subscribe", "로그인하고 구독하기")}
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}
