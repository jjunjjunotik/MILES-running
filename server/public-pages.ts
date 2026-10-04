import { Router, type Request, type Response } from "express";
import {
  LEGAL_STATUS,
  LEGAL_UPDATED,
  LEGAL_UPDATED_KO,
  OPERATOR,
  legalDocs,
  type LegalDoc,
} from "../shared/legal.js";
import type { Locale } from "../shared/i18n.js";
import { pickLocale } from "./i18n.js";

/**
 * 스토어 등록에 필요한 공개 웹 페이지. 로그인 없이 누구나 열 수 있어야 한다.
 *
 *   /privacy          개인정보처리방침 (App Store · Google Play 필수)
 *   /terms            이용약관 (자동 갱신 구독이 있는 앱은 링크 필수)
 *   /delete-account   계정 삭제 방법 (Google Play 필수: 앱 밖에서도 삭제를 요청할 수 있어야 한다)
 *   /support          고객 지원 (App Store 필수)
 *
 * 본문은 앱 안의 약관과 같은 원본(shared/legal.ts)에서 만든다. 두 곳의 내용이 어긋나지 않게.
 * 언어: ?lang=ko | ?lang=en, 없으면 브라우저 언어.
 */

export const publicPages = Router();

const escape = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

function localeOf(req: Request): Locale {
  const lang = req.query.lang;
  if (lang === "ko" || lang === "en") return lang;
  return pickLocale(req);
}

const STYLE = `
  :root { color-scheme: light dark; --bg:#f4f5f7; --fg:#15171a; --muted:#5b616b; --line:#dde0e5; --accent:#2f4fd1; --note:#fff6e0; --note-fg:#5a4500; }
  @media (prefers-color-scheme: dark) { :root { --bg:#111316; --fg:#eceef1; --muted:#a2a8b2; --line:#2a2e34; --accent:#8ea2ff; --note:#2d2614; --note-fg:#f1d58a; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif; }
  :lang(ko) body { word-break: keep-all; }
  main { max-width: 720px; margin: 0 auto; padding: 32px 16px 64px; }
  header { display:flex; justify-content:space-between; align-items:baseline; gap:12px; flex-wrap:wrap; }
  .brand { font-weight:600; letter-spacing:-0.01em; }
  nav a { color:var(--muted); margin-left:12px; font-size:14px; }
  h1 { font-size: 28px; line-height:1.2; margin: 28px 0 6px; letter-spacing:-0.02em; }
  h2 { font-size: 18px; margin: 28px 0 8px; }
  .meta { color: var(--muted); font-size: 14px; margin: 0 0 20px; }
  .note { background: var(--note); color: var(--note-fg); padding: 12px 14px; border-radius: 12px; font-size: 14px; }
  a { color: var(--accent); }
  ol, ul { padding-left: 22px; }
  li { margin: 4px 0; }
  footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid var(--line); color: var(--muted); font-size: 14px; }
`;

function page(
  req: Request,
  res: Response,
  locale: Locale,
  title: string,
  body: string,
): void {
  const path = req.path;
  const other = locale === "ko" ? "en" : "ko";
  const t = (en: string, ko: string) => (locale === "ko" ? ko : en);
  const links = [
    ["/privacy", t("Privacy", "개인정보")],
    ["/terms", t("Terms", "약관")],
    ["/delete-account", t("Delete account", "계정 삭제")],
    ["/support", t("Support", "지원")],
  ]
    .map(([href, label]) => `<a href="${href}?lang=${locale}">${escape(label!)}</a>`)
    .join("");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  // ?lang 이 없으면 브라우저 언어에 따라 내용이 달라진다.
  res.setHeader("Vary", "Accept-Language");
  res.send(`<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} · NailSense</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<header><span class="brand">NailSense</span><nav>${links}</nav></header>
${body}
<footer>
<a href="${escape(path)}?lang=${other}">${other === "ko" ? "한국어" : "English"}</a>
· ${escape(OPERATOR.name)} · ${escape(OPERATOR.supportEmail)}
</footer>
</main>
</body>
</html>`);
}

function draftNote(locale: Locale): string {
  if (LEGAL_STATUS !== "draft") return "";
  return `<p class="note">${
    locale === "ko"
      ? "법률 검토 전 초안입니다. 아직 확정되지 않았고 시행 전이에요."
      : "Draft for legal review. This text isn't final and isn't in effect yet."
  }</p>`;
}

function renderDoc(doc: LegalDoc, locale: Locale): string {
  const sections = doc.sections
    .map((section) => {
      const paragraphs = (section.paragraphs ?? []).map((text) => `<p>${escape(text)}</p>`).join("");
      const bullets = section.bullets
        ? `<ul>${section.bullets.map((text) => `<li>${escape(text)}</li>`).join("")}</ul>`
        : "";
      const after = (section.after ?? []).map((text) => `<p>${escape(text)}</p>`).join("");
      return `<section><h2>${escape(section.heading)}</h2>${paragraphs}${bullets}${after}</section>`;
    })
    .join("");
  const updated = locale === "ko" ? `최종 수정 ${LEGAL_UPDATED_KO}` : `Last updated ${LEGAL_UPDATED}`;
  return `${draftNote(locale)}<h1>${escape(doc.title)}</h1><p class="meta">${escape(updated)}</p><p>${escape(doc.intro)}</p>${sections}`;
}

publicPages.get("/privacy", (req, res) => {
  const locale = localeOf(req);
  const doc = legalDocs(locale).privacy;
  page(req, res, locale, doc.title, renderDoc(doc, locale));
});

publicPages.get("/terms", (req, res) => {
  const locale = localeOf(req);
  const doc = legalDocs(locale).terms;
  page(req, res, locale, doc.title, renderDoc(doc, locale));
});

publicPages.get("/delete-account", (req, res) => {
  const locale = localeOf(req);
  const email = escape(OPERATOR.email);
  const body =
    locale === "ko"
      ? `<h1>NailSense 계정 삭제</h1>
<p class="meta">NailSense 앱의 계정과 데이터를 지우는 방법입니다.</p>
<h2>앱에서 바로 지우기</h2>
<ol>
<li>NailSense 앱을 열고 로그인합니다.</li>
<li>아래쪽 <strong>프로필</strong> 탭으로 갑니다.</li>
<li><strong>계정 삭제</strong>를 누르고, 비밀번호(소셜 로그인 계정은 이메일)를 입력해 확인합니다.</li>
</ol>
<p>앱을 지웠거나 쓸 수 없다면, 이 웹사이트의 첫 화면에서 같은 계정으로 로그인한 뒤 프로필 › 계정 삭제를 눌러도 됩니다.</p>
<h2>이메일로 요청하기</h2>
<p>로그인할 수 없으면 계정에 쓰던 이메일 주소로 <a href="mailto:${email}?subject=Account%20deletion">${email}</a> 에 "계정 삭제"라고 보내 주세요. 본인 확인 뒤 지체 없이(늦어도 30일 안에) 지우고 알려 드립니다.</p>
<h2>지워지는 것</h2>
<ul>
<li>계정 정보(이메일, 이름, 비밀번호 해시, 구글·애플 연결 정보)와 설정</li>
<li>모든 분석 결과와 메모, 건강 정보 처리 동의 기록, 로그인 세션</li>
<li>계정에 묶인 사용 횟수 기록과 구독 상태 기록. 결제 확인 업체(RevenueCat)에도 고객 기록 삭제를 요청합니다.</li>
<li>사진은 원래 서버에 저장하지 않습니다. 기기 안에 저장한 사진은 앱을 지우거나 프로필에서 지우면 사라집니다.</li>
</ul>
<h2>남는 것</h2>
<ul>
<li>App Store · Google Play 의 구매 기록은 Apple · Google 이 각자의 정책에 따라 보관합니다.</li>
<li>서버 백업에 남은 사본은 며칠 안에 순서대로 덮어써져 사라집니다.</li>
</ul>
<p class="note"><strong>구독 중이라면:</strong> 계정을 지워도 App Store · Google Play 구독은 해지되지 않습니다. 먼저 기기의 스토어 구독 메뉴에서 해지해 주세요.</p>`
      : `<h1>Delete your NailSense account</h1>
<p class="meta">How to delete your NailSense account and data.</p>
<h2>In the app</h2>
<ol>
<li>Open the NailSense app and log in.</li>
<li>Go to the <strong>Profile</strong> tab.</li>
<li>Tap <strong>Delete account</strong> and confirm with your password (or your email, for Google or Apple sign-in).</li>
</ol>
<p>If you no longer have the app, log in on this website's home page with the same account and go to Profile › Delete account.</p>
<h2>By email</h2>
<p>If you can't log in, email <a href="mailto:${email}?subject=Account%20deletion">${email}</a> from the address on your account with the subject "Account deletion". We'll verify it's you and delete your account without undue delay, within 30 days at most, and let you know.</p>
<h2>What we delete</h2>
<ul>
<li>Your account details (email, name, password hash, Google or Apple link) and settings.</li>
<li>All analysis results and notes, your health data consent records, and your login sessions.</li>
<li>Scan counters and subscription status tied to your account. We also ask RevenueCat, which verifies store purchases for us, to delete its record of you.</li>
<li>Photos are never stored on our server. Photos saved on your device are removed when you delete them in Profile or uninstall the app.</li>
</ul>
<h2>What we keep</h2>
<ul>
<li>App Store and Google Play purchase records are kept by Apple and Google under their own policies.</li>
<li>Copies in server backups are overwritten within a few days.</li>
</ul>
<p class="note"><strong>If you subscribe:</strong> deleting your account doesn't cancel an App Store or Google Play subscription. Cancel it first in your device's store subscriptions.</p>`;
  page(req, res, locale, locale === "ko" ? "계정 삭제" : "Delete account", body);
});

publicPages.get("/support", (req, res) => {
  const locale = localeOf(req);
  const email = escape(OPERATOR.supportEmail);
  const body =
    locale === "ko"
      ? `<h1>NailSense 고객 지원</h1>
<p>문의는 <a href="mailto:${email}">${email}</a> 로 보내 주세요. 보통 영업일 기준 2일 안에 답장합니다.</p>
<p class="note">NailSense는 사진 속 손톱의 겉모습을 설명하는 참고용 앱이며 의료기기가 아닙니다. 질병을 진단하지 않습니다. 걱정되는 변화가 있으면 의사와 상담하고, 응급 상황이면 119에 연락하세요.</p>
<h2>구독을 해지하려면?</h2>
<p>아이폰: 설정 › 내 이름 › 구독. 안드로이드: Google Play › 프로필 › 결제 및 구독 › 구독. 앱의 프로필 › 요금제 › 구독 관리·해지에서도 바로 갈 수 있어요.</p>
<h2>기기를 바꿨는데 Pro가 안 보여요</h2>
<p>같은 계정으로 로그인한 뒤 프로필 › 요금제 › 구매 복원을 눌러 주세요.</p>
<h2>환불은?</h2>
<p>App Store · Google Play 결제는 Apple · Google 이 환불 정책에 따라 처리합니다. 아이폰은 reportaproblem.apple.com, 안드로이드는 Google Play 주문 내역에서 요청할 수 있어요.</p>
<h2>계정을 지우려면?</h2>
<p><a href="/delete-account?lang=ko">계정 삭제 안내</a>를 봐 주세요.</p>`
      : `<h1>NailSense support</h1>
<p>Email us at <a href="mailto:${email}">${email}</a>. We usually reply within 2 business days.</p>
<p class="note">NailSense describes how a nail looks in a photo for reference. It is not a medical device and does not diagnose any condition. If you're worried about a change, see a doctor. In an emergency, call your local emergency number.</p>
<h2>How do I cancel my subscription?</h2>
<p>iPhone: Settings › your name › Subscriptions. Android: Google Play › Profile › Payments &amp; subscriptions › Subscriptions. You can also go there from Profile › Plan › Manage or cancel subscription in the app.</p>
<h2>I changed phones and don't see Pro</h2>
<p>Log in with the same account, then tap Profile › Plan › Restore purchases.</p>
<h2>Refunds</h2>
<p>Apple and Google handle refunds for App Store and Google Play purchases under their policies. On iPhone, use reportaproblem.apple.com. On Android, use your Google Play order history.</p>
<h2>How do I delete my account?</h2>
<p>See <a href="/delete-account?lang=en">how to delete your account</a>.</p>`;
  page(req, res, locale, locale === "ko" ? "고객 지원" : "Support", body);
});
