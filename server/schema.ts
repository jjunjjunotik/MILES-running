import { z } from "zod";
import {
  CONFIDENCE_KEYS,
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
