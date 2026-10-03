import { useState } from "react";
import { PRIVACY_POLICY } from "../../../shared/legal";
import { BackIcon, CheckIcon } from "./Icons";
import { LegalDocView } from "./Legal";
import { Sheet } from "./ui";

/**
 * 첫 분석 전에 건강 데이터 처리에 대한 명시적 동의를 받는다.
 *
 * 미리 체크해 두지 않는다. 사진이 어디로 가고 무엇이 남는지를 먼저 보여 주고,
 * 사용자가 직접 체크해야 분석 버튼이 켜진다. 거절해도 앱의 다른 기능(기록, 건강 정보)은
 * 그대로 쓸 수 있다.
 */
export function ConsentSheet({
  signedIn,
  onAgree,
  onClose,
}: {
  signedIn: boolean;
  onAgree: () => void;
  onClose: () => void;
}) {
  const [checked, setChecked] = useState(false);
  const [showPolicy, setShowPolicy] = useState(false);

  if (showPolicy) {
    return (
      <Sheet label={PRIVACY_POLICY.title} onClose={onClose}>
        <button className="link" onClick={() => setShowPolicy(false)}>
          <BackIcon size={16} />
          Back
        </button>
        <LegalDocView doc={PRIVACY_POLICY} />
        <button className="btn btn-secondary mt-24" onClick={() => setShowPolicy(false)}>
          Back
        </button>
      </Sheet>
    );
  }

  return (
    <Sheet label="Before your first scan" onClose={onClose}>
      <h3>Before your first scan</h3>
      <p>
        To describe your nail, NailSense sends the photo to our server and to our AI
        analysis provider. A nail photo and its description can reveal information
        about your health, so we need your permission first.
      </p>
      <ul className="consent-points">
        <li>
          <CheckIcon size={16} weight="bold" />
          <span>The photo is used only for the analysis and isn't stored on our server.</span>
        </li>
        <li>
          <CheckIcon size={16} weight="bold" />
          <span>
            {signedIn
              ? "Results are saved to your account so you can see them on other devices."
              : "Results stay on this device unless you log in."}
          </span>
        </li>
        <li>
          <CheckIcon size={16} weight="bold" />
          <span>We don't sell your data or use it for ads or AI training.</span>
        </li>
        <li>
          <CheckIcon size={16} weight="bold" />
          <span>You can withdraw this anytime in Profile.</span>
        </li>
      </ul>

      <label className="check">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => setChecked(event.target.checked)}
        />
        <span>
          I agree to NailSense processing my nail photos, which may reveal health
          information, to describe them as set out in the Privacy Policy.
        </span>
      </label>
      <button className="link" onClick={() => setShowPolicy(true)}>
        Read the Privacy Policy
      </button>

      <div className="btn-row mt-16">
        <button className="btn btn-secondary" onClick={onClose}>
          Not now
        </button>
        <button className="btn btn-primary" disabled={!checked} onClick={onAgree}>
          Agree and analyze
        </button>
      </div>
    </Sheet>
  );
}
