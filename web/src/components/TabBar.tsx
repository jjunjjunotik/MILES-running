import type { Tab } from "../App";
import {
  HistoryIcon,
  HomeIcon,
  ProfileIcon,
  ResultIcon,
  ScanIcon,
  type IconProps,
} from "./Icons";

const TABS: {
  key: Tab;
  label: string;
  Icon: (props: IconProps) => React.JSX.Element;
}[] = [
  { key: "home", label: "홈", Icon: HomeIcon },
  { key: "scan", label: "스캔", Icon: ScanIcon },
  { key: "result", label: "결과", Icon: ResultIcon },
  { key: "history", label: "기록", Icon: HistoryIcon },
  { key: "profile", label: "프로필", Icon: ProfileIcon },
];

export function TabBar({
  active,
  onChange,
}: {
  active: Tab;
  onChange: (tab: Tab) => void;
}) {
  return (
    <nav className="tabbar">
      {TABS.map(({ key, label, Icon }) => {
        const isScan = key === "scan";
        return (
          <button
            key={key}
            className={`tab${active === key ? " active" : ""}${isScan ? " tab-scan" : ""}`}
            onClick={() => onChange(key)}
            aria-current={active === key ? "page" : undefined}
          >
            {isScan ? (
              <span className="tab-icon-wrap">
                <Icon size={20} />
              </span>
            ) : (
              <Icon />
            )}
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
