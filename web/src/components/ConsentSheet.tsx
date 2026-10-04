import { useState } from "react";
import { legalDocs } from "../../../shared/legal";
import { KO, L, LOCALE } from "../i18n";
import { BackIcon, CheckIcon } from "./Icons";
import { LegalDocView } from "./Legal";
import { Sheet } from "./ui";

/**
 * 첫 분석 전에 건강 데이터 처리에 대한 명시적 동의를 받는다.
 *
 * 미리 체크해 두지 않는다. 사진이 어디로 가고 무엇이 남는지를 먼저 보여 주고,
 * 사용자가 직접 체크해야 분석 버튼이 켜진다. 거절해도 앱의 다른 기능(기록, 건강 정보)은
 * 그대로 쓸 수 있다.
 *
 * 한국어 화면은 개인정보보호법에 맞춰 두 가지를 따로 받는다.
 * (1) 민감정보(건강 정보) 처리 동의: 목적, 항목, 보유 기간, 거부할 권리와 불이익
 * (2) 국외 이전 동의: 받는 곳, 국가, 시기와 방법, 항목, 목적과 보유 기간, 거부 방법과 효과
 */
export function ConsentSheet({
  signedIn,
  provider,
  onAgree,
  onClose,
}: {
  signedIn: boolean;
  /** 지금 서버가 쓰는 분석 업체 이름("Gemini" 또는 "Claude"). 모르면 둘 다 적는다. */
  provider?: string | null;
  onAgree: () => void;
  onClose: () => void;
}) {
  const [checked, setChecked] = useState(false);
  const [transferChecked, setTransferChecked] = useState(false);
  const [showPolicy, setShowPolicy] = useState(false);
  const policy = legalDocs(LOCALE).privacy;

  if (showPolicy) {
    return (
      <Sheet label={policy.title} onClose={onClose}>
        <button className="link" onClick={() => setShowPolicy(false)}>
          <BackIcon size={16} />
          {L("Back", "돌아가기")}
        </button>
        <LegalDocView doc={policy} />
        <button className="btn btn-secondary mt-24" onClick={() => setShowPolicy(false)}>
          {L("Back", "돌아가기")}
        </button>
      </Sheet>
    );
  }

  const aiCompany =
    provider === "Claude"
      ? "Anthropic PBC"
      : provider === "Gemini"
        ? "Google LLC"
        : "Google LLC 또는 Anthropic PBC";
  const ready = checked && (!KO || transferChecked);

  return (
    <Sheet label={L("Before your first scan", "첫 분석 전에")} onClose={onClose}>
      <h3>{L("Before your first scan", "첫 분석 전에")}</h3>
      <p>
        {L(
          "To describe your nail, NailSense sends the photo to our server and to our AI analysis provider. A nail photo and its description can reveal information about your health, so we need your permission first.",
          "손톱을 설명하려면 사진을 NailSense 서버와 AI 분석 업체로 보내야 해요. 손톱 사진과 그 설명은 건강에 관한 정보를 드러낼 수 있어서, 먼저 동의를 받아요.",
        )}
      </p>
      <ul className="consent-points">
        <li>
          <CheckIcon size={16} weight="bold" />
          <span>
            {L(
              "The photo is used only for the analysis and isn't stored on our server.",
              "사진은 분석에만 쓰고 서버에 저장하지 않아요.",
            )}
          </span>
        </li>
        <li>
          <CheckIcon size={16} weight="bold" />
          <span>
            {signedIn
              ? L(
                  "Results are saved to your account so you can see them on other devices.",
                  "결과는 계정에 저장되어 다른 기기에서도 볼 수 있어요.",
                )
              : L(
                  "Results stay on this device unless you log in.",
                  "로그인하지 않으면 결과는 이 기기에만 남아요.",
                )}
          </span>
        </li>
        <li>
          <CheckIcon size={16} weight="bold" />
          <span>
            {L(
              "Our server and AI provider are in the United States.",
              "서버와 AI 분석 업체는 미국에 있어요.",
            )}
          </span>
        </li>
        <li>
          <CheckIcon size={16} weight="bold" />
          <span>
            {L(
              "We don't sell your data or use it for ads or AI training.",
              "정보를 팔거나 광고·AI 학습에 쓰지 않아요.",
            )}
          </span>
        </li>
        <li>
          <CheckIcon size={16} weight="bold" />
          <span>
            {L("You can withdraw this anytime in Profile.", "프로필에서 언제든 철회할 수 있어요.")}
          </span>
        </li>
      </ul>

      {KO ? (
        <>
          <details className="consent-detail mt-16">
            <summary>민감정보(건강 정보) 처리 안내</summary>
            <dl>
              <dt>목적</dt>
              <dd>사진에 보이는 손톱의 겉모습 설명, 결과 보관</dd>
              <dt>항목</dt>
              <dd>손톱 사진, 메모, 분석 결과</dd>
              <dt>보유 기간</dt>
              <dd>사진은 저장하지 않음. 결과는 삭제하거나 탈퇴할 때까지</dd>
              <dt>거부할 권리</dt>
              <dd>동의하지 않을 수 있으며, 이 경우 사진 분석을 이용할 수 없어요.</dd>
            </dl>
          </details>
          <label className="check">
            <input
              type="checkbox"
              checked={checked}
              onChange={(event) => setChecked(event.target.checked)}
            />
            <span>[필수] 위 민감정보(건강 정보) 처리에 동의합니다.</span>
          </label>

          <details className="consent-detail mt-16">
            <summary>개인정보 국외 이전 안내</summary>
            <dl>
              <dt>받는 곳</dt>
              <dd>Fly.io, Inc.(서버 운영), {aiCompany}(AI 분석)</dd>
              <dt>국가</dt>
              <dd>미국</dd>
              <dt>시기와 방법</dt>
              <dd>분석할 때마다 네트워크로 전송</dd>
              <dt>항목</dt>
              <dd>손톱 사진, 메모, 분석 결과, 계정 정보</dd>
              <dt>목적과 보유 기간</dt>
              <dd>서버 운영과 사진 분석. 사진은 분석 후 보관하지 않음</dd>
              <dt>거부 방법과 효과</dt>
              <dd>체크하지 않으면 돼요. 이 경우 사진 분석을 이용할 수 없어요.</dd>
            </dl>
          </details>
          <label className="check">
            <input
              type="checkbox"
              checked={transferChecked}
              onChange={(event) => setTransferChecked(event.target.checked)}
            />
            <span>[필수] 위 개인정보 국외 이전에 동의합니다.</span>
          </label>
        </>
      ) : (
        <label className="check">
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => setChecked(event.target.checked)}
          />
          <span>
            I agree to NailSense processing my nail photos, which may reveal health
            information, on servers in the United States, to describe them as set out
            in the Privacy Policy.
          </span>
        </label>
      )}
      <button className="link" onClick={() => setShowPolicy(true)}>
        {L("Read the Privacy Policy", "개인정보처리방침 보기")}
      </button>

      <div className="btn-row mt-16">
        <button className="btn btn-secondary" onClick={onClose}>
          {L("Not now", "다음에")}
        </button>
        <button className="btn btn-primary" disabled={!ready} onClick={onAgree}>
          {L("Agree and analyze", "동의하고 분석")}
        </button>
      </div>
    </Sheet>
  );
}
