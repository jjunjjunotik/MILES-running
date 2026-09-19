import {
  ATTENTION_DESCRIPTIONS,
  ATTENTION_LABELS,
  LIKELIHOOD_LABELS,
  METRIC_LABELS,
  SIGN_STATE_LABELS,
  type Finding,
  type SignState,
} from "../../../shared/analysis";
import { ClockIcon, EyeIcon, InfoIcon, StethoscopeIcon } from "./Icons";

/**
 * 눈에 띈 특징을 하나씩 펼쳐 보여 준다.
 *
 * 순서가 곧 메시지다. 보이는 것 → 이 모습의 이름 → 이런 모습을 만드는 상태들 →
 * 위험 신호 점검 → 사진으로 가릴 수 없는 것 → 그래서 무엇을 하면 되는지.
 * 상태 이름 목록과 "사진으로는 가릴 수 없다"는 문장은 떼어 놓지 말 것. 이름만
 * 남으면 진단처럼 읽히고, 한계만 남으면 아무것도 하지 않게 된다.
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
              사진에서 확인되는 범위 안에서의 이야기예요. 아래 항목별 관찰에서
              6가지를 어떻게 봤는지 확인할 수 있어요.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="finding-list">
      {findings.map((finding) => (
        <Card key={`${finding.metric}-${finding.label}`} finding={finding} />
      ))}
    </div>
  );
}

function Card({ finding }: { finding: Finding }) {
  const possibilities = finding.possibilities ?? [];
  const signChecks = finding.signChecks ?? [];
  const patternNames = finding.patternNames ?? [];
  const nextSteps = finding.nextSteps ?? [];
  const watchFor = finding.watchFor ?? [];
  const presentCount = signChecks.filter(
    (check) => check.state === "present",
  ).length;

  return (
    <article className={`finding finding-${finding.attention}`}>
      <div className="finding-head">
        <div className="flex-1">
          <div className="finding-label">{finding.label}</div>
          <div className="small muted">{METRIC_LABELS[finding.metric]} 항목</div>
        </div>
        <span
          className={`pill att-${finding.attention}`}
          title={ATTENTION_DESCRIPTIONS[finding.attention]}
        >
          <span className="dot" />
          {ATTENTION_LABELS[finding.attention]}
        </span>
      </div>

      {patternNames.length > 0 && (
        <div className="finding-terms">
          <span className="k">이 모습을 부르는 이름</span>
          {patternNames.map((name) => (
            <span className="term" key={name}>
              {name}
            </span>
          ))}
        </div>
      )}

      <p className="finding-detail">{finding.detail}</p>

      {possibilities.length > 0 && (
        <div className="finding-block">
          <div className="k">이런 모습을 만들 수 있는 상태</div>
          <ol className="poss">
            {possibilities.map((item) => (
              <li key={item.name}>
                <div className="poss-head">
                  <span className="name">{item.name}</span>
                  <span className={`chip lk-${item.likelihood}`}>
                    {LIKELIHOOD_LABELS[item.likelihood]}
                  </span>
                </div>
                <div className="why">{item.why}</div>
              </li>
            ))}
          </ol>
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

      {signChecks.length > 0 && (
        <div className="finding-block">
          <div className="k">
            위험 신호 점검
            {presentCount > 0 && (
              <span className="chip lk-rare_important">
                {presentCount}개 보임
              </span>
            )}
          </div>
          <ul className="signs">
            {signChecks.map((check) => (
              <li key={check.sign} className={`sign sign-${check.state}`}>
                <SignMark state={check.state} />
                <div>
                  <div className="s">
                    {check.sign}
                    <span className="state">
                      {SIGN_STATE_LABELS[check.state]}
                    </span>
                  </div>
                  {check.note && <div className="n">{check.note}</div>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {nextSteps.length > 0 && (
        <div className="finding-block finding-steps">
          <div className="k">
            <StethoscopeIcon size={14} />
            이렇게 해 보세요
          </div>
          <ol>
            {nextSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      )}

      {watchFor.length > 0 && (
        <div className="finding-block finding-watch">
          <div className="k">
            <EyeIcon size={14} />
            이런 변화가 보이면 다시 진료를
          </div>
          <ul>
            {watchFor.map((signal) => (
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
  );
}

/** 점검 결과를 글자 없이도 구분할 수 있게 표시한다. 색만으로 구분하지 않는다. */
function SignMark({ state }: { state: SignState }) {
  if (state === "present") {
    return (
      <span className="mark" aria-hidden="true">
        !
      </span>
    );
  }
  if (state === "absent") {
    return (
      <span className="mark" aria-hidden="true">
        ✓
      </span>
    );
  }
  return (
    <span className="mark" aria-hidden="true">
      ?
    </span>
  );
}
