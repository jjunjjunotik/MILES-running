import {
  ATTENTION_RANK,
  METRIC_KEYS,
  type Finding,
  type NailAnalysis,
} from "./analysis.js";
import type { Locale } from "./i18n.js";

/**
 * API 키 없이 UI를 확인하기 위한 샘플 응답.
 * 실제 분석이 아니며, 응답에 demo: true 가 함께 내려가 화면에 배지로 표시된다.
 */
/* ---------------------------------- DEMO_EN ---------------------------------- */

const DEMO_EN = (() => {
const OBSERVATIONS: Record<
  (typeof METRIC_KEYS)[number],
  { observation: string; explanation: string }[]
> = {
  color: [
    {
      observation: "The whole nail plate looks a fairly even light pink.",
      explanation:
        "Nails often look light pink because the skin underneath shows through. Lighting and camera angle can also change how the color looks.",
    },
    {
      observation: "The tip of the nail looks a little whiter than the rest.",
      explanation:
        "The part of the nail that has grown past the fingertip has no skin showing through underneath, so it usually looks lighter.",
    },
  ],
  surface: [
    {
      observation: "The surface looks mostly smooth and reflects light evenly.",
      explanation:
        "How shiny a nail looks often depends on the outer layer of the nail and how much moisture it holds.",
    },
  ],
  ridges: [
    {
      observation: "A few shallow vertical lines run through the middle of the nail.",
      explanation:
        "Vertical lines are a change commonly seen with age. They can stand out more in dry conditions.",
    },
  ],
  cracks: [
    {
      observation: "No splitting or peeling layers are visible at the tip.",
      explanation:
        "Frequent contact with water and detergent, or frequent filing, can make the tip look split.",
    },
  ],
  shape: [
    {
      observation: "The thickness looks even and the nail has a gentle curve.",
      explanation:
        "Nail curve and thickness vary a lot from person to person. Whether it has changed from your usual is the more useful question.",
    },
  ],
  skin: [
    {
      observation: "The skin around the cuticle looks slightly dry, with some flaking.",
      explanation:
        "Skin around the nails often looks rough with frequent handwashing or in dry seasons.",
    },
  ],
};


/**
 * 특이 사항 샘플. 실제 응답과 같은 모양(보이는 것 → 이 모습의 이름 → 이런 모습을
 * 만드는 상태들 → 위험 신호 점검 → 사진의 한계 → 대응)을 갖춰, 데모에서도 화면
 * 구성이 그대로 드러나게 한다. 색소 띠 예시는 soon 단계 화면을 보여 주기 위한 것이다.
 */
const FINDINGS: Finding[] = [
  {
    metric: "ridges",
    label: "Vertical ridges",
    detail:
      "Three or four shallow vertical lines run from the middle of the nail toward the tip. They're spread evenly across the nail, and no single line looks much deeper than the others.",
    patternNames: ["Longitudinal ridging (onychorrhexis-type)"],
    possibilities: [
      {
        name: "Age-related vertical ridges",
        likelihood: "likely",
        why: "Several lines spread evenly across the nail, with none standing out, fit well with a change that becomes common for everyone with age.",
      },
      {
        name: "Dryness and frequent contact with water and detergent",
        likelihood: "possible",
        why: "When the outer layer of the nail loses moisture, the same lines stand out more. This is often seen on hands that wash dishes or use sanitizer a lot.",
      },
    ],
    signChecks: [
      {
        sign: "One line deeper and wider than the rest",
        state: "absent",
        note: "The lines look about the same width.",
      },
      {
        sign: "Splitting along a line",
        state: "absent",
        note: "The tip looks smooth and continuous.",
      },
      {
        sign: "Actual depth of the lines",
        state: "unclear",
        note: "A photo can't measure depth.",
      },
    ],
    cannotTell:
      "A photo can't measure how deep the lines are, and the angle of the light can make them look sharper than they are.",
    attention: "routine",
    nextSteps: [
      "Nothing here needs a visit on its own. Take photos in the same light a few months apart and compare.",
      "Moisturizing around the nails after washing your hands can make the lines less noticeable.",
    ],
    watchFor: [
      "One line keeps getting deeper and wider",
      "The nail starts splitting along a line",
    ],
    timeframe: "Photograph the same nail again over 3-6 months and compare",
  },
  {
    metric: "skin",
    label: "Flaking around the cuticle",
    detail:
      "White flakes are visible along the base of the nail and both side folds. No swelling or redness can be seen in this photo.",
    patternNames: [],
    possibilities: [
      {
        name: "Dryness related to hand eczema",
        likelihood: "possible",
        why: "This is common on hands that are washed often or come into contact with detergent or sanitizer. Flaking often comes with itching.",
      },
      {
        name: "Irritation from pushing back or picking at the cuticle",
        likelihood: "possible",
        why: "Repeated irritation of the skin around the nail easily leads to flaking and hangnails.",
      },
      {
        name: "Chronic paronychia",
        likelihood: "uncommon",
        why: "This is the name used when the same spot swells and hurts again and again. No swelling or fluid is visible in this photo.",
      },
    ],
    signChecks: [
      {
        sign: "Swelling along the nail fold",
        state: "absent",
        note: "The side folds don't look swollen.",
      },
      {
        sign: "Fluid or pus",
        state: "absent",
        note: "Nothing looks wet.",
      },
      {
        sign: "Pain when pressed",
        state: "unclear",
        note: "A photo can't show this.",
      },
    ],
    cannotTell:
      "A photo alone can't separate simple dryness from eczema. In the clinic, a doctor looks at your hands directly and checks skin elsewhere too.",
    attention: "monitor",
    nextSteps: [
      "If it's the same or worse after 2-3 weeks of moisturizing, consider seeing a dermatologist.",
      "Wear gloves for long wet chores, and don't push back or pick at your cuticles.",
    ],
    watchFor: [
      "The nail fold turns red and swollen, or hurts to press",
      "You see fluid, or the same spot keeps flaring up",
    ],
    timeframe: "Take another photo after 2-3 weeks of moisturizing",
  },
  {
    metric: "color",
    label: "Brown vertical band on one nail",
    detail:
      "A brown vertical band runs from the base to the tip of this nail only. It's about a fifth of the nail's width, around 3 mm, and the color inside it is uneven, with darker and lighter lines mixed together.",
    patternNames: ["Longitudinal melanonychia"],
    possibilities: [
      {
        name: "Harmless pigmentation (ethnic pigmentation)",
        likelihood: "possible",
        why: "In people with darker skin, brown bands on several nails are common. In this photo, though, it shows on only one nail.",
      },
      {
        name: "Nail matrix nevus (a mole where the nail forms)",
        likelihood: "possible",
        why: "A mole in the part that makes the nail leaves a band along the growing nail. These often appear in childhood and stay the same for years.",
      },
      {
        name: "Subungual hematoma (blood under the nail)",
        likelihood: "uncommon",
        why: "Blood trapped after a pinch or knock can look like a band. In that case it moves toward the tip as the nail grows.",
      },
      {
        name: "Subungual melanoma",
        likelihood: "rare_important",
        why: "It's rare, but it's the name doctors keep in mind for a wide, unevenly colored band on a single nail. A photo can't rule it in or out, and an exam is the only way to check, so it's listed here.",
      },
    ],
    signChecks: [
      {
        sign: "Width of 3 mm or more",
        state: "present",
        note: "About a fifth of the nail's width, around 3 mm.",
      },
      {
        sign: "Uneven color inside the band",
        state: "present",
        note: "Darker and lighter lines look mixed together.",
      },
      {
        sign: "Only on one finger",
        state: "present",
        note: "This photo shows only one nail. A photo of the other nails is needed to compare.",
      },
      {
        sign: "Pigment spreading onto the surrounding skin",
        state: "absent",
        note: "No color reaches the cuticle or side folds.",
      },
      {
        sign: "Blurry or irregular edges",
        state: "unclear",
        note: "The edges are hard to make out at this resolution.",
      },
      {
        sign: "Recently wider or darker",
        state: "unclear",
        note: "One photo can't show this. Compare with older photos if you have them.",
      },
    ],
    cannotTell:
      "A photo can't tell whether the pigment is in the nail plate or the skin underneath, or whether it's harmless. In the clinic, a doctor looks with a magnifying tool (dermoscopy) and, if needed, confirms with a biopsy near the base of the nail.",
    attention: "soon",
    nextSteps: [
      "See a dermatologist. Within 2 weeks is best if you can; the important thing is not to put it off.",
      "At the appointment, asking them to \"look at a pigmented band on my nail with dermoscopy\" gets things moving faster.",
      "Bring any older photos of your hands. Whether the band has gotten wider is an important clue.",
      "Leave off nail polish and trim your nails short so they're easy to examine.",
    ],
    watchFor: [
      "The band gets wider or darker",
      "The color spreads to the cuticle or the skin beside the nail",
      "The nail splits or lifts, or you see blood",
    ],
    timeframe: "Until your appointment, photograph it every 2 weeks in the same light and compare",
  },
];

const HEADLINES = [
  "Looks fairly even overall",
  "Looks about the same as last time",
  "The lines look a little softer",
  "The skin around the nail looks calmer",
];

const SUMMARIES = [
  "Color and surface look fairly even, with shallow vertical lines in the middle and some dryness in the surrounding skin. A photo can't tell much beyond that, so comparing with how your nail usually looks is a good idea.",
  "The overall color is fairly uniform and the tip looks smooth. The vertical lines in the middle look about the same as in your last photo and can stand out more depending on the light.",
  "The surface shine looks even and the flaking around the cuticle is less noticeable. Nail shape and thickness look about the same as before.",
  "Color and thickness show no noticeable change. The skin along the side of the nail looks smoother than before, though the camera angle may play a part.",
];


  const TIPS: NailAnalysis["tips"] = [
      {
        category: "hydration",
        title: "Moisturize to the fingertips",
        detail:
          "Rubbing cream into the skin around your nails after washing makes dry flakes less noticeable.",
      },
      {
        category: "care",
        title: "File in one direction",
        detail:
          "Filing gently in one direction, rather than sawing back and forth, is easier on the tips.",
      },
      {
        category: "habit",
        title: "Gloves for detergent",
        detail:
          "Rubber gloves help for dishes, cleaning and other long chores in water and detergent.",
      },
      {
        category: "nutrition",
        title: "Eat a varied diet",
        detail:
          "A balanced diet with protein and vegetables supports how you feel overall.",
      },
    ];

  const CONSULT: string[] = [
      "A color change on just one nail that stays for several weeks or more",
      "Swelling or pain around the nail, together with fluid",
      "The nail lifting from the finger, or a noticeable change in thickness",
    ];

  return { OBSERVATIONS, FINDINGS, HEADLINES, SUMMARIES, TIPS, CONSULT };
})();

/* ---------------------------------- DEMO_KO ---------------------------------- */

const DEMO_KO = (() => {
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
 * 특이 사항 샘플. 실제 응답과 같은 모양(보이는 것 → 이 모습의 이름 → 이런 모습을
 * 만드는 상태들 → 위험 신호 점검 → 사진의 한계 → 대응)을 갖춰, 데모에서도 화면
 * 구성이 그대로 드러나게 한다. 색소 띠 예시는 soon 단계 화면을 보여 주기 위한 것이다.
 */
const FINDINGS: Finding[] = [
  {
    metric: "ridges",
    label: "세로 줄무늬",
    detail:
      "손톱 중앙에서 끝쪽으로 이어지는 얕은 세로 결이 3~4줄 보입니다. 손톱 전체에 고르게 퍼져 있고, 한 줄만 유독 깊어 보이지는 않습니다.",
    patternNames: ["세로 능선(onychorrhexis 계열의 종주름)"],
    possibilities: [
      {
        name: "나이에 따른 생리적 세로 능선",
        likelihood: "likely",
        why: "여러 줄이 손톱 전체에 고르게 퍼져 있고 한 줄만 두드러지지 않는 모습은 나이가 들면서 누구에게나 흔히 생기는 변화와 잘 맞습니다.",
      },
      {
        name: "건조와 반복적인 물·세제 접촉에 따른 변화",
        likelihood: "possible",
        why: "손톱 바깥층의 수분이 줄면 같은 결이 더 도드라져 보입니다. 설거지나 소독을 자주 하는 손에서 흔하게 관찰됩니다.",
      },
    ],
    signChecks: [
      {
        sign: "한 줄만 깊고 넓어짐",
        state: "absent",
        note: "줄의 굵기가 서로 비슷하게 보입니다.",
      },
      {
        sign: "줄을 따라 갈라짐",
        state: "absent",
        note: "끝부분이 매끄럽게 이어집니다.",
      },
      {
        sign: "결의 실제 깊이",
        state: "unclear",
        note: "사진으로는 깊이를 잴 수 없습니다.",
      },
    ],
    cannotTell:
      "사진으로는 결의 깊이를 잴 수 없고, 조명 각도에 따라 실제보다 뚜렷해 보이기도 합니다.",
    attention: "routine",
    nextSteps: [
      "따로 진료가 필요한 모습은 아니며, 같은 조명에서 몇 달 간격으로 찍어 비교해 보세요.",
      "손을 씻은 뒤 손톱 주변까지 보습하면 결이 덜 도드라져 보입니다.",
    ],
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
    patternNames: [],
    possibilities: [
      {
        name: "손 습진 계열의 건조성 변화",
        likelihood: "possible",
        why: "손을 자주 씻거나 세제·소독제에 닿는 손에서 흔하게 나타나는 모습입니다. 각질이 일어나고 가려움이 함께 오는 경우가 많습니다.",
      },
      {
        name: "큐티클을 밀거나 뜯는 습관에 따른 자극",
        likelihood: "possible",
        why: "손톱을 감싸는 피부가 반복해서 자극을 받으면 각질과 잔거스러미가 잘 생깁니다.",
      },
      {
        name: "만성 손톱 주위염",
        likelihood: "uncommon",
        why: "같은 자리가 반복해서 붓고 아프다면 이 이름으로 부릅니다. 이 사진에서는 붓기나 진물이 보이지 않습니다.",
      },
    ],
    signChecks: [
      {
        sign: "손톱 옆선의 붓기",
        state: "absent",
        note: "옆선이 부어오른 모습은 보이지 않습니다.",
      },
      {
        sign: "진물이나 고름",
        state: "absent",
        note: "젖어 보이는 부분이 없습니다.",
      },
      {
        sign: "누를 때의 통증",
        state: "unclear",
        note: "사진으로는 알 수 없습니다.",
      },
    ],
    cannotTell:
      "사진만으로는 단순한 건조인지 습진에 해당하는지 구분하기 어렵습니다. 진료실에서는 손을 직접 보고 다른 부위 피부까지 함께 살핍니다.",
    attention: "monitor",
    nextSteps: [
      "2~3주 보습을 챙겨 본 뒤에도 그대로거나 더 심해지면 피부과 진료를 생각해 보세요.",
      "물·세제에 오래 닿는 일에는 장갑을 쓰고, 큐티클은 밀거나 뜯지 마세요.",
    ],
    watchFor: [
      "손톱 옆선이 붉게 부어오르거나 누르면 아플 때",
      "진물이 보이거나 같은 자리가 반복해서 덧날 때",
    ],
    timeframe: "2~3주 보습을 챙긴 뒤 다시 촬영",
  },
  {
    metric: "color",
    label: "한 손톱의 갈색 세로 띠",
    detail:
      "오른손 검지 손톱에만 뿌리에서 끝까지 이어지는 갈색 세로 띠가 보입니다. 폭은 손톱 너비의 약 1/5로 3mm 안팎이고, 띠 안에서 색이 고르지 않아 진한 선과 옅은 선이 섞여 보입니다.",
    patternNames: ["조갑 흑색선조(melanonychia striata)"],
    possibilities: [
      {
        name: "양성 색소 침착(민족적 색소 침착)",
        likelihood: "possible",
        why: "색소가 많은 피부에서는 여러 손톱에 갈색 띠가 생기는 일이 흔합니다. 다만 이 사진에서는 한 손톱에만 보입니다.",
      },
      {
        name: "손톱 모반(nail matrix nevus)",
        likelihood: "possible",
        why: "손톱을 만드는 부분에 점이 있으면 자라는 손톱을 따라 띠가 생깁니다. 어릴 때 생겨 오래 그대로인 경우가 많습니다.",
      },
      {
        name: "조갑하 혈종",
        likelihood: "uncommon",
        why: "눌리거나 부딪힌 뒤 고인 피가 띠처럼 보이기도 합니다. 이 경우 손톱이 자라면서 끝으로 밀려 나가 위치가 바뀝니다.",
      },
      {
        name: "손발톱 흑색종(subungual melanoma)",
        likelihood: "rare_important",
        why: "드물지만, 한 손톱에만 있고 폭이 넓으며 색이 고르지 않은 띠에서 눈여겨보는 이름입니다. 사진으로는 가릴 수 없고 진료실에서 확인하는 것이 유일한 방법이라 목록에 함께 적습니다.",
      },
    ],
    signChecks: [
      {
        sign: "폭 3mm 이상",
        state: "present",
        note: "손톱 너비의 약 1/5로 3mm 안팎으로 보입니다.",
      },
      {
        sign: "띠 안의 색조가 고르지 않음",
        state: "present",
        note: "진한 선과 옅은 선이 섞여 보입니다.",
      },
      {
        sign: "한 손가락에만 있음",
        state: "present",
        note: "이 사진에는 한 손톱만 담겨 있어, 다른 손톱은 함께 찍은 사진이 필요합니다.",
      },
      {
        sign: "주변 피부로 색소 번짐",
        state: "absent",
        note: "큐티클과 옆선까지 이어지는 색은 보이지 않습니다.",
      },
      {
        sign: "경계가 흐리거나 불규칙함",
        state: "unclear",
        note: "이 해상도에서는 경계선을 또렷하게 확인하기 어렵습니다.",
      },
      {
        sign: "최근에 넓어지거나 짙어짐",
        state: "unclear",
        note: "사진 한 장으로는 알 수 없습니다. 예전 사진이 있으면 비교해 보세요.",
      },
    ],
    cannotTell:
      "사진으로는 색소가 손톱판 안에 있는지 아래 피부에 있는지, 양성인지 아닌지 가릴 수 없습니다. 진료실에서는 확대경(더모스코피)으로 보고, 필요하면 손톱 뿌리 쪽 조직검사로 확인합니다.",
    attention: "soon",
    nextSteps: [
      "피부과 진료를 받아 보세요. 가능하면 2주 안이 좋고, 오래 미루지 않는 것이 중요합니다.",
      "진료 때 \"손톱 색소 띠를 더모스코피로 봐 달라\"고 말씀하시면 이야기가 빨라집니다.",
      "예전에 찍은 손 사진이 있으면 함께 가져가세요. 띠가 넓어졌는지가 중요한 단서입니다.",
      "매니큐어를 바르지 말고, 손톱을 짧게 깎아 두면 진료 때 보기 좋습니다.",
    ],
    watchFor: [
      "띠가 넓어지거나 색이 더 진해질 때",
      "색이 큐티클이나 손톱 옆 피부까지 이어질 때",
      "손톱이 갈라지거나 들뜨고, 피가 비칠 때",
    ],
    timeframe: "진료 전까지 2주 간격으로 같은 조명에서 촬영해 비교",
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


  const TIPS: NailAnalysis["tips"] = [
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
    ];

  const CONSULT: string[] = [
      "한 손톱에만 생긴 색 변화가 몇 주 이상 그대로 이어질 때",
      "손톱 주변이 붓거나 아프고, 진물이 함께 보일 때",
      "손톱이 손가락에서 들뜨거나 두께가 눈에 띄게 달라질 때",
    ];

  return { OBSERVATIONS, FINDINGS, HEADLINES, SUMMARIES, TIPS, CONSULT };
})();

export function buildDemoAnalysis(seed: number, locale: Locale = "en"): NailAnalysis {
  const { OBSERVATIONS, FINDINGS, HEADLINES, SUMMARIES, TIPS, CONSULT } =
    locale === "ko" ? DEMO_KO : DEMO_EN;
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
    // seed 에 따라 특이 사항 개수를 1~3개로 바꾼다. 실제 응답과 같도록
    // 신경 쓸 단계가 높은 것부터 보이게 정렬한다.
    findings: FINDINGS.slice(0, 1 + (seed % 3))
      .slice()
      .sort((a, b) => ATTENTION_RANK[b.attention] - ATTENTION_RANK[a.attention]),
    tips: TIPS,
    consultSignals: CONSULT,
  };
}
