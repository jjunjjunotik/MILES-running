import { z } from "zod";
import {
  ATTENTION_KEYS,
  CONFIDENCE_KEYS,
  LIKELIHOOD_KEYS,
  SIGN_STATES,
  METRIC_KEYS,
  STATUS_KEYS,
  TIP_CATEGORIES,
  type NailAnalysis,
} from "../shared/analysis.js";

/**
 * 모델이 돌려줄 구조를 정의한다. 이 스키마는 서버에서만 쓰이며
 * 브라우저 번들에는 포함되지 않는다.
 *
 * 필드 설명(describe)은 프롬프트의 일부처럼 동작하므로,
 * 진단으로 미끄러지지 않게 하는 지시를 여기에도 함께 적어 둔다.
 */
export const MetricSchema = z.object({
  key: z.enum(METRIC_KEYS).describe("Observation area key"),
  status: z
    .enum(STATUS_KEYS)
    .describe(
      "good=nothing noticeable, watch=a visible change worth watching, consult=hard to judge from a photo, better shown to a professional in person. This is not disease severity.",
    ),
  confidence: z
    .enum(CONFIDENCE_KEYS)
    .describe("How clearly this area could be seen in this photo"),
  observation: z
    .string()
    .describe(
      "Only what is actually visible in the photo, in 1-2 sentences. Example: 'Several vertical lines run through the middle of the nail.' Don't mention causes or condition names.",
    ),
  explanation: z
    .string()
    .describe(
      "2-3 sentences of general educational information about what this kind of appearance can be linked to. Use only general statements like 'this can happen when...' or 'this is sometimes linked to...', and never conclude that this user has a specific condition.",
    ),
});

export const PossibilitySchema = z.object({
  name: z
    .string()
    .describe(
      "The real name as it is actually used. Examples: 'longitudinal melanonychia', 'subungual hematoma', 'subungual melanoma', 'onychomycosis'. Don't blur the name or dodge it with something like 'some kind of infection'.",
    ),
  likelihood: z
    .enum(LIKELIHOOD_KEYS)
    .describe(
      "likely=the photo fits this condition well, possible=it's possible, uncommon=not common, rare_important=rare but important not to miss. This is weight within the list, not a confirmation from the photo.",
    ),
  why: z
    .string()
    .describe(
      "2-3 sentences on why this name is on the list (which feature of the photo) and how this condition generally comes about. Never conclude that this user has it.",
    ),
});

export const SignCheckSchema = z.object({
  sign: z
    .string()
    .describe("Name of the warning sign checked, under 40 characters. Examples: 'Width of 3 mm or more', 'Pigment spreading onto nearby skin'"),
  state: z
    .enum(SIGN_STATES)
    .describe(
      "present=visible in the photo, absent=not visible in the photo, unclear=can't be confirmed from the photo. Never mark something absent if it can't be confirmed. This distinction matters more than anything else in this app.",
    ),
  note: z.string().describe("One line on how it looked in the photo"),
});

/**
 * 눈에 띄는 특징 하나를 자세히 풀어 쓴 항목.
 * 보이는 것 → 이 모습의 이름 → 이런 모습을 만드는 상태들 → 위험 신호 점검 →
 * 사진의 한계 → 무엇을 할지 순서로 한 묶음을 이룬다.
 */
export const FindingSchema = z.object({
  metric: z.enum(METRIC_KEYS).describe("Key of the observation area this feature belongs to"),
  label: z
    .string()
    .describe(
      "Short name for the appearance, under 40 characters. Examples: 'Brown vertical band on one nail', 'Peeling layers at the tip', 'Small pits in the surface'.",
    ),
  detail: z
    .string()
    .describe(
      "2-3 specific sentences on where this feature appears in the photo (middle, tip, side fold, etc.), how far it extends and how distinct it is. Always include anything countable, such as width, number or differences in color.",
    ),
  patternNames: z
    .array(z.string())
    .describe(
      "0-2 medical names for the appearance itself. Examples: 'longitudinal melanonychia', 'Beau's lines', 'nail pitting'. These name the appearance, not a condition. Empty array if no term applies.",
    ),
  possibilities: z
    .array(PossibilitySchema)
    .describe(
      "2-5 conditions that can produce this appearance, by their real names, most common first. If something rare but important not to miss applies (such as subungual melanoma), always include it as rare_important. Never narrow it down to one.",
    ),
  signChecks: z
    .array(SignCheckSchema)
    .describe(
      "Results of checking 2-6 warning signs relevant to this feature. Anything the photo can't confirm must be unclear.",
    ),
  cannotTell: z
    .string()
    .describe(
      "1-2 sentences on what a photo alone can't tell apart, and which methods are used in the clinic to check (dermoscopy, biopsy, fungal test, etc.).",
    ),
  attention: z
    .enum(ATTENTION_KEYS)
    .describe(
      "routine=everyday care is enough, monitor=photograph again and compare, consult=better shown in person, soon=see a doctor without putting it off. If any warning sign is present, use soon; if a key sign remains unclear, use at least consult.",
    ),
  nextSteps: z
    .array(z.string())
    .describe(
      "2-4 next steps: which kind of doctor and when (e.g. 'See a dermatologist, within 2 weeks if you can'), what to ask for and bring (e.g. 'Ask them to look at it with dermoscopy', 'Bring earlier photos'), and general care that reduces irritation. Never mention medicine names, doses, procedures or at-home treatment.",
    ),
  watchFor: z
    .array(z.string())
    .describe(
      "2-3 observable signs, in the sense of 'if you see this change, show a professional'.",
    ),
  timeframe: z
    .string()
    .describe(
      "A short phrase for when to look again. Keep in mind nails grow about 3 mm a month. Example: 'Photograph the same nail again in 2-3 weeks'.",
    ),
});

export const TipSchema = z.object({
  category: z.enum(TIP_CATEGORIES),
  title: z.string().describe("Short title, under 30 characters"),
  detail: z
    .string()
    .describe(
      "1-2 sentences of general everyday care advice that is harmless for anyone. Don't mention supplement doses, medicines or treatment procedures.",
    ),
});

export const NailAnalysisSchema = z.object({
  isNailPhoto: z
    .boolean()
    .describe("true if a human nail is clearly visible in the photo, otherwise false"),
  imageQuality: z.object({
    usable: z.boolean().describe("true if the photo is good enough to observe"),
    issues: z
      .array(z.string())
      .describe(
        "Photo quality problems as short phrases. Examples: 'out of focus', 'too dark', 'nail plate covered by polish'. Empty array if none.",
      ),
  }),
  headline: z
    .string()
    .describe("A plain one-line overall impression, under 40 characters. It must not sound like a diagnosis."),
  summary: z
    .string()
    .describe("2-3 sentence summary of the overall appearance in the photo"),
  observationScore: z
    .number()
    .describe(
      "0-100 for how even and stable the nail's appearance looks in the photo. Not a health score or medical measure; a reference number for comparing change between photos.",
    ),
  metrics: z
    .array(MetricSchema)
    .describe(
      "All six areas, color, surface, ridges, cracks, shape, skin, in this order, exactly once each",
    ),
  findings: z
    .array(FindingSchema)
    .describe(
      "0-4 features that stand out in the photo. Empty array if nothing in particular stands out. List the ones most worth attention first. Never invent features.",
    ),
  tips: z.array(TipSchema).describe("3-4 everyday care tips related to the observations"),
  consultSignals: z
    .array(z.string())
    .describe(
      "2-4 sentences of the form 'If these changes appear together or keep going, show a professional.' Describe observable changes only, with no definitive condition names.",
    ),
});

/**
 * 스키마와 공용 타입이 어긋나면 여기서 컴파일 오류가 난다.
 * (shared/analysis.ts 는 zod 를 쓰지 않으므로 이 검사가 둘을 묶어 준다.)
 */
type SchemaOutput = z.infer<typeof NailAnalysisSchema>;
const _schemaMatchesType: SchemaOutput = null as unknown as NailAnalysis;
const _typeMatchesSchema: NailAnalysis = null as unknown as SchemaOutput;
void _schemaMatchesType;
void _typeMatchesSchema;
