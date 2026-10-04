import { ANALYSIS_TEXT_EN, ANALYSIS_TEXT_KO } from "../../shared/analysis";
import { KO } from "./i18n";

/**
 * 화면에서 쓰는 라벨. shared/analysis 의 영어 상수와 이름이 같고, 지금 언어에 맞는 쪽을 내보낸다.
 * 화면 코드는 라벨을 shared/analysis 가 아니라 여기서 가져온다.
 */
const text = KO ? ANALYSIS_TEXT_KO : ANALYSIS_TEXT_EN;

export const METRIC_LABELS = text.METRIC_LABELS;
export const METRIC_DESCRIPTIONS = text.METRIC_DESCRIPTIONS;
export const STATUS_LABELS = text.STATUS_LABELS;
export const CONFIDENCE_LABELS = text.CONFIDENCE_LABELS;
export const ATTENTION_LABELS = text.ATTENTION_LABELS;
export const ATTENTION_DESCRIPTIONS = text.ATTENTION_DESCRIPTIONS;
export const LIKELIHOOD_LABELS = text.LIKELIHOOD_LABELS;
export const SIGN_STATE_LABELS = text.SIGN_STATE_LABELS;
export const TIP_CATEGORY_LABELS = text.TIP_CATEGORY_LABELS;
export const FINGER_LABELS = text.FINGER_LABELS;
export const DISCLAIMER_SHORT = text.DISCLAIMER_SHORT;
export const DISCLAIMER_LONG = text.DISCLAIMER_LONG;
