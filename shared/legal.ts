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

export const LEGAL_STATUS: "draft" | "final" = "draft";
export const LEGAL_UPDATED = "October 3, 2026";

/** 운영자 정보. 출시 전에 반드시 채운다. */
export const OPERATOR = {
  name: "[Operator legal name]",
  address: "[Postal address]",
  email: "[privacy contact email]",
  supportEmail: "[support email]",
  governingLaw: "[Governing law and venue]",
  euRepresentative: "[EU representative, if required]",
  ukRepresentative: "[UK representative, if required]",
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
        "Our hosting provider, which stores our server and database. [Name the hosting provider and region.]",
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

export const LEGAL_DOCS = { privacy: PRIVACY_POLICY, terms: TERMS_OF_SERVICE } as const;
export type LegalDocId = keyof typeof LEGAL_DOCS;
