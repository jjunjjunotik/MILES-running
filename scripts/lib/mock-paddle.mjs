/**
 * 테스트용 모의 Paddle 과, 그쪽을 바라보는 앱 서버를 띄운다.
 * check-billing.mjs(서버 검증)와 e2e-billing.mjs(화면 검증)가 함께 쓴다.
 *
 * 진짜 Paddle 은 부르지 않는다. 앱 서버는 PADDLE_API_URL(루프백만 허용)로 이 모의 서버를 부른다.
 */
import crypto from "node:crypto";
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// 가짜 값. 진짜 키 형식(검사 스크립트가 잡는 모양)과 겹치지 않게 짧게 둔다.
export const API_KEY = "fake-paddle-key";
export const WEBHOOK_SECRET = "fake-webhook-secret";
export const CLIENT_TOKEN = "test_fakeclienttoken";
export const PRICE_MONTH = "pri_month0000000000000000000001";
export const PRICE_YEAR = "pri_year00000000000000000000001";

export const id = (prefix) =>
  `${prefix}_${Array.from(crypto.randomBytes(26), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("")}`;
const iso = (ms) => new Date(ms).toISOString();

export function subscriptionEntity(sub) {
  return {
    id: sub.id,
    status: sub.status,
    customer_id: sub.customer_id,
    updated_at: iso(sub.updated_at),
    billing_cycle: { interval: sub.interval, frequency: 1 },
    current_billing_period: { starts_at: iso(sub.period_start), ends_at: iso(sub.period_end) },
    scheduled_change: sub.scheduled_change,
    items: [{ price: { id: sub.price_id, billing_cycle: { interval: sub.interval } } }],
  };
}

export async function startMockPaddle(port) {
  const paddle = {
    prices: {
      [PRICE_MONTH]: {
        id: PRICE_MONTH,
        status: "active",
        unit_price: { amount: "499", currency_code: "USD" },
        billing_cycle: { interval: "month", frequency: 1 },
        trial_period: { interval: "day", frequency: 7 },
      },
      [PRICE_YEAR]: {
        id: PRICE_YEAR,
        status: "active",
        unit_price: { amount: "2999", currency_code: "USD" },
        billing_cycle: { interval: "year", frequency: 1 },
        trial_period: null,
      },
    },
    transactions: new Map(),
    subscriptions: new Map(),
    failCancel: new Set(),
    calls: [],
  };

  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
    const send = (status, data) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(status < 300 ? { data } : { error: { code: data } }));
    };
    paddle.calls.push(`${req.method} ${req.url}`);

    if (req.headers.authorization !== `Bearer ${API_KEY}`) return send(401, "authentication_malformed");

    const url = new URL(req.url, "http://mock");
    const parts = url.pathname.split("/").filter(Boolean);

    if (req.method === "GET" && parts[0] === "prices") {
      const price = paddle.prices[parts[1]];
      return price ? send(200, price) : send(404, "not_found");
    }
    if (req.method === "POST" && url.pathname === "/transactions") {
      const priceId = body?.items?.[0]?.price_id;
      if (!paddle.prices[priceId]) return send(400, "bad_request");
      const txn = {
        id: id("txn"),
        status: "draft",
        customer_id: body.customer_id ?? null,
        subscription_id: null,
        custom_data: body.custom_data ?? null,
        price_id: priceId,
      };
      paddle.transactions.set(txn.id, txn);
      return send(201, txn);
    }
    if (req.method === "GET" && parts[0] === "transactions") {
      const txn = paddle.transactions.get(parts[1]);
      return txn ? send(200, txn) : send(404, "not_found");
    }
    if (parts[0] === "subscriptions") {
      const sub = paddle.subscriptions.get(parts[1]);
      if (!sub) return send(404, "not_found");
      if (req.method === "GET") return send(200, subscriptionEntity(sub));
      if (req.method === "POST" && parts[2] === "cancel") {
        if (paddle.failCancel.has(sub.id)) return send(500, "internal_error");
        if (body?.effective_from === "immediately") {
          sub.status = "canceled";
          sub.scheduled_change = null;
        } else {
          sub.scheduled_change = { action: "cancel", effective_at: iso(sub.period_end), resume_at: null };
        }
        sub.updated_at = Date.now();
        return send(200, subscriptionEntity(sub));
      }
      if (req.method === "PATCH") {
        if (body && "scheduled_change" in body && body.scheduled_change === null) {
          sub.scheduled_change = null;
          sub.updated_at = Date.now();
        }
        return send(200, subscriptionEntity(sub));
      }
    }
    if (req.method === "POST" && parts[0] === "customers" && parts[2] === "portal-sessions") {
      return send(201, {
        urls: {
          general: { overview: "https://customer-portal.paddle.com/cpl_test/overview" },
          subscriptions: (body?.subscription_ids ?? []).map((subId) => ({
            id: subId,
            cancel_subscription: `https://customer-portal.paddle.com/cpl_test/${subId}/cancel`,
            update_subscription_payment_method: `https://customer-portal.paddle.com/cpl_test/${subId}/payment`,
          })),
        },
      });
    }
    return send(404, "not_found");
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

  /** 결제 창에서 손님이 결제를 마친 것처럼 모의 Paddle 의 상태를 바꾼다. */
  function completeCheckout(transactionId, { trial = true } = {}) {
    const txn = paddle.transactions.get(transactionId);
    const nowMs = Date.now();
    const customerId = txn.customer_id ?? id("ctm");
    const sub = {
      id: id("sub"),
      status: trial ? "trialing" : "active",
      customer_id: customerId,
      price_id: txn.price_id,
      interval: txn.price_id === PRICE_YEAR ? "year" : "month",
      period_start: nowMs,
      period_end: nowMs + (trial ? 7 : 30) * 24 * 60 * 60 * 1000,
      scheduled_change: null,
      updated_at: nowMs,
    };
    paddle.subscriptions.set(sub.id, sub);
    Object.assign(txn, { status: "completed", customer_id: customerId, subscription_id: sub.id });
    return sub;
  }

  return { paddle, completeCheckout, close: () => server.close() };
}

/**
 * 모의 Paddle 을 바라보는 앱 서버. 분석은 데모 응답으로 대신하고, 실제 .env 의 키는 쓰지 않는다.
 * 빌드된 화면(dist)도 같이 서빙한다.
 */
export async function startAppServer({ port, paddlePort, env = {} }) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "nailsense-billing-"));
  const server = spawn("npx", ["tsx", "server/index.ts"], {
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      DB_FILE: path.join(dataDir, "billing.db"),
      ENV_FILE: path.join(dataDir, "none.env"),
      GEMINI_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      ALLOW_DEMO_FALLBACK: "true",
      NODE_ENV: "development",
      RATE_LIMIT_PER_IP: "500",
      AUTH_RATE_LIMIT_PER_IP: "500",
      PADDLE_ENV: "sandbox",
      PADDLE_API_KEY: API_KEY,
      PADDLE_WEBHOOK_SECRET: WEBHOOK_SECRET,
      PADDLE_CLIENT_TOKEN: CLIENT_TOKEN,
      PADDLE_PRICE_MONTHLY: PRICE_MONTH,
      PADDLE_PRICE_YEARLY: PRICE_YEAR,
      PADDLE_API_URL: `http://127.0.0.1:${paddlePort}`,
      ...env,
    },
    stdio: ["ignore", "ignore", "pipe"],
    detached: true,
  });
  let errors = "";
  server.stderr.on("data", (chunk) => {
    errors += chunk.toString();
  });

  const api = `http://127.0.0.1:${port}`;
  const stop = () => {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {}
    fs.rmSync(dataDir, { recursive: true, force: true });
  };

  for (let i = 0; i < 60; i += 1) {
    try {
      const response = await fetch(`${api}/api/health`);
      if (response.ok) return { api, stop, errors: () => errors };
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  stop();
  throw new Error("서버가 뜨지 않았습니다.");
}

/** Paddle 처럼 서명한 웹훅을 보낸다. */
export function sendWebhook(api, event, { secret = WEBHOOK_SECRET, ts = Math.floor(Date.now() / 1000), tamper = false } = {}) {
  const raw = JSON.stringify(event);
  const h1 = crypto.createHmac("sha256", secret).update(`${ts}:${raw}`).digest("hex");
  return fetch(`${api}/api/billing/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "paddle-signature": `ts=${ts};h1=${h1}`,
    },
    body: tamper ? raw.replace('"status":"', '"status":"x') : raw,
  });
}
