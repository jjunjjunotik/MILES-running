import { useState } from "react";
import { DISCLAIMER_SHORT } from "../../../shared/analysis";
import { CheckIcon } from "../components/Icons";

/**
 * 처음 연 사람에게 이 앱이 무엇이고 무엇이 아닌지 먼저 말한다.
 * 세 장이고, 어느 장에서든 건너뛸 수 있다.
 */
const SLIDES = [
  {
    title: "Start with one photo of a nail",
    body: "Take a photo or pick one from your library, and an analysis model describes how the nail looks, area by area.",
    points: [
      "Looks at color, surface, ridges, splitting, thickness and shape, and the surrounding skin",
      "Anything that stands out comes with its name and the changes to watch for",
    ],
  },
  {
    title: "A description, not a diagnosis",
    body: "A single photo can't identify a disease. The app lays out possibilities side by side and never settles on one of them.",
    points: [
      "No diagnoses and no disease probabilities",
      "No medicines or treatments",
      "Suggests seeing a doctor when something needs a closer look",
    ],
  },
  {
    title: "Your photos stay on your device",
    body: "Photos pass through our server only for analysis and are never stored there. You can delete your history and photos anytime.",
    points: [
      "Photos are kept only in this browser",
      "Share cards never include your photo",
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
          Skip
        </button>
      </div>

      {/* 세 장 중 어디쯤인지. 실제 순서가 있는 흐름이라 칸으로 보여 준다. */}
      <div
        className="progress"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={SLIDES.length}
        aria-valuenow={index + 1}
        aria-label="Introduction"
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
          {last ? "Get started" : "Next"}
        </button>
      </div>
    </main>
  );
}
