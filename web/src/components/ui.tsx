import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ATTENTION_DESCRIPTIONS,
  ATTENTION_LABELS,
  STATUS_LABELS,
  type Attention,
  type Status,
} from "../../../shared/analysis";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  EyeIcon,
  InfoIcon,
  MinusIcon,
  StethoscopeIcon,
  WarningCircleIcon,
  type Icon,
} from "./Icons";

export function TopBar({
  title,
  right,
  left,
  brand = false,
}: {
  title: string;
  right?: ReactNode;
  left?: ReactNode;
  /** 홈처럼 제목 자리에 앱 이름을 둘 때 */
  brand?: boolean;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);

  // 스크롤 이벤트를 매 프레임 듣지 않고, 맨 위 표식이 화면을 벗어났는지만 본다.
  useEffect(() => {
    const target = sentinel.current;
    if (!target || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) =>
      setScrolled(entry ? !entry.isIntersecting : false),
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div ref={sentinel} className="topbar-sentinel" aria-hidden="true" />
      <header className={`topbar${scrolled ? " scrolled" : ""}`}>
        {left}
        <h1 className={brand ? "wordmark" : undefined}>{title}</h1>
        <div className="spacer" />
        {right}
      </header>
    </>
  );
}

export type Tone = "routine" | "monitor" | "consult" | "soon";

/** 관찰 항목의 상태를 특이 사항 단계와 같은 색·모양 체계로 옮긴다. */
export const STATUS_TONE: Record<Status, Tone> = {
  good: "routine",
  watch: "monitor",
  consult: "consult",
};

/**
 * 단계마다 모양이 다른 아이콘을 붙인다. 색을 구분하기 어려운 사람도
 * 체크(일상), 눈(지켜보기), 청진기(전문가), 느낌표(빠른 진료)로 알아볼 수 있다.
 */
const TONE_ICONS: Record<Tone, Icon> = {
  routine: CheckIcon,
  monitor: EyeIcon,
  consult: StethoscopeIcon,
  soon: WarningCircleIcon,
};

export function ToneIcon({ tone, size = 15 }: { tone: Tone; size?: number }) {
  const Glyph = TONE_ICONS[tone];
  return <Glyph size={size} weight={tone === "soon" ? "fill" : "bold"} />;
}

export function StatusTag({ status }: { status: Status }) {
  const tone = STATUS_TONE[status];
  return (
    <span className={`tag tone-${tone}`}>
      <ToneIcon tone={tone} size={13} />
      {STATUS_LABELS[status]}
    </span>
  );
}

export function AttentionTag({ attention }: { attention: Attention }) {
  return (
    <span
      className={`tag tone-${attention}`}
      title={ATTENTION_DESCRIPTIONS[attention]}
    >
      <ToneIcon tone={attention} size={13} />
      {ATTENTION_LABELS[attention]}
    </span>
  );
}

export function Notice({
  children,
  tone,
  icon,
}: {
  children: ReactNode;
  tone?: Tone | "accent";
  icon?: ReactNode;
}) {
  return (
    <div className={`notice${tone ? ` tone-${tone}` : ""}`}>
      {icon ?? <InfoIcon size={17} />}
      <div>{children}</div>
    </div>
  );
}

/** 관찰 지표 값. 건강 점수처럼 보이지 않도록 링이나 막대 없이 숫자로만 적는다. */
export function Reading({
  value,
  small = false,
}: {
  value: number;
  small?: boolean;
}) {
  return (
    <span className={`reading${small ? " small" : ""}`}>
      <span className="v">{Math.round(value)}</span>
      <span className="of">/100</span>
    </span>
  );
}

/**
 * 같은 부위의 지난 기록과 비교한 변화량.
 * 높고 낮음을 좋고 나쁨으로 칠하지 않는다. 조명과 각도로도 달라지는 값이다.
 */
export function Delta({ value }: { value: number }) {
  if (value === 0) {
    return (
      <span className="delta">
        <MinusIcon size={12} weight="bold" />
        변화 없음
      </span>
    );
  }
  return (
    <span className="delta">
      {value > 0 ? (
        <ArrowUpIcon size={12} weight="bold" />
      ) : (
        <ArrowDownIcon size={12} weight="bold" />
      )}
      <span className="sr-only">{value > 0 ? "올라감" : "내려감"}</span>
      {Math.abs(value)}
    </span>
  );
}

export function Empty({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon}
      <div className="t">{title}</div>
      <div className="b">{body}</div>
      {action ? <div className="a">{action}</div> : null}
    </div>
  );
}

export function Sheet({
  onClose,
  label,
  children,
}: {
  onClose: () => void;
  /** 화면 낭독기가 읽을 시트 이름 */
  label: string;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  // 열리면 초점을 시트로 옮겨 키보드로도 바로 조작할 수 있게 한다.
  useEffect(() => {
    panel.current?.focus();
  }, []);

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div
        ref={panel}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
      >
        <div className="sheet-handle" />
        {children}
      </div>
    </>
  );
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** 그래프 눈금처럼 좁은 자리에 쓰는 날짜. "9/26" */
export function formatDateShort(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function formatToday(timestamp: number = Date.now()): string {
  return new Date(timestamp).toLocaleDateString("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "long",
  });
}

export function formatRelative(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const day = 24 * 60 * 60 * 1000;
  if (diff < day) return "오늘";
  if (diff < day * 2) return "어제";
  if (diff < day * 7) return `${Math.floor(diff / day)}일 전`;
  return formatDate(timestamp);
}

/** "왼손 약지" 처럼 부위를 한 번에 적는다. */
export function partLabel(hand: "left" | "right", finger: string): string {
  return `${hand === "left" ? "왼손" : "오른손"} ${finger}`;
}
