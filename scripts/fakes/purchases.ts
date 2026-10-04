/**
 * 테스트 빌드 전용 가짜 RevenueCat 플러그인(@revenuecat/purchases-capacitor 대신 끼워 넣는다).
 * 실제 앱 빌드에는 들어가지 않는다. vite.config.ts 의 NAILSENSE_FAKE_STORE 참고.
 *
 * 브라우저 테스트가 window.__fakeStore 에 상품과 "다음 구매 결과"를 정해 두면 그대로 흉내 내고,
 * 구매하면 가짜 RevenueCat 서버에 "이 사용자가 샀다"고 알린다. 서버는 그 서버에 물어 Pro 를 켠다.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export enum PACKAGE_TYPE {
  MONTHLY = "MONTHLY",
  ANNUAL = "ANNUAL",
}

export const PURCHASES_ERROR_CODE = {
  PURCHASE_CANCELLED_ERROR: "1",
  PAYMENT_PENDING_ERROR: "20",
} as const;

export type PurchasesPackage = any;

const store = () => (window as any).__fakeStore;

export const Purchases = {
  async configure(options: { apiKey: string; appUserID?: string }) {
    store().log.push(["configure", options.apiKey, options.appUserID ?? null]);
    store().user = options.appUserID ?? null;
  },
  async logIn(options: { appUserID: string }) {
    store().log.push(["logIn", options.appUserID]);
    store().user = options.appUserID;
    return { customerInfo: {}, created: false };
  },
  async logOut() {
    store().log.push(["logOut"]);
    store().user = null;
    return { customerInfo: {} };
  },
  async getOfferings() {
    return { all: {}, current: { availablePackages: store().packages } };
  },
  async purchasePackage(options: { aPackage: any }) {
    const fake = store();
    fake.log.push(["purchase", options.aPackage.identifier, fake.user]);
    const outcome = fake.nextPurchase ?? "buy";
    fake.nextPurchase = "buy";
    if (outcome === "cancel") throw { code: "1", userCancelled: true, message: "cancelled" };
    if (outcome === "pending") throw { code: "20", userCancelled: false, message: "pending" };
    await fetch(`${fake.rcUrl}/_test/grant`, {
      method: "POST",
      body: JSON.stringify({ user: fake.user, productId: options.aPackage.product.identifier }),
    });
    return { customerInfo: {}, productIdentifier: options.aPackage.product.identifier };
  },
  async restorePurchases() {
    store().log.push(["restore", store().user]);
    return { customerInfo: {} };
  },
  async getCustomerInfo() {
    return { customerInfo: { managementURL: "https://apps.apple.com/account/subscriptions" } };
  },
};
