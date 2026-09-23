import { useState } from "react";
import { DISCLAIMER_SHORT } from "../../../shared/analysis";
import {
  CameraIcon,
  CheckIcon,
  HistoryIcon,
  ShieldIcon,
  SparkIcon,
  StethoscopeIcon,
} from "../components/Icons";

/**
 * 처음 연 사람에게 이 앱이 무엇이고 무엇이 아닌지 먼저 말한다.
 * 세 장이고, 어느 장에서든 건너뛸 수 있다.
 */
const SLIDES = [
  {
    icon: <CameraIcon size={26} />,
    title: "손톱 사진 한 장으로 시작해요",
    body: "촬영하거나 갤러리에서 고르면, AI가 사진에서 보이는 손톱의 겉모습을 항목별로 정리해 드려요.",
    points: [
      "색상 · 표면 · 줄무늬 · 갈라짐 · 두께 · 주변 피부 6가지 관찰",
      "눈에 띄는 특징은 이름과 지켜볼 변화까지 함께",
    ],
  },
  {
    icon: <StethoscopeIcon size={26} />,
    title: "진단이 아니라 정리예요",
    body: "사진 한 장으로는 질병을 가릴 수 없어요. 이 앱은 여러 가능성을 나란히 보여 줄 뿐, 어느 하나로 확정하지 않아요.",
    points: [
      "병을 확정하거나 확률로 말하지 않아요",
      "약이나 시술을 안내하지 않아요",
      "확인이 필요해 보이면 진료를 권해요",
    ],
    caution: true,
  },
  {
    icon: <ShieldIcon size={24} />,
    title: "사진은 기기 안에 남아요",
    body: "손톱 사진은 분석할 때만 서버를 거치고, 서버에 저장되지 않아요. 기록과 사진은 언제든 지울 수 있어요.",
    points: [
      "업로드 전 촬영 위치 · 기기 정보(EXIF)를 지워요",
      "사진은 이 기기의 브라우저 안에만 보관해요",
      "공유 카드에는 사진이 들어가지 않아요",
    ],
  },
];

export function OnboardingScreen({ onDone }: { onDone: () => void }) {
  const [index, setIndex] = useState(0);
  const slide = SLIDES[index]!;
  const last = index === SLIDES.length - 1;

  return (
    <main className="screen onboarding">
      <div className="onboarding-top">
        <div className="brandmark">
          <SparkIcon size={15} />
          NailSense
        </div>
        <button className="link-btn" onClick={onDone}>
          건너뛰기
        </button>
      </div>

      <div className="onboarding-body stagger" key={index}>
        <div className={`onboarding-icon${slide.caution ? " caution" : ""}`}>
          {slide.icon}
        </div>
        <h2>{slide.title}</h2>
        <p className="lead">{slide.body}</p>

        <ul className="onboarding-points">
          {slide.points.map((point) => (
            <li key={point}>
              <span className="mark">
                <CheckIcon size={11} />
              </span>
              {point}
            </li>
          ))}
        </ul>
      </div>

      <div className="onboarding-foot">
        <div className="dots" aria-hidden="true">
          {SLIDES.map((item, i) => (
            <span key={item.title} className={i === index ? "on" : ""} />
          ))}
        </div>

        <div className="small muted center" style={{ marginBottom: 12 }}>
          {DISCLAIMER_SHORT}
        </div>

        <button
          className="btn btn-primary"
          onClick={() => (last ? onDone() : setIndex(index + 1))}
        >
          {last ? (
            <>
              <HistoryIcon size={18} />
              시작하기
            </>
          ) : (
            "다음"
          )}
        </button>
      </div>
    </main>
  );
}
