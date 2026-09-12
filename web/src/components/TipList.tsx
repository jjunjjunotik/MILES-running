import {
  TIP_CATEGORY_LABELS,
  type Tip,
} from "../../../shared/analysis";
import {
  DropIcon,
  HandIcon,
  LeafIcon,
  MoonIcon,
  SparkIcon,
  type IconProps,
} from "./Icons";

const ICONS: Record<
  Tip["category"],
  (props: IconProps) => React.JSX.Element
> = {
  nutrition: LeafIcon,
  hydration: DropIcon,
  care: SparkIcon,
  habit: HandIcon,
  rest: MoonIcon,
};

export function TipList({ tips }: { tips: Tip[] }) {
  return (
    <div className="card">
      {tips.map((tip, index) => {
        const Icon = ICONS[tip.category] ?? SparkIcon;
        return (
          <div className="tip" key={`${tip.category}-${index}`}>
            <div className="ico">
              <Icon />
            </div>
            <div className="flex-1">
              <div className="t">{tip.title}</div>
              <div className="d">{tip.detail}</div>
              <div className="mt-8">
                <span className="pill pill-neutral">
                  {TIP_CATEGORY_LABELS[tip.category]}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
