import { METRIC_KEYS, type NailAnalysis } from "../shared/analysis.js";

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

export function buildDemoAnalysis(seed: number): NailAnalysis {
  const pick = <T>(arr: T[], offset: number): T =>
    arr[(seed + offset) % arr.length]!;

  return {
    isNailPhoto: true,
    imageQuality: { usable: true, issues: [] },
    headline: "전반적으로 고른 모습이에요",
    summary:
      "색과 표면은 비교적 고르게 보이고, 중앙부에 얕은 세로 결과 주변 피부의 건조함이 함께 관찰됩니다. 사진만으로는 그 이상을 알기 어렵기 때문에 평소 모습과 비교해 보시는 것을 권합니다.",
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
