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

/**
 * 요금제 화면.
 *
 * 결제 전에 알려야 할 것(금액, 갱신 주기, 체험이 끝나면 청구된다는 것, 해지 방법)을
 * 결제 버튼 바로 위에 적고, 사용자가 직접 체크해야 결제 창이 열린다.
 * 해지는 결제와 같은 화면에서 두 번 눌러 끝난다.
 */

const INTERVAL_NAME: Record<BillingInterval, string> = {
  month: "Monthly",
  year: "Yearly",
};

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
          setMessage("You're on Pro now. Thanks for supporting NailSense.");
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
      "Your payment went through, but Pro hasn't shown up yet. It usually appears within a few minutes. If it doesn't, contact support.",
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
      failWith(err, "We couldn't open checkout. Please try again in a moment.");
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
          ? `Your subscription is canceled. You'll keep Pro until ${formatBillingDate(end)}, and you won't be charged again.`
          : "Your subscription is canceled.",
      );
      setConfirmCancel(false);
    } catch (err) {
      failWith(err, "We couldn't cancel your subscription. Please try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  async function resume() {
    setBusy(true);
    setError(null);
    try {
      onBillingChange(await resumeSubscription());
      setMessage("Your subscription will keep renewing.");
    } catch (err) {
      failWith(err, "We couldn't update your subscription. Please try again in a moment.");
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
      failWith(err, "We couldn't open the billing page. Please try again in a moment.");
    }
  }

  return (
    <>
      <TopBar
        title="Plan"
        left={
          <button className="icon-btn" onClick={onBack} aria-label="Back">
            <BackIcon size={22} />
          </button>
        }
      />
      <main className="screen">
        {!billing || !billing.enabled ? (
          <p className="tier-sub mt-16">Plans aren't available right now.</p>
        ) : (
          <>
            <section className="tier-now">
              <div className="tier-kicker">Your plan</div>
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
                <Notice>Confirming your payment…</Notice>
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
                  <strong>Your last payment didn't go through.</strong> Update your
                  payment method to keep Pro.
                </Notice>
              </div>
            )}

            {subscription ? (
              <section className="sec">
                <h3 className="sec-title">Manage</h3>
                <div className="list">
                  <button className="row" onClick={() => void managePayment()} disabled={busy}>
                    <div className="row-main">
                      <div className="row-title">Payment method and receipts</div>
                      <div className="row-sub">Opens our payment provider, Paddle</div>
                    </div>
                  </button>
                  {subscription.cancelAt ? (
                    <button className="row" onClick={() => void resume()} disabled={busy}>
                      <div className="row-main">
                        <div className="row-title">Keep my subscription</div>
                        <div className="row-sub">Undo the cancellation and keep renewing</div>
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
                          <div className="row-title">Cancel subscription</div>
                          <div className="row-sub">You keep Pro until the end of this period</div>
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
              Warning-sign checks and advice on when to see a doctor are always free, on
              every plan.
            </p>
            <div className="legal-links">
              <button className="link link-quiet" onClick={() => onOpenLegal("terms")}>
                Terms of Service
              </button>
              <button className="link link-quiet" onClick={() => onOpenLegal("privacy")}>
                Privacy Policy
              </button>
            </div>
          </>
        )}
      </main>

      {confirmCancel && subscription && (
        <Sheet label="Cancel subscription" onClose={() => !busy && setConfirmCancel(false)}>
          <h3>Cancel Pro?</h3>
          <p>
            {subscription.currentPeriodEnd
              ? `You'll keep Pro until ${formatBillingDate(subscription.currentPeriodEnd)}. `
              : ""}
            After that you'll move to Free, with {billing?.limits.freePerMonth} scans a
            month. Your history stays.
          </p>
          <div className="btn-row mt-16">
            <button
              className="btn btn-secondary"
              onClick={() => setConfirmCancel(false)}
              disabled={busy}
            >
              Keep Pro
            </button>
            <button className="btn btn-danger" onClick={() => void cancel()} disabled={busy}>
              Cancel Pro
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
    text = `Ends ${formatBillingDate(subscription.cancelAt)}. You won't be charged again.`;
  } else if (subscription.status === "trialing" && end) {
    text = `Free trial until ${formatBillingDate(end)}${price ? `, then ${perInterval(price)}` : ""}.`;
  } else if (subscription.status === "paused") {
    text = "Paused.";
  } else if (end) {
    text = `Renews ${formatBillingDate(end)}${price ? ` at ${perInterval(price)}` : ""}.`;
  } else {
    text = "Active.";
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
          <span>Up to {billing.limits.proPerDay} scans a day</span>
        </li>
        <li>
          <CheckIcon size={16} weight="bold" />
          <span>Everything in Free</span>
        </li>
      </ul>
      <p className="tier-free">
        Free includes {billing.limits.freePerMonth} scans a month with full results.
      </p>

      {prices.length === 0 ? (
        <p className="fineprint">Prices couldn't be loaded. Please try again later.</p>
      ) : (
        <>
          <div className="price-options" role="radiogroup" aria-label="Billing period">
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
                      ? `${trialLabel(price.trial)} free trial`
                      : price.interval === "year" && saving
                        ? `Save ${saving}%`
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
                  ? `Free for ${trialDuration(selected.trial)}, then ${perInterval(selected)} plus any applicable tax. If you cancel during the trial, you won't be charged.`
                  : `${perInterval(selected)} plus any applicable tax, charged today.`}
              </li>
              <li>
                Renews automatically every {selected.interval} until you cancel. Cancel
                anytime in Profile &gt; Plan and keep Pro until the end of the period
                you've paid for.
              </li>
              <li>
                Paddle, our reseller, handles payment and shows the final price in your
                currency.
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
                  I agree to the Terms of Service and understand Pro renews
                  automatically until I cancel.
                </span>
              </label>
              <button className="link" onClick={() => onOpenLegal("terms")}>
                Read the Terms of Service
              </button>
              <button
                className="btn btn-primary mt-12"
                disabled={!agreed || busy || !selected}
                onClick={onSubscribe}
              >
                {selected?.trial ? "Start free trial" : "Continue to payment"}
              </button>
            </>
          ) : (
            <>
              <p className="fineprint">
                Log in or create an account to subscribe, so Pro works on every device
                you use.
              </p>
              <button className="btn btn-primary mt-12" onClick={onSignIn}>
                Log in to subscribe
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}
