import { useEffect, useRef } from "react";
import type { BillingStatus } from "../../../shared/billing";
import type { LegalDocId } from "../../../shared/legal";
import { fetchBillingStatus, formatBillingDate, storeLabel, usageLine } from "../lib/billing";
import type { AuthUser } from "../lib/server";
import { BackIcon, CheckIcon } from "../components/Icons";
import { Notice, TopBar } from "../components/ui";
import { L } from "../i18n";

/**
 * 웹에서 보는 요금제 화면.
 *
 * Pro 는 휴대폰 앱의 인앱 구독(App Store · Google Play)으로만 판다. 그래서 웹에는 결제 버튼이 없고,
 * 지금 요금제와 남은 횟수, 어디서 구독하고 관리하는지만 알려 준다.
 * 구독은 계정에 붙으므로, 앱에서 구독한 계정으로 웹에 로그인하면 여기서도 Pro 다.
 * (휴대폰 앱에서는 StorePlanScreen 을 쓴다.)
 */
export function PlanScreen({
  billing,
  user,
  onBack,
  onBillingChange,
  onOpenLegal,
}: {
  billing: BillingStatus | null;
  user: AuthUser | null;
  onBack: () => void;
  onBillingChange: (status: BillingStatus) => void;
  onOpenLegal: (doc: LegalDocId) => void;
}) {
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // 화면을 열 때마다 최신 상태로 맞춘다. 휴대폰에서 구독하거나 해지했을 수 있다.
  useEffect(() => {
    void fetchBillingStatus().then((status) => {
      if (status && mounted.current) onBillingChange(status);
    });
  }, [onBillingChange]);

  const subscription = billing?.subscription ?? null;
  const usage = billing?.usage;
  const isPro = usage?.plan === "pro";
  const store = subscription ? storeLabel(subscription.source) : null;

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

            {subscription ? (
              <section className="sec">
                <h3 className="sec-title">{L("Manage", "관리")}</h3>
                <p className="tier-sub">
                  {subscription.source === "other"
                    ? L(
                        "Pro is active on your account. It wasn't bought through a store, so there's nothing to manage or cancel.",
                        "계정에 Pro가 적용되어 있어요. 스토어에서 산 구독이 아니라서 관리하거나 해지할 것이 없어요.",
                      )
                    : L(
                        `Your subscription is billed through ${store}. To change your payment method or cancel, open your ${store} subscriptions on the phone you subscribed with.`,
                        `구독 결제는 ${store}에서 이루어져요. 결제 수단을 바꾸거나 해지하려면 구독한 휴대폰에서 ${store} 구독 메뉴를 열어 주세요.`,
                      )}
                </p>
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
                <div className="mt-12">
                  <Notice>
                    {user
                      ? L(
                          "Pro is available in the NailSense app for iPhone and Android, through the App Store or Google Play. Subscribe there with this account and Pro works here too.",
                          "Pro는 아이폰·안드로이드용 NailSense 앱에서 App Store 또는 Google Play로 구독할 수 있어요. 앱에서 이 계정으로 구독하면 여기서도 Pro가 돼요.",
                        )
                      : L(
                          "Pro is available in the NailSense app for iPhone and Android, through the App Store or Google Play. Subscribe there, then log in here with the same account.",
                          "Pro는 아이폰·안드로이드용 NailSense 앱에서 App Store 또는 Google Play로 구독할 수 있어요. 앱에서 구독한 뒤 같은 계정으로 여기 로그인해 주세요.",
                        )}
                  </Notice>
                </div>
              </section>
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
    </>
  );
}
