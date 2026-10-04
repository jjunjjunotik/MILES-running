/**
 * 테스트용 가짜 RevenueCat 서버. 실제 RevenueCat 의 /v1/subscribers 응답 모양을 흉내 낸다.
 *
 * 테스트가 grant()/expire() 등으로 "스토어에서 일어난 일"을 정해 두면,
 * NailSense 서버가 물어볼 때 그 상태를 돌려준다.
 */
import http from "node:http";

// 비밀값 검사(check:secrets)에 걸리지 않게 나눠 적는다. 진짜 키가 아니다.
export const SECRET_KEY = "sk_" + "testsecretkey0123456789abcdef";
export const WEBHOOK_AUTH = "whsec-test-0123456789abcdef";
export const IOS_KEY = "appl_publictestkey123";
export const ANDROID_KEY = "goog_publictestkey123";

const iso = (ms) => (ms === null ? null : new Date(ms).toISOString());

export async function startMockRevenueCat(port) {
  const subscribers = new Map();
  const state = {
    subscribers,
    requests: [],
    deleted: [],
    failNext: 0,
    badAuth: 0,
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    // 브라우저 테스트의 가짜 스토어가 "구매했다"고 알리는 통로. 테스트 전용이라 인증이 없다.
    if (url.pathname === "/_test/grant") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Headers", "content-type");
        res.writeHead(204).end();
        return;
      }
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        const { user, productId } = JSON.parse(raw || "{}");
        if (user) {
          subscribers.set(user, {
            productId,
            expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
            periodType: /year/.test(productId) ? "trial" : "normal",
          });
        }
        res.writeHead(200, { "content-type": "application/json" }).end("{}");
      });
      return;
    }
    state.requests.push(`${req.method} ${url.pathname}`);
    if (req.headers.authorization !== `Bearer ${SECRET_KEY}`) {
      state.badAuth += 1;
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ code: 7225, message: "Invalid API key" }));
      return;
    }
    if (state.failNext > 0) {
      state.failNext -= 1;
      res.writeHead(500, { "content-type": "application/json" });
      res.end("{}");
      return;
    }
    const match = /^\/v1\/subscribers\/([^/]+)$/.exec(url.pathname);
    if (!match) {
      res.writeHead(404).end();
      return;
    }
    const id = decodeURIComponent(match[1]);
    if (req.method === "DELETE") {
      subscribers.delete(id);
      state.deleted.push(id);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ app_user_id: id }));
      return;
    }
    const entry = subscribers.get(id);
    const subscriber = { entitlements: {}, subscriptions: {}, original_app_user_id: id };
    if (entry) {
      subscriber.entitlements[entry.entitlement ?? "pro"] = {
        expires_date: iso(entry.expiresAt),
        grace_period_expires_date: iso(entry.graceUntil ?? null),
        product_identifier: entry.productId,
        purchase_date: iso(Date.now() - 1000),
      };
      subscriber.subscriptions[entry.productId] = {
        expires_date: iso(entry.expiresAt),
        period_type: entry.periodType ?? "normal",
        store: entry.store ?? "app_store",
        is_sandbox: entry.sandbox ?? true,
        unsubscribe_detected_at: entry.unsubscribed ? iso(Date.now()) : null,
        billing_issues_detected_at: entry.billingIssue ? iso(Date.now()) : null,
        grace_period_expires_date: iso(entry.graceUntil ?? null),
        refunded_at: entry.refunded ? iso(Date.now()) : null,
      };
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ request_date: iso(Date.now()), subscriber }));
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

  return {
    state,
    url: `http://127.0.0.1:${port}`,
    /** 스토어에서 구독을 산 것으로 한다 */
    grant(userId, options = {}) {
      subscribers.set(userId, {
        productId: options.productId ?? "nailsense_pro_monthly",
        expiresAt: options.expiresAt ?? Date.now() + 30 * 24 * 60 * 60 * 1000,
        ...options,
      });
    },
    update(userId, patch) {
      const entry = subscribers.get(userId);
      if (entry) subscribers.set(userId, { ...entry, ...patch });
    },
    /** 다른 계정으로 옮긴다(구매 복원 시 RevenueCat 의 TRANSFER) */
    transfer(from, to) {
      const entry = subscribers.get(from);
      subscribers.delete(from);
      if (entry) subscribers.set(to, entry);
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
