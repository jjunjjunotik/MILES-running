import {
  ATTENTION_DESCRIPTIONS,
  ATTENTION_LABELS,
  METRIC_LABELS,
  type Finding,
} from "../../../shared/analysis";
import { ClockIcon, EyeIcon, InfoIcon } from "./Icons";

/**
 * 눈에 띈 특징을 하나씩 펼쳐 보여 준다.
 *
 * 한 장의 사진으로 원인을 가릴 수 없다는 점 때문에 요인은 항상 여러 개를 나란히
 * 보여 주고, 바로 아래에 "사진으로는 알 수 없는 것"을 붙인다. 이 둘은 떨어뜨리지 말 것.
 */
export function FindingList({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) {
    return (
      <div className="card">
        <div className="flex gap-12" style={{ alignItems: "flex-start" }}>
          <div className="icon-badge">
            <EyeIcon size={17} />
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14.5 }}>
              이번 사진에서 따로 짚을 만한 특징은 없었어요
            </div>
            <div className="small muted mt-8">
              아래 항목별 관찰에서 6가지를 어떻게 봤는지 확인할 수 있어요.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="finding-list">
      {findings.map((finding) => (
        <article
          className={`finding finding-${finding.attention}`}
          key={`${finding.metric}-${finding.label}`}
        >
          <div className="finding-head">
            <div className="flex-1">
              <div className="finding-label">{finding.label}</div>
              <div className="small muted">
                {METRIC_LABELS[finding.metric]} 항목
              </div>
            </div>
            <span
              className={`pill att-${finding.attention}`}
              title={ATTENTION_DESCRIPTIONS[finding.attention]}
            >
              <span className="dot" />
              {ATTENTION_LABELS[finding.attention]}
            </span>
          </div>

          <p className="finding-detail">{finding.detail}</p>

          {finding.causes.length > 0 && (
            <div className="finding-block">
              <div className="k">일반적으로 함께 언급되는 요인</div>
              <ul>
                {finding.causes.map((cause) => (
                  <li key={cause}>{cause}</li>
                ))}
              </ul>
              {finding.cannotTell && (
                <div className="finding-limit">
                  <InfoIcon size={13} />
                  <span>
                    사진만으로는 이 중 어느 쪽인지 가릴 수 없어요.{" "}
                    {finding.cannotTell}
                  </span>
                </div>
              )}
            </div>
          )}

          {finding.watchFor.length > 0 && (
            <div className="finding-block finding-watch">
              <div className="k">
                <EyeIcon size={14} />
                이런 변화가 보이면 전문가에게
              </div>
              <ul>
                {finding.watchFor.map((signal) => (
                  <li key={signal}>{signal}</li>
                ))}
              </ul>
            </div>
          )}

          {finding.timeframe && (
            <div className="finding-foot">
              <ClockIcon size={14} />
              다시 볼 시점 · {finding.timeframe}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
