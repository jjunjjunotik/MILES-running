import {
  ATTENTION_RANK,
  METRIC_KEYS,
  type Finding,
  type NailAnalysis,
} from "./analysis.js";

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
    // seed 에 따라 특이 사항 개수를 1~3개로 바꾼다. 실제 응답과 같도록
    // 신경 쓸 단계가 높은 것부터 보이게 정렬한다.
    findings: FINDINGS.slice(0, 1 + (seed % 3))
      .slice()
      .sort((a, b) => ATTENTION_RANK[b.attention] - ATTENTION_RANK[a.attention]),
    tips: [
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
    ],
    consultSignals: [
      "A color change on just one nail that stays for several weeks or more",
      "Swelling or pain around the nail, together with fluid",
      "The nail lifting from the finger, or a noticeable change in thickness",
    ],
  };
}
