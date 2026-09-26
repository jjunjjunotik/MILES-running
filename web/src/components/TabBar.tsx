import type { Tab } from "../App";
import {
  HistoryIcon,
  HomeIcon,
  LibraryIcon,
  ProfileIcon,
  ScanIcon,
  type Icon,
} from "./Icons";

const TABS: { key: Tab; label: string; Glyph: Icon }[] = [
  { key: "home", label: "홈", Glyph: HomeIcon },
  { key: "scan", label: "스캔", Glyph: ScanIcon },
  { key: "history", label: "기록", Glyph: HistoryIcon },
  { key: "library", label: "정보", Glyph: LibraryIcon },
  { key: "profile", label: "프로필", Glyph: ProfileIcon },
];

export function TabBar({
  active,
  onChange,
}: {
  active: Tab;
  onChange: (tab: Tab) => void;
}) {
  return (
    <nav className="tabbar" aria-label="주요 화면">
      {TABS.map(({ key, label, Glyph }) => {
        const current = active === key;
        return (
          <button
            key={key}
            className="tab"
            onClick={() => onChange(key)}
            aria-current={current ? "page" : undefined}
          >
            <Glyph size={24} weight={current ? "fill" : "regular"} />
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
