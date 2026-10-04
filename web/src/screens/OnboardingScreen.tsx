import { useState } from "react";
import {
  DISCLAIMER_SHORT,
} from "../labels";
import { CheckIcon } from "../components/Icons";
import { L } from "../i18n";

/**
 * 처음 연 사람에게 이 앱이 무엇이고 무엇이 아닌지 먼저 말한다.
 * 세 장이고, 어느 장에서든 건너뛸 수 있다.
 */
const SLIDES = [
  {
    title: L("Start with one photo of a nail", "손톱 사진 한 장으로 시작해요"),
    body: L("Take a photo or pick one from your library, and an analysis model describes how the nail looks, area by area.", "촬영하거나 앨범에서 고르면, 분석 모델이 사진에 보이는 손톱의 겉모습을 항목별로 정리해요."),
    points: [
      L("Looks at color, surface, ridges, splitting, thickness and shape, and the surrounding skin", "색상, 표면, 줄무늬, 갈라짐, 두께와 모양, 주변 피부를 살펴봐요"),
      L("Anything that stands out comes with its name and the changes to watch for", "눈에 띄는 특징은 이름과 지켜볼 변화까지 함께 알려 드려요"),
    ],
  },
  {
    title: L("A description, not a diagnosis", "진단이 아니라 정리예요"),
    body: L("A single photo can't identify a disease. The app lays out possibilities side by side and never settles on one of them.", "사진 한 장으로는 질병을 가릴 수 없어요. 이 앱은 여러 가능성을 나란히 보여 줄 뿐, 어느 하나로 확정하지 않아요."),
    points: [
      L("No diagnoses and no disease probabilities", "병을 확정하거나 확률로 말하지 않아요"),
      L("No medicines or treatments", "약이나 시술을 안내하지 않아요"),
      L("Suggests seeing a doctor when something needs a closer look", "확인이 필요해 보이면 진료를 권해요"),
    ],
  },
  {
    title: L("Your photos stay on your device", "사진은 기기 안에 남아요"),
    body: L("Photos pass through our server only for analysis and are never stored there. You can delete your history and photos anytime.", "손톱 사진은 분석할 때만 서버를 거치고 서버에 저장되지 않아요. 기록과 사진은 언제든 지울 수 있어요."),
    points: [
      L("Photos are kept only in this browser", "사진은 이 기기의 브라우저 안에만 보관해요"),
      L("Share cards never include your photo", "공유 카드에는 사진이 들어가지 않아요"),
    ],
  },
];

export function OnboardingScreen({ onDone }: { onDone: () => void }) {
  const [index, setIndex] = useState(0);
  const slide = SLIDES[index]!;
  const last = index === SLIDES.length - 1;

  return (
    <main className="screen onboarding">
      <div className="flow-top">
        <span className="wordmark">NailSense</span>
        <button className="link link-quiet" onClick={onDone}>
          {L("Skip", "건너뛰기")}
        </button>
      </div>

      {/* 세 장 중 어디쯤인지. 실제 순서가 있는 흐름이라 칸으로 보여 준다. */}
      <div
        className="progress"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={SLIDES.length}
        aria-valuenow={index + 1}
        aria-label={L("Introduction", "소개")}
      >
        {SLIDES.map((item, i) => (
          <span key={item.title} className={i <= index ? "on" : ""} />
        ))}
      </div>

      <div className="ob-body" key={index}>
        <h2>{slide.title}</h2>
        <p className="lead">{slide.body}</p>
        <ul className="ob-points">
          {slide.points.map((point) => (
            <li key={point}>
              <CheckIcon size={16} weight="bold" />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="ob-foot">
        <p className="fineprint" style={{ margin: 0 }}>
          {DISCLAIMER_SHORT}
        </p>
        <button
          className="btn btn-primary"
          onClick={() => (last ? onDone() : setIndex(index + 1))}
        >
          {last ? L("Get started", "시작하기") : L("Next", "다음")}
        </button>
      </div>
    </main>
  );
}
