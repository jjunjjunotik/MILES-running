/**
 * RevenueCat 설정 도구. 이 앱이 쓰는 결제 구성이 RevenueCat 프로젝트에 다 있는지 확인하고,
 * --apply 를 붙이면 빠진 것을 만든다.
 *
 *   npm run revenuecat                 # 확인만 한다(아무것도 바꾸지 않음)
 *   npm run revenuecat -- --apply      # 빠진 앱·권한·상품·오퍼링·패키지·웹훅을 만든다
 *
 * 만드는 구성
 *   앱        App Store 앱(번들 아이디 = capacitor.config.ts 의 appId), Play Store 앱(패키지 이름 = 같은 값)
 *   권한      pro                                   (서버의 REVENUECAT_ENTITLEMENT 와 같아야 한다)
 *   상품      App Store   nailsense_pro_monthly, nailsense_pro_yearly
 *             Google Play nailsense_pro_monthly:monthly, nailsense_pro_yearly:yearly   (정기 결제 아이디:기본 요금제)
 *   오퍼링    default (현재 오퍼링) — 패키지 $rc_monthly(월간), $rc_annual(연간)
 *   웹훅      <서버>/api/billing/store-webhook, Authorization = REVENUECAT_WEBHOOK_AUTH
 *
 * 필요한 값(.env 또는 환경변수). 값은 화면에 찍지 않는다.
 *   REVENUECAT_V2_KEY        설정용 v2 비밀키. 이 컴퓨터에서만 쓰고 서버에는 넣지 않는다(설정이 끝나면 지워도 된다).
 *   REVENUECAT_PROJECT_ID    (선택) 키로 여러 프로젝트가 보일 때
 *   APP_API_BASE             (선택) 서버 주소. 기본 https://nailsense.fly.dev
 *   REVENUECAT_WEBHOOK_AUTH  웹훅 인증값. 서버에 넣은 값과 같아야 한다
 *   REVENUECAT_SECRET_KEY    (선택) 서버용 v1 비밀키. 맞는 키인지 확인한다
 *   APPSTORE_PRODUCT_MONTHLY · APPSTORE_PRODUCT_YEARLY · PLAY_PRODUCT_MONTHLY · PLAY_PRODUCT_YEARLY
 *                            (선택) 상품 아이디를 바꿀 때
 *
 * 스토어에 상품과 가격을 만드는 일, 스토어 자격증명(App Store Connect 키, Play 서비스 계정)을
 * RevenueCat 에 연결하는 일은 이 도구가 하지 않는다. 끝에 남은 할 일로 알려 준다.
 */
import fs from "node:fs";

const ENV_FILE = process.env.ENV_FILE ?? ".env";
if (fs.existsSync(ENV_FILE)) {
  try {
    process.loadEnvFile(ENV_FILE);
  } catch {
    console.error(`${ENV_FILE} 을 읽지 못했습니다. 형식을 확인하세요.`);
    process.exit(2);
  }
}

const APPLY = process.argv.includes("--apply");
const env = (name) => (process.env[name] ?? "").trim();

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
/** 테스트용 가짜 서버 주소는 같은 기기(루프백)만 받는다. 키가 엉뚱한 곳으로 가지 않게. */
function base(override, fallback) {
  if (!override) return fallback;
  try {
    if (LOOPBACK.has(new URL(override).hostname)) return override.replace(/\/+$/, "");
  } catch {}
  console.error(`테스트 주소는 같은 기기 주소만 쓸 수 있습니다: ${override}`);
  process.exit(2);
}
const V2 = base(env("REVENUECAT_V2_URL"), "https://api.revenuecat.com/v2");
const V1 = base(env("REVENUECAT_API_URL"), "https://api.revenuecat.com");

const APP_ID = /appId:\s*"([^"]+)"/.exec(fs.readFileSync("capacitor.config.ts", "utf8"))?.[1];
const SERVER = (env("APP_API_BASE") || "https://nailsense.fly.dev").replace(/\/+$/, "");
const WEBHOOK_URL = `${SERVER}/api/billing/store-webhook`;
const ENTITLEMENT = env("REVENUECAT_ENTITLEMENT") || "pro";
const OFFERING = "default";
const PLANS = [
  {
    key: "$rc_monthly",
    label: "월간",
    name: "Monthly",
    position: 1,
    app_store: env("APPSTORE_PRODUCT_MONTHLY") || "nailsense_pro_monthly",
    play_store: env("PLAY_PRODUCT_MONTHLY") || "nailsense_pro_monthly:monthly",
    display: "NailSense Pro Monthly",
  },
  {
    key: "$rc_annual",
    label: "연간",
    name: "Yearly",
    position: 2,
    app_store: env("APPSTORE_PRODUCT_YEARLY") || "nailsense_pro_yearly",
    play_store: env("PLAY_PRODUCT_YEARLY") || "nailsense_pro_yearly:yearly",
    display: "NailSense Pro Yearly",
  },
];
const STORES = [
  { type: "app_store", label: "App Store", field: "bundle_id", envKey: "REVENUECAT_IOS_KEY", keyPrefix: "appl_" },
  { type: "play_store", label: "Google Play", field: "package_name", envKey: "REVENUECAT_ANDROID_KEY", keyPrefix: "goog_" },
];

/* --------------------------------- 출력 --------------------------------- */

let missing = 0;
let changed = 0;
const ok = (text) => console.log(`  ✓ ${text}`);
const made = (text) => {
  changed += 1;
  console.log(`  + ${text}`);
};
const lack = (text) => {
  missing += 1;
  console.log(`  ✗ ${text}`);
};
const note = (text) => console.log(`  ! ${text}`);
const todo = [];

/* ------------------------------- API 호출 ------------------------------- */

class ApiError extends Error {
  constructor(status, method, path, detail) {
    super(`${method} ${path} → ${status}${detail ? `: ${detail}` : ""}`);
    this.status = status;
  }
}

const KEY = env("REVENUECAT_V2_KEY");
const SECRETS = [KEY, env("REVENUECAT_SECRET_KEY"), env("REVENUECAT_WEBHOOK_AUTH")].filter(Boolean);
/** 오류 문구에 비밀값이 섞여도 찍히지 않게 지운다. */
const scrub = (text) => SECRETS.reduce((out, secret) => out.split(secret).join("***"), String(text));

async function call(method, path, body, { baseUrl = V2, key = KEY } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    let response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${key}`,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new ApiError(0, method, path, "연결하지 못했습니다");
    }
    // 설정 API 는 분당 60회로 제한된다. 기다리라고 하면 기다렸다 다시 한다.
    if (response.status === 429 && attempt < 3) {
      const wait = Math.min(Number(response.headers.get("retry-after")) || 5, 60);
      note(`요청이 많아 ${wait}초 기다립니다`);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {}
    if (!response.ok) {
      throw new ApiError(response.status, method, path, scrub(json?.message ?? text.slice(0, 200)));
    }
    return json;
  }
}

/** 목록을 끝까지 넘겨 가며 모두 가져온다. */
async function list(path, query = {}) {
  const items = [];
  let after = null;
  for (let page = 0; page < 100; page += 1) {
    const params = new URLSearchParams({ limit: "100", ...query });
    if (after) params.set("starting_after", after);
    const body = await call("GET", `${path}?${params}`);
    const pageItems = body?.items ?? [];
    items.push(...pageItems);
    if (!body?.next_page || pageItems.length === 0) break;
    after = pageItems.at(-1).id;
  }
  return items;
}

const mask = (value) => (value.length > 12 ? `${value.slice(0, 9)}…` : "…");

/* --------------------------------- 단계 --------------------------------- */

async function chooseProject() {
  console.log("프로젝트");
  const projects = await list("/projects");
  const wanted = env("REVENUECAT_PROJECT_ID");
  const project = wanted ? projects.find((p) => p.id === wanted) : projects.length === 1 ? projects[0] : null;
  if (!project) {
    if (projects.length === 0) throw new Error("이 키로 볼 수 있는 프로젝트가 없습니다. 키를 만든 프로젝트를 확인하세요.");
    console.log("  여러 프로젝트가 보입니다. REVENUECAT_PROJECT_ID 로 하나를 고르세요:");
    for (const p of projects) console.log(`    ${p.id}  ${p.name}`);
    throw new Error("프로젝트를 고르지 않았습니다.");
  }
  ok(`${project.name} (${project.id})`);
  return project.id;
}

async function ensureApps(pid) {
  console.log("앱");
  if (!APP_ID) throw new Error("capacitor.config.ts 에서 appId 를 찾지 못했습니다.");
  const apps = await list(`/projects/${pid}/apps`);
  const found = {};
  for (const store of STORES) {
    const candidates = apps.filter((app) => app.type === store.type);
    let app = candidates.find((a) => a[store.type]?.[store.field] === APP_ID);
    if (app) {
      ok(`${store.label} 앱 "${app.name}" (${APP_ID})`);
    } else if (candidates.length > 0) {
      // 앱 아이디가 다른 앱에 상품을 만들면 구매가 이 앱과 이어지지 않는다. 손대지 않고 알린다.
      const other = candidates.map((a) => a[store.type]?.[store.field] ?? "(없음)").join(", ");
      lack(`${store.label} 앱의 ${store.field} 가 ${other} 입니다. 앱 아이디 ${APP_ID} 와 달라 이 앱의 상품을 만들지 않았습니다`);
      todo.push(`RevenueCat › Apps 에서 ${store.label} 앱의 ${store.field} 를 ${APP_ID} 로 맞추기(앱 아이디를 바꿨다면 npm run set-app-id 로 맞추기)`);
      continue;
    } else if (APPLY) {
      app = await call("POST", `/projects/${pid}/apps`, {
        name: `NailSense (${store.type === "app_store" ? "iOS" : "Android"})`,
        type: store.type,
        [store.type]: { [store.field]: APP_ID },
      });
      made(`${store.label} 앱을 만들었습니다 (${APP_ID})`);
    } else {
      lack(`${store.label} 앱이 없습니다`);
      continue;
    }
    found[store.type] = app;
  }
  return found;
}

async function checkPublicKeys(pid, apps) {
  console.log("앱용 공개 키");
  for (const store of STORES) {
    const app = apps[store.type];
    if (!app) continue;
    const keys = await list(`/projects/${pid}/apps/${app.id}/public_api_keys`);
    const production = keys.find((k) => k.environment === "production") ?? keys[0];
    if (!production) {
      lack(`${store.label} 앱의 공개 키를 찾지 못했습니다`);
      continue;
    }
    const current = env(store.envKey);
    if (current === production.key) {
      ok(`${store.envKey} 가 ${store.label} 앱의 공개 키와 같습니다`);
    } else {
      // 공개 키는 앱에 들어가는 값이라 화면에 보여도 된다.
      lack(`${store.envKey} 를 ${production.key} 로 넣으세요${current ? ` (지금 값 ${mask(current)} 은 다릅니다)` : ""}`);
    }
  }
}

async function ensureEntitlement(pid) {
  console.log(`권한 ${ENTITLEMENT}`);
  const entitlements = await list(`/projects/${pid}/entitlements`);
  let entitlement = entitlements.find((e) => e.lookup_key === ENTITLEMENT);
  if (entitlement) {
    ok(`있음 (${entitlement.id})`);
  } else if (APPLY) {
    entitlement = await call("POST", `/projects/${pid}/entitlements`, {
      lookup_key: ENTITLEMENT,
      display_name: "NailSense Pro",
    });
    made(`권한 ${ENTITLEMENT} 를 만들었습니다`);
  } else {
    lack(`권한 ${ENTITLEMENT} 가 없습니다`);
  }
  return entitlement ?? null;
}

async function ensureProducts(pid, apps) {
  console.log("상품");
  const products = await list(`/projects/${pid}/products`);
  const result = {}; // [plan.key][store.type] = product
  for (const plan of PLANS) {
    result[plan.key] = {};
    for (const store of STORES) {
      const app = apps[store.type];
      const identifier = plan[store.type];
      if (!app) {
        lack(`${store.label} ${plan.label} 상품: 앱이 없어 만들 수 없습니다`);
        continue;
      }
      let product = products.find((p) => p.app_id === app.id && p.store_identifier === identifier);
      if (product) {
        ok(`${store.label} ${plan.label} ${identifier}`);
      } else if (APPLY) {
        product = await call("POST", `/projects/${pid}/products`, {
          store_identifier: identifier,
          app_id: app.id,
          type: "subscription",
          display_name: plan.display,
        });
        made(`${store.label} ${plan.label} 상품 ${identifier} 를 만들었습니다`);
      } else {
        lack(`${store.label} ${plan.label} 상품 ${identifier} 가 없습니다`);
      }
      if (product) result[plan.key][store.type] = product;
    }
  }
  return result;
}

async function attachToEntitlement(pid, entitlement, products) {
  if (!entitlement) return;
  console.log(`권한 ${ENTITLEMENT} 에 붙은 상품`);
  const attached = new Set((await list(`/projects/${pid}/entitlements/${entitlement.id}/products`)).map((p) => p.id));
  const wanted = Object.values(products).flatMap((byStore) => Object.values(byStore));
  if (wanted.length === 0) return;
  const toAttach = wanted.filter((p) => !attached.has(p.id));
  if (toAttach.length === 0) {
    ok(`상품 ${wanted.length}개가 모두 붙어 있습니다`);
  } else if (APPLY) {
    await call("POST", `/projects/${pid}/entitlements/${entitlement.id}/actions/attach_products`, {
      product_ids: toAttach.map((p) => p.id),
    });
    made(`상품 ${toAttach.length}개를 권한에 붙였습니다`);
  } else {
    lack(`권한에 붙지 않은 상품 ${toAttach.length}개: ${toAttach.map((p) => p.store_identifier).join(", ")}`);
  }
}

async function ensureOffering(pid) {
  console.log(`오퍼링 ${OFFERING}`);
  const offerings = await list(`/projects/${pid}/offerings`);
  let offering = offerings.find((o) => o.lookup_key === OFFERING);
  if (offering) {
    ok(`있음 (${offering.id})`);
  } else if (APPLY) {
    offering = await call("POST", `/projects/${pid}/offerings`, {
      lookup_key: OFFERING,
      display_name: "NailSense Pro",
    });
    made(`오퍼링 ${OFFERING} 를 만들었습니다`);
  } else {
    lack(`오퍼링 ${OFFERING} 가 없습니다`);
    return null;
  }
  if (offering.is_current) {
    ok("앱이 보여 줄 현재(current) 오퍼링입니다");
  } else {
    const current = offerings.find((o) => o.is_current);
    const before = current ? ` (지금은 "${current.lookup_key}" 가 현재 오퍼링)` : "";
    if (APPLY) {
      offering = await call("POST", `/projects/${pid}/offerings/${offering.id}`, { is_current: true });
      made(`현재 오퍼링으로 정했습니다${before}`);
    } else {
      lack(`현재(current) 오퍼링이 아닙니다${before}. 앱은 현재 오퍼링의 상품을 보여 줍니다`);
    }
  }
  return offering;
}

async function ensurePackages(pid, offering, products) {
  if (!offering) return;
  console.log("패키지");
  const packages = await list(`/projects/${pid}/offerings/${offering.id}/packages`, { expand: "items.product" });
  for (const plan of PLANS) {
    let pkg = packages.find((p) => p.lookup_key === plan.key);
    if (pkg) {
      ok(`${plan.label} ${plan.key}`);
    } else if (APPLY) {
      pkg = await call("POST", `/projects/${pid}/offerings/${offering.id}/packages`, {
        lookup_key: plan.key,
        display_name: plan.name,
        position: plan.position,
      });
      made(`${plan.label} 패키지 ${plan.key} 를 만들었습니다`);
    } else {
      lack(`${plan.label} 패키지 ${plan.key} 가 없습니다`);
      continue;
    }
    const attachedItems = pkg.products?.items ?? (await list(`/projects/${pid}/packages/${pkg.id}/products`));
    const attached = new Set(attachedItems.map((item) => item.product?.id ?? item.id));
    const wanted = Object.values(products[plan.key] ?? {});
    const toAttach = wanted.filter((p) => !attached.has(p.id));
    if (toAttach.length === 0) {
      if (wanted.length > 0) ok(`${plan.label} 패키지에 상품 ${wanted.length}개`);
    } else if (APPLY) {
      await call("POST", `/projects/${pid}/packages/${pkg.id}/actions/attach_products`, {
        products: toAttach.map((p) => ({ product_id: p.id, eligibility_criteria: "all" })),
      });
      made(`${plan.label} 패키지에 상품 ${toAttach.length}개를 붙였습니다`);
    } else {
      lack(`${plan.label} 패키지에 붙지 않은 상품: ${toAttach.map((p) => p.store_identifier).join(", ")}`);
    }
  }
}

async function ensureWebhook(pid) {
  console.log("웹훅");
  if (!/^https:\/\//.test(WEBHOOK_URL)) {
    note(`웹훅 주소 ${WEBHOOK_URL} 는 https 가 아닙니다. RevenueCat 은 인터넷에서 닿는 https 주소로만 보냅니다`);
  }
  const hooks = await list(`/projects/${pid}/integrations/webhooks`);
  const hook = hooks.find((h) => h.url === WEBHOOK_URL);
  const auth = env("REVENUECAT_WEBHOOK_AUTH");
  if (hook) {
    ok(`${WEBHOOK_URL}`);
    if (hook.environment) note(`이 웹훅은 ${hook.environment} 환경 이벤트만 받습니다(심사용 sandbox 구매도 받으려면 둘 다로)`);
    todo.push("RevenueCat › Integrations › Webhooks 에서 Authorization 값이 서버의 REVENUECAT_WEBHOOK_AUTH 와 같은지 확인하고 Send test event 로 시험");
    return;
  }
  if (auth.length < 16) {
    lack(`웹훅이 없습니다. 먼저 REVENUECAT_WEBHOOK_AUTH 를 16자 이상 무작위 값으로 정하세요(예: openssl rand -hex 32)`);
    return;
  }
  if (APPLY) {
    await call("POST", `/projects/${pid}/integrations/webhooks`, {
      name: "NailSense server",
      url: WEBHOOK_URL,
      authorization_header: auth,
      environment: null,
      event_types: null,
      app_id: null,
    });
    made(`웹훅 ${WEBHOOK_URL} 를 만들었습니다(인증값은 REVENUECAT_WEBHOOK_AUTH)`);
  } else {
    lack(`웹훅 ${WEBHOOK_URL} 가 없습니다`);
  }
}

async function checkServerKey() {
  console.log("서버용 v1 비밀키");
  const key = env("REVENUECAT_SECRET_KEY");
  if (!key) {
    lack("REVENUECAT_SECRET_KEY 가 없습니다(서버가 구매를 확인할 때 씀. RevenueCat › API keys › Secret API key, V1)");
    return;
  }
  if (!key.startsWith("sk_")) note("REVENUECAT_SECRET_KEY 는 보통 sk_ 로 시작합니다");
  // 없는 손님 아이디로 한 번 묻고 바로 지운다. RevenueCat 에 흔적을 남기지 않는다.
  const probe = encodeURIComponent("$RCAnonymousID:nailsense-setup-check");
  try {
    await call("GET", `/v1/subscribers/${probe}`, undefined, { baseUrl: V1, key });
    await call("DELETE", `/v1/subscribers/${probe}`, undefined, { baseUrl: V1, key }).catch(() => undefined);
    ok("서버가 RevenueCat 에 구독 상태를 물어볼 수 있습니다");
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      lack("REVENUECAT_SECRET_KEY 가 받아들여지지 않습니다. v1 비밀키(sk_…)인지 확인하세요(v2 키는 서버에서 쓸 수 없음)");
    } else {
      lack(`v1 비밀키 확인 실패: ${err.message}`);
    }
  }
}

/* --------------------------------- 실행 --------------------------------- */

console.log(`RevenueCat 설정 ${APPLY ? "— 빠진 것 만들기(--apply)" : "— 확인만 (만들려면 -- --apply)"}`);
console.log(`앱 아이디 ${APP_ID ?? "?"} · 서버 ${SERVER}\n`);

if (!KEY) {
  console.error(
    "REVENUECAT_V2_KEY 가 없습니다.\n" +
      "RevenueCat › Project settings › API keys › + New secret API key 에서 API version 을 V2 로,\n" +
      "Project configuration 권한을 Read & write 로 골라 만든 뒤 .env 에 REVENUECAT_V2_KEY=... 로 넣으세요.\n" +
      "(이 키는 이 컴퓨터에서 설정할 때만 씁니다. 서버에는 넣지 않습니다.)",
  );
  process.exit(2);
}

let failed = false;
try {
  const pid = await chooseProject();
  const apps = await ensureApps(pid);
  await checkPublicKeys(pid, apps);
  const entitlement = await ensureEntitlement(pid);
  const products = await ensureProducts(pid, apps);
  await attachToEntitlement(pid, entitlement, products);
  const offering = await ensureOffering(pid);
  await ensurePackages(pid, offering, products);
  await ensureWebhook(pid);
  await checkServerKey();
} catch (err) {
  failed = true;
  const message = scrub(err.message);
  console.error(`\n멈췄습니다: ${message}`);
  if (err.status === 401) console.error("키가 맞지 않습니다. REVENUECAT_V2_KEY 가 v2 비밀키인지 확인하세요.");
  if (err.status === 403) console.error("키 권한이 모자랍니다. v2 키에 Project configuration 읽기(만들려면 쓰기) 권한을 주세요.");
}

console.log("");
if (!failed) {
  if (changed > 0) console.log(`만든 것 ${changed}개.`);
  console.log(missing === 0 ? "RevenueCat 설정이 다 되어 있습니다." : `빠진 것 ${missing}개.${APPLY ? "" : " npm run revenuecat -- --apply 로 만들 수 있는 것은 만들어 줍니다."}`);
}
const [monthly, yearly] = PLANS;
const remaining = [
  ...new Set(todo),
  "RevenueCat › Apps › App Store 앱: In-App Purchase Key(.p8)와 App Store Connect API 키 연결(구매 확인에 필요)",
  "RevenueCat › Apps › Play Store 앱: Google Play 서비스 계정 JSON 연결(구매 확인에 필요)",
  `App Store Connect: 구독 그룹 "NailSense Pro" 에 ${monthly.app_store} · ${yearly.app_store} 상품, 가격, 무료 체험`,
  `Google Play Console: 정기 결제 ${monthly.play_store.replace(":", "(기본 요금제 ")}) · ${yearly.play_store.replace(":", "(기본 요금제 ")}) 와 가격`,
  "서버 비밀값: REVENUECAT_SECRET_KEY · REVENUECAT_WEBHOOK_AUTH · REVENUECAT_IOS_KEY · REVENUECAT_ANDROID_KEY (fly secrets set …)",
];
console.log("\n이 도구가 대신할 수 없는 일(아직 안 했다면):");
for (const item of remaining) console.log(`  - ${item}`);
// 빠진 것이 하나도 없을 때만 0. 그래야 배포 전에 점검으로 쓸 수 있다.
process.exit(!failed && missing === 0 ? 0 : 1);
