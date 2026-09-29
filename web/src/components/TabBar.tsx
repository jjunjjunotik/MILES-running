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
  { key: "home", label: "Home", Glyph: HomeIcon },
  { key: "scan", label: "Scan", Glyph: ScanIcon },
  { key: "history", label: "History", Glyph: HistoryIcon },
  { key: "library", label: "Learn", Glyph: LibraryIcon },
  { key: "profile", label: "Profile", Glyph: ProfileIcon },
];

export function TabBar({
  active,
  onChange,
}: {
  active: Tab;
  onChange: (tab: Tab) => void;
}) {
  return (
    <nav className="tabbar" aria-label="Main">
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
