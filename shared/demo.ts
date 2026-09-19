import { METRIC_KEYS, type Finding, type NailAnalysis } from "./analysis.js";

/**
 * API 키 없이 UI를 확인하기 위한 샘플 응답.
 * 실제 분석이 아니며, 응답에 demo: true 가 함께 내려가 화면에 배지로 표시된다.
 */
const OBSERVATIONS: Record<
  (typeof METRIC_KEYS)[number],
  { observation: string; explanation: string }[]
> = {
  color: [
    {
      observation: "손톱판 전체가 연한 분홍빛으로 비교적 고르게 보입니다.",
      explanation:
        "손톱은 아래 피부가 비쳐 보이기 때문에 연한 분홍빛을 띠는 경우가 많습니다. 조명이나 촬영 각도에 따라 색이 달라 보이기도 합니다.",
    },
    {
      observation: "손톱 끝 쪽이 주변보다 조금 하얗게 보입니다.",
      explanation:
        "손톱이 손가락 끝에서 떨어져 나온 부분은 아래 피부가 비치지 않아 더 밝게 보이는 것이 일반적입니다.",
    },
  ],
  surface: [
    {
      observation: "표면은 대체로 매끄럽고 빛이 고르게 반사되고 있습니다.",
      explanation:
        "표면의 광택은 손톱 바깥층의 상태와 수분에 따라 달라 보이는 경우가 많습니다.",
    },
  ],
  ridges: [
    {
      observation: "손톱 중앙부에 세로 방향의 얕은 결이 몇 줄 보입니다.",
      explanation:
        "세로 방향의 결은 나이가 들면서 흔하게 관찰되는 변화입니다. 건조한 환경에서 더 두드러져 보이기도 합니다.",
    },
  ],
  cracks: [
    {
      observation: "끝부분에 갈라짐이나 층이 일어난 모습은 보이지 않습니다.",
      explanation:
        "물과 세제에 자주 닿거나 손톱을 자주 다듬으면 끝부분이 잘 갈라져 보이는 경우가 있습니다.",
    },
  ],
  shape: [
    {
      observation: "두께감은 고르고 완만한 곡선을 그리고 있습니다.",
      explanation:
        "손톱의 곡률과 두께는 사람마다 타고난 차이가 큰 편입니다. 평소와 비교해 달라졌는지가 더 의미 있는 정보입니다.",
    },
  ],
  skin: [
    {
      observation: "큐티클 주변이 살짝 건조해 보이고 각질이 관찰됩니다.",
      explanation:
        "손을 자주 씻거나 건조한 계절에는 손톱 주변 피부가 거칠어 보이는 일이 흔합니다.",
    },
  ],
};


/**
 * 특이 사항 샘플. 실제 응답과 같은 모양(무엇이 보이는지 → 일반적으로 함께 언급되는 요인
 * → 사진으로 알 수 없는 것 → 지켜볼 변화)을 갖춰, 데모에서도 화면 구성이 그대로 드러나게 한다.
 */
const FINDINGS: Finding[] = [
  {
    metric: "ridges",
    label: "세로 줄무늬",
    detail:
      "손톱 중앙에서 끝쪽으로 이어지는 얕은 세로 결이 3~4줄 보입니다. 손톱 전체에 고르게 퍼져 있고, 한 줄만 유독 깊어 보이지는 않습니다.",
    causes: [
      "나이가 들면서 누구에게나 흔하게 늘어나는 변화입니다.",
      "손이 건조하거나 물과 세제에 자주 닿는 환경에서 더 도드라져 보이기도 합니다.",
      "드물게는 손톱이 자라는 속도가 달라지면서 결이 함께 달라 보이는 경우도 있습니다.",
    ],
    cannotTell:
      "사진으로는 결의 깊이를 잴 수 없고, 조명 각도에 따라 실제보다 뚜렷해 보이기도 합니다.",
    attention: "routine",
    watchFor: [
      "한 줄만 점점 깊고 넓어질 때",
      "그 줄을 따라 손톱이 갈라지기 시작할 때",
    ],
    timeframe: "3~6개월에 걸쳐 같은 부위를 다시 찍어 비교",
  },
  {
    metric: "skin",
    label: "큐티클 주변 각질",
    detail:
      "손톱 아래쪽 경계와 양 옆선을 따라 하얗게 일어난 각질이 보입니다. 붓거나 붉어진 기색은 이 사진에서 확인되지 않습니다.",
    causes: [
      "손을 자주 씻거나 건조한 계절에 흔하게 나타납니다.",
      "큐티클을 밀거나 뜯는 습관과 함께 관찰되는 경우가 있습니다.",
      "세제·소독제에 자주 닿는 일을 할 때 더 두드러지기도 합니다.",
    ],
    cannotTell:
      "사진만으로는 단순히 건조한 것인지, 피부에 자극이 남아 있는 상태인지 구분하기 어렵습니다.",
    attention: "monitor",
    watchFor: [
      "손톱 옆선이 붉게 부어오르거나 누르면 아플 때",
      "진물이 보이거나 같은 자리가 반복해서 덧날 때",
    ],
    timeframe: "2~3주 보습을 챙긴 뒤 다시 촬영",
  },
  {
    metric: "color",
    label: "손톱 끝 흰 띠",
    detail:
      "손톱 끝 2~3mm 가 주변보다 하얗게 보입니다. 경계선이 손톱 모양을 따라 매끄럽게 이어집니다.",
    causes: [
      "손톱이 손가락 끝에서 떨어져 나온 부분은 아래 피부가 비치지 않아 원래 더 밝게 보입니다.",
      "길이를 남겨 기를수록 이 부분이 넓어 보이기도 합니다.",
    ],
    cannotTell:
      "사진으로는 손톱판 자체의 색인지 아래 피부가 비쳐 보이는 색인지 정확히 가리기 어렵습니다.",
    attention: "routine",
    watchFor: [
      "흰 부분이 손톱 뿌리 쪽으로 넓어질 때",
      "그 경계가 울퉁불퉁해지고 들뜬 느낌이 생길 때",
    ],
    timeframe: "다음 손톱 정리 때 한 번 더 확인",
  },
];

const HEADLINES = [
  "전반적으로 고른 모습이에요",
  "지난번과 비슷해 보여요",
  "결이 조금 덜 보여요",
  "주변 피부가 한결 차분해요",
];

const SUMMARIES = [
  "색과 표면은 비교적 고르게 보이고, 중앙부에 얕은 세로 결과 주변 피부의 건조함이 함께 관찰됩니다. 사진만으로는 그 이상을 알기 어렵기 때문에 평소 모습과 비교해 보시는 것을 권합니다.",
  "전체적인 색조는 균일한 편이고, 끝부분도 매끄럽게 이어집니다. 중앙의 세로 결은 지난 사진에서도 보이던 정도로, 조명에 따라 더 두드러져 보이기도 합니다.",
  "표면 광택이 고르게 잡혀 있고 큐티클 주변 각질이 덜 눈에 띕니다. 손톱 모양과 두께는 이전과 비슷한 범위로 보입니다.",
  "색과 두께는 눈에 띄는 변화 없이 유지되고 있습니다. 손톱 옆선 피부가 전보다 매끈해 보이지만, 사진 각도의 영향도 있을 수 있습니다.",
];

export function buildDemoAnalysis(seed: number): NailAnalysis {
  const pick = <T>(arr: T[], offset: number): T =>
    arr[(seed + offset) % arr.length]!;

  return {
    isNailPhoto: true,
    imageQuality: { usable: true, issues: [] },
    headline: pick(HEADLINES, 0),
    summary: pick(SUMMARIES, 0),
    observationScore: 78 + (seed % 7),
    metrics: METRIC_KEYS.map((key, index) => {
      const sample = pick(OBSERVATIONS[key], index);
      const status =
        key === "ridges" || key === "skin"
          ? ("watch" as const)
          : ("good" as const);
      return {
        key,
        status,
        confidence: key === "shape" ? ("medium" as const) : ("high" as const),
        observation: sample.observation,
        explanation: sample.explanation,
      };
    }),
    // seed 에 따라 특이 사항 개수를 1~3개로 바꿔, 목록이 비었을 때와 찼을 때를 모두 보여 준다.
    findings: FINDINGS.slice(0, 1 + (seed % 3)),
    tips: [
      {
        category: "hydration",
        title: "손끝까지 보습",
        detail:
          "손을 씻은 뒤 손톱 주변까지 크림을 발라 주면 건조해 보이는 각질이 덜 눈에 띕니다.",
      },
      {
        category: "care",
        title: "다듬기는 한 방향으로",
        detail:
          "줄을 앞뒤로 문지르기보다 한 방향으로 부드럽게 다듬으면 끝부분이 덜 상합니다.",
      },
      {
        category: "habit",
        title: "세제 닿을 땐 장갑",
        detail:
          "설거지나 청소처럼 물과 세제에 오래 닿는 일에는 고무장갑을 쓰는 편이 좋습니다.",
      },
      {
        category: "nutrition",
        title: "고르게 먹기",
        detail:
          "단백질과 채소를 포함한 균형 잡힌 식사가 전반적인 컨디션에 도움이 됩니다.",
      },
    ],
    consultSignals: [
      "한 손톱에만 생긴 색 변화가 몇 주 이상 그대로 이어질 때",
      "손톱 주변이 붓거나 아프고, 진물이 함께 보일 때",
      "손톱이 손가락에서 들뜨거나 두께가 눈에 띄게 달라질 때",
    ],
  };
}
