/**
 * 손톱 "관찰" 스키마.
 *
 * 설계 원칙 (중요):
 * - 이 스키마에는 질병명, 진단명, 치료법, 처방을 담는 필드가 존재하지 않는다.
 *   모델이 그런 내용을 출력할 구조적 여지를 애초에 만들지 않기 위한 의도적 설계다.
 * - 모든 항목은 "사진에서 보이는 것"(observation)과
 *   "그 모습이 일반적으로 무엇과 관련될 수 있는지에 대한 일반 정보"(explanation)로만 구성된다.
 * - status 는 중증도가 아니라 "사용자가 얼마나 신경 써서 지켜볼 만한가"를 뜻한다.
 */

/** 관찰 항목 키. UI 순서와 동일하게 유지한다. */
export const METRIC_KEYS = [
  "color",
  "surface",
  "ridges",
  "cracks",
  "shape",
  "skin",
] as const;

export type MetricKey = (typeof METRIC_KEYS)[number];

export const METRIC_LABELS: Record<MetricKey, string> = {
  color: "색상",
  surface: "표면",
  ridges: "줄무늬",
  cracks: "갈라짐",
  shape: "두께 · 모양",
  skin: "주변 피부",
};

export const METRIC_DESCRIPTIONS: Record<MetricKey, string> = {
  color: "손톱판의 전체적인 색조와 균일함, 부분적인 색 변화",
  surface: "표면의 매끄러움, 광택, 함몰이나 점상 흔적",
  ridges: "세로 또는 가로 방향으로 보이는 결·능선",
  cracks: "끝부분의 갈라짐, 층이 일어남, 부서짐",
  shape: "두께감, 곡률, 전체적인 윤곽",
  skin: "손톱 주변 피부와 큐티클, 손톱 옆선의 상태",
};

/**
 * good  : 특별히 눈에 띄는 변화가 없음
 * watch : 사진상 변화가 보이며 시간을 두고 지켜볼 만함
 * consult: 사진만으로 판단하기 어렵고, 전문가에게 직접 보여주는 편이 나은 모습
 */
export const STATUS_KEYS = ["good", "watch", "consult"] as const;
export type Status = (typeof STATUS_KEYS)[number];

export const STATUS_LABELS: Record<Status, string> = {
  good: "특이사항 적음",
  watch: "지켜보기",
  consult: "전문가 확인 권장",
};

export const CONFIDENCE_KEYS = ["high", "medium", "low"] as const;
export type Confidence = (typeof CONFIDENCE_KEYS)[number];

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  high: "사진에서 비교적 뚜렷하게 보임",
  medium: "부분적으로만 확인됨",
  low: "사진만으로는 확인이 어려움",
};

export interface Metric {
  key: MetricKey;
  status: Status;
  /** 이 사진에서 해당 항목을 얼마나 명확히 볼 수 있었는지 */
  confidence: Confidence;
  /** 사진에서 실제로 보이는 모습 */
  observation: string;
  /** 그런 모습이 일반적으로 무엇과 관련될 수 있는지에 대한 교육적 일반 정보 */
  explanation: string;
}

export const TIP_CATEGORIES = [
  "nutrition",
  "hydration",
  "care",
  "habit",
  "rest",
] as const;

export type TipCategory = (typeof TIP_CATEGORIES)[number];

export const TIP_CATEGORY_LABELS: Record<TipCategory, string> = {
  nutrition: "식습관",
  hydration: "수분",
  care: "관리",
  habit: "생활습관",
  rest: "휴식",
};

export interface Tip {
  category: TipCategory;
  title: string;
  detail: string;
}

export interface NailAnalysis {
  /** 사진에 사람의 손톱이 충분히 보이는지 */
  isNailPhoto: boolean;
  imageQuality: {
    usable: boolean;
    /** 사진 품질 문제를 짧은 구절로. 없으면 빈 배열 */
    issues: string[];
  };
  /** 전체 인상을 담은 짧은 한 줄 */
  headline: string;
  summary: string;
  /**
   * 사진상 손톱 겉모습이 얼마나 균일하게 보이는지를 0~100으로 표현한 값.
   * 건강 점수나 의학적 지표가 아니라, 사진 사이의 변화를 비교하기 위한 참고용 수치다.
   */
  observationScore: number;
  /** METRIC_KEYS 순서대로 6개 */
  metrics: Metric[];
  tips: Tip[];
  /** "이런 변화가 이어지면 전문가에게 보여주세요" 형태의 문장들 */
  consultSignals: string[];
}

/** 서버 -> 클라이언트 응답 */
export type AnalyzeResponse =
  | { ok: true; analysis: NailAnalysis; demo: boolean; model: string }
  | { ok: false; error: string; code: AnalyzeErrorCode };

export type AnalyzeErrorCode =
  | "bad_request"
  | "not_a_nail_photo"
  | "unusable_image"
  | "no_api_key"
  | "rate_limited"
  | "declined"
  | "upstream_error";

/** 기록 화면에서 쓰는 저장 레코드 */
export interface NailRecord {
  id: string;
  createdAt: number;
  hand: "left" | "right";
  finger: FingerKey;
  note: string;
  analysis: NailAnalysis;
  /** 사용자가 사진 저장을 허용한 경우에만 채워진다. */
  hasImage: boolean;
}

export const FINGER_KEYS = [
  "thumb",
  "index",
  "middle",
  "ring",
  "little",
] as const;
export type FingerKey = (typeof FINGER_KEYS)[number];

export const FINGER_LABELS: Record<FingerKey, string> = {
  thumb: "엄지",
  index: "검지",
  middle: "중지",
  ring: "약지",
  little: "소지",
};

export const DISCLAIMER_SHORT =
  "이 앱은 의료기기가 아니며, 사진만으로는 질병을 진단할 수 없습니다.";

export const DISCLAIMER_LONG =
  "NailSense는 사진에서 보이는 손톱의 겉모습을 정리해 주는 참고용 도구입니다. 질병을 진단하거나 치료법을 안내하지 않으며, 의학적 판단을 대신할 수 없습니다. 손톱의 변화가 지속되거나 통증·출혈 등 다른 증상이 함께 있다면 의료 전문가와 상담하세요.";
