/**
 * 개인정보처리방침과 이용약관 초안.
 *
 * 주의: 변호사 검토 전 초안이다. LEGAL_STATUS 가 "draft" 인 동안 화면에 "검토 전 초안"
 * 표시가 붙는다. 검토를 마치면 문구를 고치고, 아래 OPERATOR 의 빈칸을 채우고,
 * LEGAL_STATUS 를 "final" 로, LEGAL_UPDATED 를 시행일로 바꾼다.
 *
 * 내용은 이 앱이 실제로 하는 일과 어긋나면 안 된다. 데이터 처리 방식을 바꾸면 여기도 고친다.
 * (사진 서버 비저장, 쿠키 두 개, 해시만 남기는 사용량, 결제는 Paddle 등)
 */

import type { Locale } from "./i18n.js";

export const LEGAL_STATUS: "draft" | "final" = "draft";
export const LEGAL_UPDATED = "October 4, 2026";
export const LEGAL_UPDATED_KO = "2026년 10월 4일";

/** 운영자 정보. 출시 전에 반드시 채운다. */
export const OPERATOR = {
  name: "[Operator legal name]",
  address: "[Postal address]",
  email: "[privacy contact email]",
  supportEmail: "[support email]",
  governingLaw: "[Governing law and venue]",
  euRepresentative: "[EU representative, if required]",
  ukRepresentative: "[UK representative, if required]",
  /** 한국 개인정보보호법: 개인정보 보호책임자와 국내대리인 */
  privacyOfficerKo: "[개인정보 보호책임자 이름·직책·연락처]",
  domesticAgentKo: "[국내대리인(해당하는 경우) 이름·주소·연락처]",
};

export interface LegalSection {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
  /** 목록 뒤에 오는 문단 */
  after?: string[];
}

export interface LegalDoc {
  id: "privacy" | "terms";
  title: string;
  intro: string;
  sections: LegalSection[];
}

export const PRIVACY_POLICY: LegalDoc = {
  id: "privacy",
  title: "Privacy Policy",
  intro: `This policy explains what NailSense collects, why, and what you can do about it. NailSense is operated by ${OPERATOR.name} ("we", "us"). A nail photo and the description of it can reveal information about your health, so we treat them as health data.`,
  sections: [
    {
      heading: "What we collect",
      bullets: [
        "Nail photos you choose to analyze, and the optional note you add.",
        "The results of each analysis.",
        "If you create an account: your email address, a display name if you give one, and your settings. Passwords are stored only as a salted hash. If you sign in with Google or Apple, we store the account identifier they give us.",
        "If you subscribe: your plan, its status and renewal dates, and the customer ID from our payment provider. We never see or store your card details.",
        "For free scan limits: a random identifier stored in a cookie on your device, and a one-way hash of your IP address that changes every month. We use these only to count scans.",
        "Your consent to health data processing: when you gave it and which version of the wording you agreed to.",
      ],
    },
    {
      heading: "How your photo is handled",
      bullets: [
        "When you tap Analyze, the photo is sent to our server and passed to our AI analysis provider to create the description.",
        "We do not store the photo on our server. It is discarded once the analysis is complete.",
        "If \"Save analyzed photos\" is on, the photo is kept only in this browser on your device. You can turn this off or delete saved photos in Profile.",
        "If you're logged in, the results (not the photo) are saved to your account. If you're not logged in, results stay on this device.",
        "Share cards include a summary only, never your photo.",
      ],
    },
    {
      heading: "Why we use it",
      bullets: [
        "To describe your nail photo and keep your history. For health data, we rely on your explicit consent, which we ask for before your first scan.",
        "To run your account and subscription, which is necessary to provide the service you asked for.",
        "To prevent abuse and enforce free scan limits, which is in our legitimate interest in keeping the service available and affordable.",
      ],
      after: [
        "We do not sell your data, share it for advertising, or use it to build advertising profiles. We do not use your photos or results to train AI models.",
      ],
    },
    {
      heading: "Who we share it with",
      bullets: [
        "Our AI analysis provider (Google, through the Gemini API, or Anthropic, depending on our configuration) receives the photo and note to create the description, under terms that do not allow them to use it to train their models. [Confirm the provider terms and data processing agreement in use.]",
        "Paddle.com, our reseller and Merchant of Record, processes payments and handles taxes, invoices and refunds. Paddle collects your payment details directly and acts under its own privacy policy.",
        "Google or Apple, if you choose to sign in with them.",
        "Our hosting provider, Fly.io, Inc., which runs our server and database in the United States (San Jose, California).",
        "Authorities, if the law requires it.",
      ],
    },
    {
      heading: "International transfers",
      paragraphs: [
        "Our providers may process data in the United States and other countries. Where the law requires it, we rely on appropriate safeguards such as the EU Standard Contractual Clauses or the EU-U.S. Data Privacy Framework. [Confirm the safeguards for each provider.]",
      ],
    },
    {
      heading: "How long we keep it",
      bullets: [
        "Photos: not kept on our server. On your device, until you delete them.",
        "Account data and results: until you delete them or your account.",
        "Scan counters and payment notifications: about 100 days.",
        "Payment and tax records held by Paddle: as long as the law requires them to keep them.",
      ],
    },
    {
      heading: "Cookies and device storage",
      bullets: [
        "ns_session: keeps you logged in. Set only when you log in.",
        "ns_device: a random identifier used only to count free scans.",
        "Browser storage on your device holds your settings, consent choice, and (if you're not logged in) your results and saved photos.",
      ],
      after: [
        "We don't use advertising or analytics cookies. If you subscribe, Paddle's checkout runs in a frame on our page and may set its own cookies needed for payment.",
      ],
    },
    {
      heading: "Your choices and rights",
      bullets: [
        "Withdraw consent to health data processing at any time in Profile. We'll ask again before your next scan. Withdrawing doesn't affect processing that happened before.",
        "Delete saved photos, your history, or your whole account in Profile.",
        "Ask us for a copy of your data, to correct it, or to restrict how we use it, by emailing us.",
        "Depending on where you live, you may also have the right to data portability, to object, and to complain to your local data protection authority.",
      ],
    },
    {
      heading: "Consumer health data (U.S. states)",
      paragraphs: [
        "Some U.S. state laws, such as Washington's My Health My Data Act, give you specific rights over consumer health data. We collect nail photos, notes and results only to provide the analysis you request, with your consent. We don't sell consumer health data or share it for any other purpose. You can confirm, access or delete it, or withdraw consent, as described above. [Have counsel confirm whether a separate consumer health data policy page is required.]",
      ],
    },
    {
      heading: "Children",
      paragraphs: [
        "NailSense is not intended for anyone under 18, and we don't knowingly collect data from children.",
      ],
    },
    {
      heading: "Security",
      paragraphs: [
        "We use encrypted connections, store passwords and session tokens only as hashes, keep API keys on the server, and limit access to data. No system is perfectly secure, and we'll tell you and the authorities about a breach where the law requires it.",
      ],
    },
    {
      heading: "Changes and contact",
      paragraphs: [
        "If we change this policy in a way that matters, we'll tell you in the app before it takes effect. If the change affects health data processing, we'll ask for your consent again.",
        `Contact: ${OPERATOR.name}, ${OPERATOR.address}, ${OPERATOR.email}. EU representative: ${OPERATOR.euRepresentative}. UK representative: ${OPERATOR.ukRepresentative}.`,
      ],
    },
  ],
};

export const TERMS_OF_SERVICE: LegalDoc = {
  id: "terms",
  title: "Terms of Service",
  intro: `These terms are an agreement between you and ${OPERATOR.name} for your use of NailSense. By using the app, you agree to them.`,
  sections: [
    {
      heading: "Not medical advice",
      paragraphs: [
        "NailSense describes how a nail looks in a photo and shares general health information. It is not a medical device. It does not diagnose, treat or rule out any condition, and a result is never a reason to skip or delay seeing a doctor. If you're worried about a change, see a healthcare professional. In an emergency, contact your local emergency number.",
        "Descriptions are created by an AI model and can be wrong or incomplete, especially with unclear photos.",
      ],
    },
    {
      heading: "Who can use NailSense",
      paragraphs: [
        "You must be at least 18. If you create an account, keep your login details safe and tell us if you think someone else has used your account.",
      ],
    },
    {
      heading: "Free and Pro plans",
      bullets: [
        "Free: a limited number of scans each calendar month (UTC), shown in the app.",
        "Pro: a higher daily number of scans, shown in the app, for personal, non-commercial use.",
        "On every plan, results include all warning-sign checks and guidance on when to see a doctor.",
      ],
      after: [
        "We may change plan limits or features. If a change reduces what you've paid for, we'll tell you in advance and you can cancel.",
      ],
    },
    {
      heading: "Subscriptions and payment",
      bullets: [
        "Our order process is conducted by our online reseller Paddle.com. Paddle.com is the Merchant of Record for all our orders, and Paddle's Buyer Terms apply to your purchase.",
        "The price, billing period and any free trial are shown before you pay. Checkout shows the final amount in your currency, including any tax.",
        "Subscriptions renew automatically at the end of each billing period until you cancel.",
        "If your plan includes a free trial, you won't be charged if you cancel before the trial ends. Otherwise, the first payment is taken when the trial ends.",
        "You can cancel at any time in Profile > Plan. You keep Pro until the end of the period you've already paid for, and you won't be charged again.",
        "Refunds are handled by Paddle under its refund policy and applicable consumer law, including any right to withdraw from a purchase where you live.",
        "If we change the price of your plan, we'll tell you before your next renewal, and the new price applies only after that renewal.",
      ],
    },
    {
      heading: "Acceptable use",
      bullets: [
        "Upload only photos you have the right to use, and only of your own nails or with the person's permission.",
        "Don't try to get around scan limits, overload the service, or access other people's data.",
        "Don't use NailSense to provide medical services to others.",
      ],
    },
    {
      heading: "Your content",
      paragraphs: [
        "You keep ownership of your photos and notes. You give us permission to process them only to provide the service, as described in the Privacy Policy.",
      ],
    },
    {
      heading: "Ending your use",
      paragraphs: [
        "You can stop using NailSense and delete your account at any time in Profile. Deleting your account cancels an active subscription right away. We may suspend accounts that break these terms, and we'll tell you why unless the law prevents it.",
      ],
    },
    {
      heading: "Liability",
      paragraphs: [
        "NailSense is provided as is. To the extent the law allows, we aren't liable for decisions you make based on a result, or for indirect or consequential losses. Nothing in these terms limits liability that can't be limited by law, or your statutory rights as a consumer. [Have counsel adapt this section for each launch market.]",
      ],
    },
    {
      heading: "Changes and contact",
      paragraphs: [
        "If we change these terms in a way that matters, we'll tell you in the app before the change takes effect.",
        `These terms are governed by ${OPERATOR.governingLaw}, without affecting mandatory consumer protections where you live.`,
        `Contact: ${OPERATOR.name}, ${OPERATOR.address}, ${OPERATOR.supportEmail}.`,
      ],
    },
  ],
};

/* --------------------------------- 한국어 --------------------------------- */

export const PRIVACY_POLICY_KO: LegalDoc = {
  id: "privacy",
  title: "개인정보처리방침",
  intro: `${OPERATOR.name}(이하 "회사")는 NailSense를 운영하며 「개인정보 보호법」 등 관련 법령을 지킵니다. 손톱 사진과 그 설명은 건강에 관한 정보를 드러낼 수 있어, 회사는 이를 민감정보로 보고 별도 동의를 받아 처리합니다.`,
  sections: [
    {
      heading: "1. 처리하는 개인정보와 목적",
      bullets: [
        "손톱 사진과 선택해서 적은 메모: 사진에 보이는 손톱의 겉모습을 설명하기 위해(민감정보, 별도 동의).",
        "분석 결과: 결과를 보여 주고 기록을 남기기 위해(민감정보, 별도 동의).",
        "계정 정보(이메일, 비밀번호 해시, 이름이나 닉네임, 구글·애플 계정 식별값, 설정): 회원 관리와 로그인 유지를 위해.",
        "구독 정보(요금제, 상태, 갱신일, 결제 대행사의 고객 식별값): 유료 서비스 제공을 위해. 카드 정보는 회사가 받거나 저장하지 않습니다.",
        "무료 사용 횟수 확인용 정보(기기 쿠키의 무작위 값, 매달 바뀌는 IP 주소의 일방향 해시): 무료 한도를 세고 부정 이용을 막기 위해.",
        "동의 기록(동의 시각과 문구 버전): 동의 사실을 확인하기 위해.",
      ],
    },
    {
      heading: "2. 사진은 이렇게 다룹니다",
      bullets: [
        "분석을 누르면 사진이 회사 서버를 거쳐 AI 분석 업체로 전달되어 설명을 만듭니다.",
        "회사 서버는 사진을 저장하지 않으며, 분석이 끝나면 버립니다.",
        "\"분석한 사진 저장하기\"를 켜 두면 사진은 이 기기의 브라우저 안에만 보관됩니다. 프로필에서 끄거나 지울 수 있습니다.",
        "로그인한 경우 분석 결과(사진 제외)는 계정에 저장되고, 로그인하지 않은 경우 이 기기에만 남습니다.",
        "공유 카드에는 사진이 들어가지 않습니다.",
      ],
    },
    {
      heading: "3. 보유 기간과 파기",
      bullets: [
        "사진: 서버에 보관하지 않습니다. 기기 안의 사진은 지울 때까지 남습니다.",
        "계정 정보와 분석 결과: 회원이 지우거나 탈퇴할 때까지. 탈퇴하면 지체 없이 파기합니다.",
        "사용 횟수 기록과 결제 알림 기록: 약 100일.",
        "결제·세금 기록: 결제 대행사(Paddle)가 관련 법령에 따른 기간 동안 보관합니다.",
      ],
      after: [
        "전자 파일은 복구할 수 없는 방법으로 지웁니다.",
      ],
    },
    {
      heading: "4. 처리 위탁과 국외 이전",
      paragraphs: [
        "서비스 제공을 위해 아래 업체에 처리를 맡기며, 이들 업체는 미국에 있습니다. 이전은 이용자가 분석하거나 서비스를 이용할 때마다 네트워크로 이루어집니다.",
      ],
      bullets: [
        "Fly.io, Inc.(미국) / 서버와 데이터베이스 운영 / 계정 정보, 분석 결과, 사용 기록 / 보유 기간은 위 3과 같음 / [연락처 확인 필요]",
        "Google LLC(미국, Gemini API) 또는 Anthropic PBC(미국) / 손톱 사진과 메모로 설명 만들기 / 사진, 메모 / 분석 처리 후 보관하지 않는 조건으로 이용 [각 업체 약관과 데이터 처리 계약 확인 필요]",
        "Paddle.com Market Limited(영국) 및 관계사 / 결제, 세금, 환불(판매 대행) / 결제에 필요한 정보 / 관련 법령에 따른 기간",
      ],
      after: [
        "국외 이전을 원하지 않으면 동의하지 않을 수 있습니다. 이 경우 사진 분석과 유료 구독을 이용할 수 없지만, 건강 정보 글 등 다른 기능은 이용할 수 있습니다.",
      ],
    },
    {
      heading: "5. 제3자 제공",
      paragraphs: [
        "회사는 개인정보를 판매하거나 광고 목적으로 제공하지 않으며, 사진과 결과를 AI 학습에 쓰지 않습니다. 법령에 따른 요청이 있는 경우를 제외하고 제3자에게 제공하지 않습니다.",
      ],
    },
    {
      heading: "6. 쿠키와 기기 저장소",
      bullets: [
        "ns_session: 로그인을 유지합니다. 로그인할 때만 만들어집니다.",
        "ns_device: 무료 분석 횟수를 세는 데만 쓰는 무작위 값입니다.",
        "브라우저 저장소에는 설정, 동의 여부, (로그인하지 않은 경우) 결과와 저장된 사진이 들어갑니다.",
      ],
      after: [
        "광고나 분석용 쿠키는 쓰지 않습니다. 브라우저 설정에서 쿠키를 지울 수 있으며, 이 경우 로그인이 풀립니다.",
      ],
    },
    {
      heading: "7. 이용자의 권리와 행사 방법",
      bullets: [
        "건강 정보(민감정보) 처리 동의는 프로필에서 언제든 철회할 수 있습니다. 철회 전에 이루어진 처리에는 영향이 없습니다.",
        "사진, 기록, 계정은 프로필에서 바로 지울 수 있습니다.",
        "개인정보 열람, 정정, 처리 정지, 삭제를 아래 연락처로 요청할 수 있으며, 회사는 지체 없이 처리합니다.",
      ],
    },
    {
      heading: "8. 안전성 확보 조치",
      paragraphs: [
        "전송 구간 암호화, 비밀번호와 세션 토큰의 해시 저장, 서버에서만 다루는 API 키, 접근 권한 제한 등의 조치를 합니다.",
      ],
    },
    {
      heading: "9. 만 14세 미만",
      paragraphs: [
        "NailSense는 만 18세 이상을 대상으로 하며, 만 14세 미만 아동의 개인정보를 알면서 수집하지 않습니다.",
      ],
    },
    {
      heading: "10. 개인정보 보호책임자와 문의",
      paragraphs: [
        `개인정보 보호책임자: ${OPERATOR.privacyOfficerKo}`,
        `국내대리인: ${OPERATOR.domesticAgentKo}`,
        `문의: ${OPERATOR.email}`,
        "개인정보 침해에 대한 상담이나 분쟁 조정은 개인정보분쟁조정위원회(1833-6972), 개인정보침해신고센터(118) 등에 요청할 수 있습니다.",
      ],
    },
    {
      heading: "11. 변경",
      paragraphs: [
        "이 방침을 바꾸면 시행 전에 앱에서 알리며, 민감정보 처리나 국외 이전 내용이 바뀌면 다시 동의를 받습니다.",
      ],
    },
  ],
};

export const TERMS_OF_SERVICE_KO: LegalDoc = {
  id: "terms",
  title: "이용약관",
  intro: `이 약관은 ${OPERATOR.name}(이하 "회사")가 제공하는 NailSense의 이용 조건을 정합니다. 앱을 이용하면 이 약관에 동의한 것으로 봅니다.`,
  sections: [
    {
      heading: "제1조 의료 서비스가 아닙니다",
      paragraphs: [
        "NailSense는 사진에 보이는 손톱의 겉모습을 설명하고 일반적인 건강 정보를 알려 주는 참고용 서비스이며 의료기기가 아닙니다. 어떤 질환도 진단하거나 치료하거나 배제하지 않으며, 결과를 이유로 진료를 미루어서는 안 됩니다. 변화가 걱정되면 의료 전문가와 상담하고, 응급 상황에서는 119에 연락하세요.",
        "설명은 AI가 만들기 때문에 틀리거나 빠진 내용이 있을 수 있으며, 사진이 흐릴수록 더 그렇습니다.",
      ],
    },
    {
      heading: "제2조 이용 대상",
      paragraphs: [
        "만 18세 이상만 이용할 수 있습니다. 계정을 만들었다면 로그인 정보를 안전하게 관리하고, 다른 사람이 쓴 것 같으면 회사에 알려 주세요.",
      ],
    },
    {
      heading: "제3조 무료 요금제와 Pro",
      bullets: [
        "무료: 매달(UTC 기준) 정해진 횟수만큼 분석할 수 있으며, 횟수는 앱에 표시됩니다.",
        "Pro: 하루에 더 많은 횟수를 분석할 수 있으며, 개인적인 용도로만 이용할 수 있습니다.",
        "어떤 요금제에서든 결과에는 위험 신호 점검과 진료 안내가 모두 담깁니다.",
      ],
      after: [
        "회사는 요금제의 한도나 기능을 바꿀 수 있으며, 이미 결제한 내용이 줄어드는 경우에는 미리 알리고 해지할 수 있게 합니다.",
      ],
    },
    {
      heading: "제4조 구독과 결제",
      bullets: [
        "주문과 결제는 온라인 판매 대행사인 Paddle.com이 처리하며, Paddle이 모든 주문의 판매자(Merchant of Record)입니다. 결제에는 Paddle의 구매자 약관이 적용됩니다.",
        "금액, 결제 주기, 무료 체험 여부는 결제 전에 표시되며, 최종 금액(세금 포함)은 결제 창에서 현지 통화로 보여 줍니다.",
        "구독은 해지할 때까지 결제 주기마다 자동으로 갱신됩니다.",
        "무료 체험이 있는 경우 체험 기간 안에 해지하면 결제되지 않으며, 그렇지 않으면 체험이 끝날 때 첫 결제가 이루어집니다.",
        "프로필 > 요금제에서 언제든 해지할 수 있습니다. 해지해도 이미 결제한 기간이 끝날 때까지 Pro를 쓸 수 있고, 이후 결제되지 않습니다.",
        "청약철회와 환불은 「전자상거래 등에서의 소비자보호에 관한 법률」 등 관련 법령과 Paddle의 환불 정책에 따릅니다.",
        "가격이 바뀌면 다음 갱신 전에 알리며, 새 가격은 그 갱신부터 적용됩니다.",
      ],
    },
    {
      heading: "제5조 이용자의 의무",
      bullets: [
        "본인 손톱 사진이나 당사자의 허락을 받은 사진만 올려 주세요.",
        "횟수 제한을 피하려 하거나, 서비스에 과도한 부하를 주거나, 다른 사람의 정보에 접근해서는 안 됩니다.",
        "NailSense를 다른 사람에게 의료 서비스를 제공하는 데 쓰면 안 됩니다.",
      ],
    },
    {
      heading: "제6조 이용자의 콘텐츠",
      paragraphs: [
        "사진과 메모의 권리는 이용자에게 있으며, 회사는 개인정보처리방침에 적힌 대로 서비스 제공을 위해서만 처리합니다.",
      ],
    },
    {
      heading: "제7조 이용 종료",
      paragraphs: [
        "이용자는 프로필에서 언제든 계정을 삭제할 수 있으며, 이때 이용 중인 구독은 즉시 해지됩니다. 회사는 약관을 위반한 계정의 이용을 제한할 수 있으며, 법령이 막지 않는 한 그 이유를 알립니다.",
      ],
    },
    {
      heading: "제8조 책임의 제한",
      paragraphs: [
        "회사는 고의 또는 중대한 과실이 없는 한 결과를 근거로 한 이용자의 판단이나 간접 손해에 대해 책임지지 않습니다. 다만 관련 법령상 제한할 수 없는 책임과 소비자의 법정 권리는 이 약관으로 제한되지 않습니다. [국가별 변호사 검토 필요]",
      ],
    },
    {
      heading: "제9조 약관 변경과 문의",
      paragraphs: [
        "약관을 바꾸면 시행 전에 앱에서 알립니다.",
        "회사와 이용자 사이의 분쟁은 대한민국 법을 따르며, 이용자의 주소지 관할 법원을 관할 법원으로 합니다. [변호사 검토 필요]",
        `문의: ${OPERATOR.name}, ${OPERATOR.address}, ${OPERATOR.supportEmail}`,
      ],
    },
  ],
};

export const LEGAL_DOCS = { privacy: PRIVACY_POLICY, terms: TERMS_OF_SERVICE } as const;
export type LegalDocId = keyof typeof LEGAL_DOCS;

/** 언어에 맞는 약관 묶음 */
export function legalDocs(locale: Locale): Record<LegalDocId, LegalDoc> {
  return locale === "ko"
    ? { privacy: PRIVACY_POLICY_KO, terms: TERMS_OF_SERVICE_KO }
    : LEGAL_DOCS;
}
