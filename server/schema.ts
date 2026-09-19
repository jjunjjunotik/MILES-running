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
  key: z.enum(METRIC_KEYS).describe("관찰 항목 키"),
  status: z
    .enum(STATUS_KEYS)
    .describe(
      "good=눈에 띄는 변화 없음, watch=변화가 보여 지켜볼 만함, consult=사진만으로 판단이 어려워 전문가에게 직접 보이는 편이 나음. 질병의 심각도가 아니다.",
    ),
  confidence: z
    .enum(CONFIDENCE_KEYS)
    .describe("이 사진에서 해당 항목을 얼마나 명확히 볼 수 있었는지"),
  observation: z
    .string()
    .describe(
      "사진에서 실제로 보이는 모습만 1~2문장으로. 예: '손톱 중앙에 세로 방향 결이 여러 줄 보입니다.' 원인이나 병명은 쓰지 말 것.",
    ),
  explanation: z
    .string()
    .describe(
      "이런 모습이 일반적으로 어떤 것과 관련될 수 있는지에 대한 교육적 일반 정보 2~3문장. '~인 경우가 있습니다', '~와 관련되기도 합니다' 같은 일반 서술만 사용하고, 이 사용자를 특정 질환으로 단정하지 말 것.",
    ),
});

export const PossibilitySchema = z.object({
  name: z
    .string()
    .describe(
      "실제로 쓰이는 이름을 그대로 적을 것. 예: '조갑 흑색선조(melanonychia striata)', '조갑하 혈종', '손발톱 흑색종', '조갑진균증'. 이름을 뭉개거나 '어떤 감염' 같은 식으로 피하지 말 것.",
    ),
  likelihood: z
    .enum(LIKELIHOOD_KEYS)
    .describe(
      "likely=사진 소견이 이 상태와 잘 맞음, possible=가능성 있음, uncommon=흔하지 않음, rare_important=드물지만 놓치면 안 되는 것. 사진으로 확정하는 것이 아니라 목록 안에서의 무게다.",
    ),
  why: z
    .string()
    .describe(
      "이 이름이 목록에 오른 근거(사진의 어떤 모습 때문인지)와 이 상태가 일반적으로 어떻게 생기는지 2~3문장. 이 사용자가 이 상태라고 단정하지 말 것.",
    ),
});

export const SignCheckSchema = z.object({
  sign: z
    .string()
    .describe("점검한 위험 신호 이름 20자 이내. 예: '폭 3mm 이상', '주변 피부로 색소 번짐'"),
  state: z
    .enum(SIGN_STATES)
    .describe(
      "present=사진에서 보임, absent=사진에서 보이지 않음, unclear=사진으로는 확인이 어려움. 확인이 안 되는 것을 absent 로 적지 말 것. 이 구분이 이 앱에서 가장 중요하다.",
    ),
  note: z.string().describe("사진에서 어떻게 보였는지 한 줄"),
});

/**
 * 눈에 띄는 특징 하나를 자세히 풀어 쓴 항목.
 * 보이는 것 → 이 모습의 이름 → 이런 모습을 만드는 상태들 → 위험 신호 점검 →
 * 사진의 한계 → 무엇을 할지 순서로 한 묶음을 이룬다.
 */
export const FindingSchema = z.object({
  metric: z.enum(METRIC_KEYS).describe("이 특징이 속한 관찰 항목 키"),
  label: z
    .string()
    .describe(
      "모양을 가리키는 짧은 이름 20자 이내. 예: '한 손톱의 갈색 세로 띠', '손톱 끝 층 갈라짐', '점처럼 파인 자국'.",
    ),
  detail: z
    .string()
    .describe(
      "사진에서 이 특징이 어디에(손톱 중앙/끝/옆선 등) 어느 범위로, 얼마나 뚜렷하게 보이는지 2~3문장으로 구체적으로. 폭·개수·색조 차이처럼 셀 수 있는 정보가 있으면 반드시 적을 것.",
    ),
  patternNames: z
    .array(z.string())
    .describe(
      "이 모습 자체를 의학에서 부르는 이름 0~2개. 예: '조갑 흑색선조(melanonychia striata)', '가로 홈(보우선, Beau's line)', '점상 함몰(pitting)'. 상태 이름이 아니라 모양의 이름이다. 해당하는 용어가 없으면 빈 배열.",
    ),
  possibilities: z
    .array(PossibilitySchema)
    .describe(
      "이런 모습을 만들 수 있는 상태 2~5개를 실제 이름으로. 흔한 것부터 적되, 드물어도 놓치면 안 되는 것(예: 손발톱 흑색종)이 해당되면 반드시 rare_important 로 포함할 것. 하나로 좁히지 말 것.",
    ),
  signChecks: z
    .array(SignCheckSchema)
    .describe(
      "이 특징에 해당하는 위험 신호를 2~6개 점검한 결과. 사진에서 확인되지 않는 항목은 반드시 unclear 로 둘 것.",
    ),
  cannotTell: z
    .string()
    .describe(
      "사진만으로는 무엇을 가릴 수 없는지 1~2문장. 확인하려면 진료실에서 어떤 방법이 쓰이는지(더모스코피, 조직검사, 진균 검사 등)를 함께 적을 것.",
    ),
  attention: z
    .enum(ATTENTION_KEYS)
    .describe(
      "routine=평소 관리로 충분, monitor=다시 찍어 비교, consult=직접 보여 주는 편이 나음, soon=미루지 말고 진료. 위험 신호가 하나라도 present 이면 soon, 핵심 신호가 unclear 로 남으면 최소 consult 로 둘 것.",
    ),
  nextSteps: z
    .array(z.string())
    .describe(
      "대응 방안 2~4개. 어느 진료과에 언제(예: '피부과 진료, 가능하면 2주 안에'), 진료 때 무엇을 요청하고 무엇을 준비할지(예: '더모스코피로 봐 달라고 요청', '이전 사진을 함께 가져가기'), 그리고 자극을 줄이는 일반 관리. 약 이름·용량·시술·집에서 하는 처치는 절대 쓰지 말 것.",
    ),
  watchFor: z
    .array(z.string())
    .describe(
      "'이런 변화가 나타나면 전문가에게 보여주세요' 형태로 관찰 가능한 신호 2~3개.",
    ),
  timeframe: z
    .string()
    .describe(
      "다시 살펴볼 간격 짧은 구절. 손톱은 한 달에 약 3mm 자란다는 점을 감안할 것. 예: '2~3주 뒤 같은 부위 재촬영'.",
    ),
});

export const TipSchema = z.object({
  category: z.enum(TIP_CATEGORIES),
  title: z.string().describe("15자 이내의 짧은 제목"),
  detail: z
    .string()
    .describe(
      "누구에게나 해가 없는 일반적인 생활 관리 조언 1~2문장. 보충제 용량, 약물, 치료 절차는 언급하지 말 것.",
    ),
});

export const NailAnalysisSchema = z.object({
  isNailPhoto: z
    .boolean()
    .describe("사진에 사람의 손톱이 충분히 보이면 true, 아니면 false"),
  imageQuality: z.object({
    usable: z.boolean().describe("관찰이 가능한 수준의 사진이면 true"),
    issues: z
      .array(z.string())
      .describe(
        "사진 품질 문제를 짧은 구절로. 예: '초점이 흐림', '조명이 어두움', '매니큐어로 손톱판이 가려짐'. 없으면 빈 배열.",
      ),
  }),
  headline: z
    .string()
    .describe("전체 인상을 담은 20자 이내의 담백한 한 줄. 진단처럼 들리지 않게."),
  summary: z
    .string()
    .describe("사진에서 보이는 전반적인 모습을 2~3문장으로 요약"),
  observationScore: z
    .number()
    .describe(
      "사진상 손톱 겉모습이 얼마나 균일하고 안정적으로 보이는지를 0~100으로 표현한 값. 건강 점수나 의학적 지표가 아니라, 사진 사이의 변화를 비교하기 위한 참고용 수치다.",
    ),
  metrics: z
    .array(MetricSchema)
    .describe(
      "color, surface, ridges, cracks, shape, skin 6개 항목을 이 순서대로 정확히 한 번씩 모두 포함",
    ),
  findings: z
    .array(FindingSchema)
    .describe(
      "사진에서 눈에 띄는 특징만 골라 0~4개. 특별히 눈에 띄는 것이 없으면 빈 배열로 둘 것. 신경 쓸 만한 것부터 먼저 나열할 것. 없는 특징을 만들어 내지 말 것.",
    ),
  tips: z.array(TipSchema).describe("관찰 결과와 연결되는 생활 관리 팁 3~4개"),
  consultSignals: z
    .array(z.string())
    .describe(
      "'이런 변화가 함께 있거나 계속된다면 전문가에게 보여주세요' 형태의 문장 2~4개. 단정적인 병명 없이 관찰 가능한 변화로만 표현.",
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
