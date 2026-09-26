import { TIP_CATEGORY_LABELS, type Tip } from "../../../shared/analysis";

export function TipList({ tips }: { tips: Tip[] }) {
  return (
    <ul className="tips">
      {tips.map((tip, index) => (
        <li key={`${tip.category}-${index}`}>
          <div className="tip-cat">{TIP_CATEGORY_LABELS[tip.category]}</div>
          <div className="tip-title">{tip.title}</div>
          <div className="tip-detail">{tip.detail}</div>
        </li>
      ))}
    </ul>
  );
}
