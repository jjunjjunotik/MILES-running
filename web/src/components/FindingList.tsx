import {
  LIKELIHOOD_LABELS,
  METRIC_LABELS,
  SIGN_STATE_LABELS,
  type Finding,
  type Likelihood,
  type SignState,
} from "../../../shared/analysis";
import {
  CheckIcon,
  ClockIcon,
  EyeIcon,
  InfoIcon,
  QuestionIcon,
  WarningCircleIcon,
} from "./Icons";
import { AttentionTag, Empty } from "./ui";

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
      <Empty
        icon={<EyeIcon size={26} />}
        title="이번 사진에서 따로 짚을 만한 특징은 없었어요"
        body="사진에서 확인되는 범위 안에서의 이야기예요. 아래 항목별 관찰에서 6가지를 어떻게 봤는지 확인할 수 있어요."
      />
    );
  }

  return (
    <div className="findings">
      {findings.map((finding) => (
        <FindingCard
          key={`${finding.metric}-${finding.label}`}
          finding={finding}
        />
      ))}
    </div>
  );
}

/** 가능성 표시. 드물지만 놓치면 안 되는 것만 경고색을 쓴다. */
const LIKELIHOOD_TONE: Record<Likelihood, string> = {
  likely: "tone-accent",
  possible: "tone-neutral",
  uncommon: "tone-neutral",
  rare_important: "tone-soon",
};

function FindingCard({ finding }: { finding: Finding }) {
  const possibilities = finding.possibilities ?? [];
  const signChecks = finding.signChecks ?? [];
  const patternNames = finding.patternNames ?? [];
  const nextSteps = finding.nextSteps ?? [];
  const watchFor = finding.watchFor ?? [];
  const presentCount = signChecks.filter(
    (check) => check.state === "present",
  ).length;

  return (
    <article className="finding" data-attention={finding.attention}>
      <div className="finding-top">
        <div>
          <div className="finding-kicker">
            {METRIC_LABELS[finding.metric]} 항목
          </div>
          <h4 className="finding-title">{finding.label}</h4>
        </div>
        <AttentionTag attention={finding.attention} />
      </div>

      <p className="finding-detail">{finding.detail}</p>

      {patternNames.length > 0 && (
        <p className="terms">
          <span className="k">이 모습을 부르는 이름</span>
          {patternNames.join(", ")}
        </p>
      )}

      {possibilities.length > 0 && (
        <section className="fpart">
          <h5>이런 모습을 만들 수 있는 상태</h5>
          <ol className="poss">
            {possibilities.map((item) => (
              <li key={item.name}>
                <div className="poss-head">
                  <span className="poss-name">{item.name}</span>
                  <span className={`tag ${LIKELIHOOD_TONE[item.likelihood]}`}>
                    {LIKELIHOOD_LABELS[item.likelihood]}
                  </span>
                </div>
                <div className="poss-why">{item.why}</div>
              </li>
            ))}
          </ol>
          {finding.cannotTell && (
            <p className="limit">
              <InfoIcon size={15} />
              <span>
                사진만으로는 이 중 어느 쪽인지 가릴 수 없어요.{" "}
                {finding.cannotTell}
              </span>
            </p>
          )}
        </section>
      )}

      {signChecks.length > 0 && (
        <section className="fpart">
          <h5>
            위험 신호 점검
            {presentCount > 0 && (
              <span className="tag tone-soon">{presentCount}개 보임</span>
            )}
          </h5>
          <ul className="signs">
            {signChecks.map((check) => (
              <li key={check.sign} className={`sign ${SIGN_TONE[check.state]}`}>
                <SignMark state={check.state} />
                <div>
                  <div>
                    <span className="sign-name">{check.sign}</span>
                    <span className="sign-state">
                      {SIGN_STATE_LABELS[check.state]}
                    </span>
                  </div>
                  {check.note && <div className="sign-note">{check.note}</div>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {nextSteps.length > 0 && (
        <section className="fpart">
          <h5>이렇게 해 보세요</h5>
          <ol className="plan">
            {nextSteps.map((step) => (
              <li key={step}>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {watchFor.length > 0 && (
        <section className="fpart">
          <h5>이런 변화가 보이면 다시 진료를</h5>
          <ul>
            {watchFor.map((signal) => (
              <li key={signal}>{signal}</li>
            ))}
          </ul>
        </section>
      )}

      {finding.timeframe && (
        <p className="finding-foot">
          <ClockIcon size={16} />
          <span>
            다시 볼 시점: <b>{finding.timeframe}</b>
          </span>
        </p>
      )}
    </article>
  );
}

const SIGN_TONE: Record<SignState, string> = {
  present: "tone-soon",
  absent: "tone-routine",
  unclear: "tone-neutral",
};

/** 점검 결과를 색만이 아니라 모양으로도 구분한다. */
function SignMark({ state }: { state: SignState }) {
  if (state === "present") return <WarningCircleIcon size={17} weight="fill" />;
  if (state === "absent") return <CheckIcon size={17} weight="bold" />;
  return <QuestionIcon size={17} weight="bold" />;
}
