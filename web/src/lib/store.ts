import { Capacitor } from "@capacitor/core";
import { AppLauncher } from "@capacitor/app-launcher";
import {
  PACKAGE_TYPE,
  PURCHASES_ERROR_CODE,
  Purchases,
  type PurchasesPackage,
} from "@revenuecat/purchases-capacitor";
import type { BillingStatus } from "../../../shared/billing";
import { request } from "./server";

/**
 * 휴대폰 앱의 인앱 구독(애플 App Store · 구글 Play). 이 파일은 앱 빌드에만 들어간다.
 *
 * - 결제 창과 카드 정보는 스토어가 맡는다. 이 앱은 결제 정보를 보지 않는다.
 * - 가격은 스토어가 그 나라 통화로 알려 준 값(priceString)을 그대로 보여 준다.
 * - 구매가 끝나도 앱이 스스로 Pro 를 켜지 않는다. 서버에 확인(/billing/sync)을 맡기고,
 *   서버는 RevenueCat 에 직접 물어본 결과로만 Pro 를 켠다.
 * - 구매는 로그인한 계정에 묶는다(RevenueCat 의 app user id = 우리 계정 아이디).
 */

export interface StorePackage {
  id: string;
  interval: "month" | "year";
  /** 스토어가 준 현지 통화 가격. 예: "$4.99", "₩6,600" */
  price: string;
  /** 연간 상품의 월 환산 가격 */
  perMonth: string | null;
  /** 무료 체험. 예: { count: 7, unit: "DAY" } */
  trial: { count: number; unit: string } | null;
  raw: PurchasesPackage;
}

let configuredKey: string | null = null;
let currentUser: string | null = null;

function apiKeyFor(billing: BillingStatus): string | null {
  if (!billing.store) return null;
  return Capacitor.getPlatform() === "android" ? billing.store.androidKey : billing.store.iosKey;
}

/**
 * RevenueCat 을 준비하고, 로그인한 계정과 맞춘다. 결제를 쓸 수 없으면 false.
 * 로그인하지 않았으면 준비만 하고 구매는 막는다(화면에서 로그인을 먼저 안내).
 */
export async function prepareStore(billing: BillingStatus, userId: string | null): Promise<boolean> {
  const apiKey = apiKeyFor(billing);
  if (!apiKey) return false;
  if (configuredKey !== apiKey) {
    await Purchases.configure({ apiKey, appUserID: userId ?? undefined });
    configuredKey = apiKey;
    currentUser = userId;
    return true;
  }
  if (userId && userId !== currentUser) {
    await Purchases.logIn({ appUserID: userId });
    currentUser = userId;
  } else if (!userId && currentUser) {
    await Purchases.logOut().catch(() => undefined);
    currentUser = null;
  }
  return true;
}

/** 로그아웃·계정 삭제 뒤 RevenueCat 쪽 사용자도 떼어 낸다. */
export async function forgetStoreUser(): Promise<void> {
  if (!configuredKey || !currentUser) return;
  await Purchases.logOut().catch(() => undefined);
  currentUser = null;
}

function toPackage(pkg: PurchasesPackage): StorePackage | null {
  // 보통은 패키지 종류($rc_monthly · $rc_annual)로 알고, 직접 이름 붙인 패키지면 상품의 결제 주기(P1M · P1Y)로 안다.
  const period = pkg.product.subscriptionPeriod;
  const interval =
    pkg.packageType === PACKAGE_TYPE.MONTHLY
      ? "month"
      : pkg.packageType === PACKAGE_TYPE.ANNUAL
        ? "year"
        : period === "P1M"
          ? "month"
          : period === "P1Y" || period === "P12M"
            ? "year"
            : null;
  if (!interval) return null;
  const intro = pkg.product.introPrice;
  return {
    id: pkg.identifier,
    interval,
    price: pkg.product.priceString,
    perMonth: interval === "year" ? pkg.product.pricePerMonthString : null,
    trial:
      intro && intro.price === 0
        ? { count: intro.periodNumberOfUnits, unit: intro.periodUnit }
        : null,
    raw: pkg,
  };
}

/** 지금 팔고 있는 상품(월간·연간). RevenueCat 대시보드의 current offering 에서 가져온다. */
export async function loadPackages(): Promise<StorePackage[]> {
  const offerings = await Purchases.getOfferings();
  const packages = offerings.current?.availablePackages ?? [];
  return packages
    .map(toPackage)
    .filter((pkg): pkg is StorePackage => pkg !== null)
    .sort((a, b) => (a.interval === b.interval ? 0 : a.interval === "month" ? -1 : 1));
}

export type PurchaseOutcome = "purchased" | "cancelled" | "pending";

export async function purchase(pkg: StorePackage): Promise<PurchaseOutcome> {
  try {
    await Purchases.purchasePackage({ aPackage: pkg.raw });
    return "purchased";
  } catch (err) {
    const code = (err as { code?: string }).code;
    if ((err as { userCancelled?: boolean }).userCancelled || code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) {
      return "cancelled";
    }
    // 부모 승인 대기 등. 승인되면 스토어가 알려 오고 웹훅으로 반영된다.
    if (code === PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR) return "pending";
    throw err;
  }
}

/** 이전에 산 구독을 이 계정으로 되찾는다(기기를 바꿨거나 앱을 다시 깔았을 때). */
export async function restore(): Promise<void> {
  await Purchases.restorePurchases();
}

/** 서버에 "RevenueCat 에 다시 물어봐 달라"고 한다. 앱이 보낸 내용은 쓰지 않는다. */
export async function syncWithServer(): Promise<BillingStatus> {
  const body = await request<{ status: BillingStatus }>("/billing/sync", { method: "POST" });
  return body.status;
}

/**
 * 구독 관리(해지·결제 수단) 화면. 스토어 구독은 스토어에서만 해지할 수 있다.
 * RevenueCat 이 알려 준 주소를 먼저 쓰고, 없으면 각 스토어의 구독 관리 페이지로 간다.
 */
export async function openManageSubscriptions(): Promise<void> {
  let url: string | null = null;
  try {
    url = (await Purchases.getCustomerInfo()).customerInfo.managementURL;
  } catch {
    url = null;
  }
  url ??=
    Capacitor.getPlatform() === "android"
      ? "https://play.google.com/store/account/subscriptions"
      : "https://apps.apple.com/account/subscriptions";
  await AppLauncher.openUrl({ url });
}
