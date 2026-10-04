import type { Tab } from "../App";
import {
  HistoryIcon,
  HomeIcon,
  LibraryIcon,
  ProfileIcon,
  ScanIcon,
  type Icon,
} from "./Icons";
import { L } from "../i18n";

const TABS: { key: Tab; label: string; Glyph: Icon }[] = [
  { key: "home", label: L("Home", "홈"), Glyph: HomeIcon },
  { key: "scan", label: L("Scan", "스캔"), Glyph: ScanIcon },
  { key: "history", label: L("History", "기록"), Glyph: HistoryIcon },
  { key: "library", label: L("Learn", "정보"), Glyph: LibraryIcon },
  { key: "profile", label: L("Profile", "프로필"), Glyph: ProfileIcon },
];

export function TabBar({
  active,
  onChange,
}: {
  active: Tab;
  onChange: (tab: Tab) => void;
}) {
  return (
    <nav className="tabbar" aria-label={L("Main", "주요 화면")}>
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
