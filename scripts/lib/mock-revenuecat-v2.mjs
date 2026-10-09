/**
 * 테스트용 가짜 RevenueCat API v2(프로젝트 설정 부분). scripts/revenuecat.mjs 를 시험한다.
 *
 * 문서(https://www.revenuecat.com/docs/api-v2)의 경로 · 필드에 맞춰, 모르는 필드나 빠진 필수 값이 오면
 * 진짜 서버처럼 4xx 로 거절한다. 목록은 일부러 2개씩 나눠 주어 넘겨 보기(pagination)를 시험한다.
 */
import crypto from "node:crypto";
import http from "node:http";

// 비밀값 검사(check:secrets)에 걸리지 않게 나눠 적는다. 진짜 키가 아니다.
export const V2_KEY = "sk_" + "v2testkey0123456789abcdefgh";

const rid = (prefix) => `${prefix}${crypto.randomBytes(5).toString("hex")}`;

export async function startMockRevenueCatV2(port, options = {}) {
  const pageSize = options.pageSize ?? 2;
  const state = {
    projects: [{ object: "project", id: "proj1a2b3c4d", name: "NailSense", created_at: Date.now() }],
    apps: [],
    publicKeys: [],
    entitlements: [],
    entitlementProducts: new Map(), // entitlement id → Set(product id)
    products: [],
    offerings: [],
    packages: [],
    webhooks: [],
    requests: [],
    rateLimitOnce: options.rateLimitOnce ?? null, // 이 정규식에 맞는 첫 요청 하나를 429 로
  };

  function addApp({ name, type, bundle, project = state.projects[0].id }) {
    const app = { object: "app", id: rid("app"), name, type, project_id: project, created_at: Date.now() };
    if (type === "app_store") app.app_store = { bundle_id: bundle };
    if (type === "play_store") app.play_store = { package_name: bundle };
    state.apps.push(app);
    state.publicKeys.push({
      object: "public_api_key",
      id: rid("key"),
      key: `${type === "app_store" ? "appl_" : "goog_"}${crypto.randomBytes(8).toString("hex")}`,
      environment: "production",
      app_id: app.id,
      created_at: Date.now(),
    });
    return app;
  }
  for (const app of options.apps ?? []) addApp(app);

  const fail = (res, status, message, type = "parameter_error") => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify({ object: "error", type, message, retryable: false }));
  };
  const send = (res, status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const listOf = (res, url, items) => {
    const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") ?? 20), 100, pageSize));
    const after = url.searchParams.get("starting_after");
    const start = after ? items.findIndex((item) => item.id === after) + 1 : 0;
    const page = items.slice(start, start + limit);
    const more = start + limit < items.length;
    send(res, 200, {
      object: "list",
      items: page,
      next_page: more ? `${url.pathname}?starting_after=${page.at(-1).id}` : null,
      url: url.pathname,
    });
  };
  /** 허용한 필드만 왔는지, 필수 필드가 다 있는지 */
  const shape = (body, allowed, required) => {
    if (!body || typeof body !== "object" || Array.isArray(body)) return "body must be an object";
    for (const key of Object.keys(body)) if (!allowed.includes(key)) return `unknown field: ${key}`;
    for (const key of required) if (body[key] === undefined || body[key] === null) return `missing field: ${key}`;
    return null;
  };
  const str = (value, min, max) => typeof value === "string" && value.length >= min && value.length <= max;
  const productView = (product) => ({ ...product });
  const packageView = (pkg, expand) => {
    const view = { object: "package", id: pkg.id, lookup_key: pkg.lookup_key, display_name: pkg.display_name, position: pkg.position, created_at: pkg.created_at };
    if (expand) {
      view.products = {
        object: "list",
        items: pkg.attached.map((a) => ({
          product: productView(state.products.find((p) => p.id === a.product_id)),
          eligibility_criteria: a.eligibility_criteria,
        })),
        next_page: null,
        url: `/v2/projects/${pkg.project_id}/packages/${pkg.id}/products`,
      };
    }
    return view;
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      let body;
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        return fail(res, 400, "invalid json");
      }
      state.requests.push({ method: req.method, path: url.pathname, query: url.search, body });

      if (req.headers.authorization !== `Bearer ${V2_KEY}`) {
        return fail(res, 401, "Invalid API key", "authentication_error");
      }
      if (state.rateLimitOnce && state.rateLimitOnce.test(`${req.method} ${url.pathname}`)) {
        state.rateLimitOnce = null;
        res.writeHead(429, { "content-type": "application/json", "retry-after": "1" });
        return res.end(JSON.stringify({ object: "error", type: "rate_limit_error", message: "Too many requests" }));
      }

      const parts = url.pathname.split("/").filter(Boolean); // v2, projects, :pid, ...
      if (parts[0] !== "v2") return fail(res, 404, "not found", "resource_missing");
      if (parts[1] === "projects" && parts.length === 2 && req.method === "GET") return listOf(res, url, state.projects);
      const pid = parts[2];
      if (parts[1] !== "projects" || !state.projects.some((p) => p.id === pid)) return fail(res, 404, "project not found", "resource_missing");
      const rest = parts.slice(3);
      // 경로의 아이디 자리를 :id 로 바꿔 경로 모양을 맞춘다(integrations/webhooks 는 아이디가 아니다).
      const route =
        rest[0] === "integrations"
          ? `${req.method} ${rest.join("/")}`
          : `${req.method} ${rest.map((part, i) => (i % 2 === 1 && rest[i - 1] !== "actions" ? ":id" : part)).join("/")}`;

      // 앱
      if (route === "GET apps") return listOf(res, url, state.apps.filter((a) => a.project_id === pid));
      if (route === "POST apps") {
        const err = shape(body, ["name", "type", "app_store", "play_store"], ["name", "type"]);
        if (err) return fail(res, 400, err);
        if (!["app_store", "play_store"].includes(body.type)) return fail(res, 400, "unsupported type in mock");
        const field = body.type === "app_store" ? "bundle_id" : "package_name";
        if (!str(body[body.type]?.[field], 1, 256)) return fail(res, 400, `missing ${body.type}.${field}`);
        return send(res, 201, addApp({ name: body.name, type: body.type, bundle: body[body.type][field], project: pid }));
      }
      if (route === "GET apps/:id/public_api_keys") {
        const app = state.apps.find((a) => a.id === rest[1]);
        if (!app) return fail(res, 404, "app not found", "resource_missing");
        return listOf(res, url, state.publicKeys.filter((k) => k.app_id === app.id));
      }

      // 권한
      if (route === "GET entitlements") return listOf(res, url, state.entitlements);
      if (route === "POST entitlements") {
        const err = shape(body, ["lookup_key", "display_name"], ["lookup_key", "display_name"]);
        if (err) return fail(res, 400, err);
        if (!str(body.lookup_key, 1, 200) || !str(body.display_name, 1, 1500)) return fail(res, 400, "invalid lengths");
        if (state.entitlements.some((e) => e.lookup_key === body.lookup_key)) return fail(res, 409, "already exists", "resource_already_exists");
        const entitlement = { object: "entitlement", id: rid("entl"), project_id: pid, lookup_key: body.lookup_key, display_name: body.display_name, state: "active", created_at: Date.now(), products: null };
        state.entitlements.push(entitlement);
        state.entitlementProducts.set(entitlement.id, new Set());
        return send(res, 201, entitlement);
      }
      if (route === "GET entitlements/:id/products") {
        const set = state.entitlementProducts.get(rest[1]);
        if (!set) return fail(res, 404, "entitlement not found", "resource_missing");
        return listOf(res, url, state.products.filter((p) => set.has(p.id)));
      }
      if (route === "POST entitlements/:id/actions/attach_products") {
        const set = state.entitlementProducts.get(rest[1]);
        if (!set) return fail(res, 404, "entitlement not found", "resource_missing");
        const err = shape(body, ["product_ids"], ["product_ids"]);
        if (err) return fail(res, 400, err);
        if (!Array.isArray(body.product_ids) || body.product_ids.length < 1 || body.product_ids.length > 50) return fail(res, 400, "product_ids must have 1-50 items");
        for (const id of body.product_ids) if (!state.products.some((p) => p.id === id)) return fail(res, 404, `product ${id} not found`, "resource_missing");
        for (const id of body.product_ids) set.add(id);
        return send(res, 200, state.entitlements.find((e) => e.id === rest[1]));
      }

      // 상품
      if (route === "GET products") return listOf(res, url, state.products);
      if (route === "POST products") {
        const err = shape(body, ["store_identifier", "app_id", "type", "display_name", "price_identifier", "subscription", "title"], ["store_identifier", "app_id", "type"]);
        if (err) return fail(res, 400, err);
        const app = state.apps.find((a) => a.id === body.app_id);
        if (!app) return fail(res, 404, "app not found", "resource_missing");
        if (!["subscription", "one_time", "consumable", "non_consumable", "non_renewing_subscription"].includes(body.type)) return fail(res, 400, "invalid type");
        if (!str(body.store_identifier, 1, 200)) return fail(res, 400, "invalid store_identifier");
        // 구글 정기 결제는 "정기 결제 아이디:기본 요금제 아이디" 형식이어야 한다.
        if (app.type === "play_store" && body.type === "subscription" && !/^[^:]+:[^:]+$/.test(body.store_identifier)) {
          return fail(res, 400, "Play Store subscriptions must use productId:basePlanId");
        }
        if (state.products.some((p) => p.app_id === app.id && p.store_identifier === body.store_identifier)) return fail(res, 409, "already exists", "resource_already_exists");
        const product = { object: "product", id: rid("prod"), store_identifier: body.store_identifier, type: body.type, app_id: app.id, display_name: body.display_name ?? null, state: "active", created_at: Date.now(), subscription: null, one_time: null };
        state.products.push(product);
        return send(res, 201, product);
      }

      // 오퍼링
      if (route === "GET offerings") return listOf(res, url, state.offerings);
      if (route === "POST offerings") {
        const err = shape(body, ["lookup_key", "display_name", "metadata"], ["lookup_key", "display_name"]);
        if (err) return fail(res, 400, err);
        if (state.offerings.some((o) => o.lookup_key === body.lookup_key)) return fail(res, 409, "already exists", "resource_already_exists");
        const offering = { object: "offering", id: rid("ofrng"), project_id: pid, lookup_key: body.lookup_key, display_name: body.display_name, is_current: false, state: "active", created_at: Date.now(), metadata: body.metadata ?? null, packages: null };
        state.offerings.push(offering);
        return send(res, 201, offering);
      }
      if (route === "POST offerings/:id") {
        const offering = state.offerings.find((o) => o.id === rest[1]);
        if (!offering) return fail(res, 404, "offering not found", "resource_missing");
        const err = shape(body, ["display_name", "is_current", "metadata"], []);
        if (err) return fail(res, 400, err);
        if (body.is_current === true) for (const o of state.offerings) o.is_current = o.id === offering.id;
        if (body.display_name) offering.display_name = body.display_name;
        return send(res, 200, offering);
      }

      // 패키지
      if (route === "GET offerings/:id/packages") {
        const expand = url.searchParams.getAll("expand").includes("items.product");
        return listOf(res, url, state.packages.filter((p) => p.offering_id === rest[1]).map((p) => packageView(p, expand)));
      }
      if (route === "POST offerings/:id/packages") {
        if (!state.offerings.some((o) => o.id === rest[1])) return fail(res, 404, "offering not found", "resource_missing");
        const err = shape(body, ["lookup_key", "display_name", "position"], ["lookup_key", "display_name"]);
        if (err) return fail(res, 400, err);
        if (body.position !== undefined && (!Number.isInteger(body.position) || body.position < 1 || body.position > 32767)) return fail(res, 400, "invalid position");
        if (state.packages.some((p) => p.offering_id === rest[1] && p.lookup_key === body.lookup_key)) return fail(res, 409, "already exists", "resource_already_exists");
        const pkg = { id: rid("pkge"), project_id: pid, offering_id: rest[1], lookup_key: body.lookup_key, display_name: body.display_name, position: body.position ?? null, created_at: Date.now(), attached: [] };
        state.packages.push(pkg);
        return send(res, 201, packageView(pkg, false));
      }
      if (route === "GET packages/:id/products") {
        const pkg = state.packages.find((p) => p.id === rest[1]);
        if (!pkg) return fail(res, 404, "package not found", "resource_missing");
        return listOf(res, url, packageView(pkg, true).products.items.map((item) => ({ ...item, id: item.product.id })));
      }
      if (route === "POST packages/:id/actions/attach_products") {
        const pkg = state.packages.find((p) => p.id === rest[1]);
        if (!pkg) return fail(res, 404, "package not found", "resource_missing");
        const err = shape(body, ["products"], ["products"]);
        if (err) return fail(res, 400, err);
        if (!Array.isArray(body.products) || body.products.length < 1 || body.products.length > 50) return fail(res, 400, "products must have 1-50 items");
        for (const item of body.products) {
          const itemErr = shape(item, ["product_id", "eligibility_criteria"], ["product_id", "eligibility_criteria"]);
          if (itemErr) return fail(res, 400, itemErr);
          if (!["all", "google_sdk_lt_6", "google_sdk_ge_6"].includes(item.eligibility_criteria)) return fail(res, 400, "invalid eligibility_criteria");
          if (!state.products.some((p) => p.id === item.product_id)) return fail(res, 404, "product not found", "resource_missing");
        }
        for (const item of body.products) pkg.attached.push({ product_id: item.product_id, eligibility_criteria: item.eligibility_criteria });
        return send(res, 200, packageView(pkg, true));
      }

      // 웹훅
      if (route === "GET integrations/webhooks") return listOf(res, url, state.webhooks.map(({ authorization_header, ...rest }) => rest));
      if (route === "POST integrations/webhooks") {
        const err = shape(body, ["name", "url", "authorization_header", "environment", "event_types", "app_id"], ["name", "url"]);
        if (err) return fail(res, 400, err);
        try {
          new URL(body.url);
        } catch {
          return fail(res, 400, "url must be a URI");
        }
        if (![undefined, null, "production", "sandbox"].includes(body.environment)) return fail(res, 400, "invalid environment");
        const hook = { object: "webhook_integration", id: rid("wh"), project_id: pid, name: body.name, url: body.url, environment: body.environment ?? null, event_types: body.event_types ?? null, app_id: body.app_id ?? null, authorization_header: body.authorization_header ?? null, created_at: Date.now() };
        state.webhooks.push(hook);
        const { authorization_header, ...view } = hook;
        return send(res, 201, view);
      }

      return fail(res, 404, `no mock route for ${route}`, "resource_missing");
    });
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

  return {
    state,
    url: `http://127.0.0.1:${port}/v2`,
    addApp,
    writes: () => state.requests.filter((r) => r.method !== "GET"),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
