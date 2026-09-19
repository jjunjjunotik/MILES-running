import { useEffect, useRef, useState, type ReactNode } from "react";
import { STATUS_LABELS, type Status } from "../../../shared/analysis";
import { InfoIcon } from "./Icons";

export function TopBar({
  title,
  right,
  left,
}: {
  title: string;
  right?: ReactNode;
  left?: ReactNode;
}) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={`topbar${scrolled ? " scrolled" : ""}`}>
      {left}
      <h1>{title}</h1>
      <div className="spacer" />
      {right}
    </header>
  );
}

export function Notice({
  children,
  tone = "plain",
  icon,
}: {
  children: ReactNode;
  tone?: "plain" | "strong";
  icon?: ReactNode;
}) {
  return (
    <div className={`notice${tone === "strong" ? " notice-strong" : ""}`}>
      {icon ?? <InfoIcon />}
      <div>{children}</div>
    </div>
  );
}

export function StatusPill({ status }: { status: Status }) {
  return (
    <span className={`pill pill-${status}`}>
      <span className="dot" />
      {STATUS_LABELS[status]}
    </span>
  );
}

export function ScoreRing({
  score,
  animate = true,
}: {
  score: number;
  animate?: boolean;
}) {
  const radius = 58;
  const circumference = 2 * Math.PI * radius;
  const [shown, setShown] = useState(animate ? 0 : score);
  const raf = useRef(0);

  useEffect(() => {
    if (!animate) {
      setShown(score);
      return;
    }
    // 다음 프레임에 값을 올려 CSS transition 이 걸리게 한다.
    raf.current = requestAnimationFrame(() => setShown(score));
    return () => cancelAnimationFrame(raf.current);
  }, [score, animate]);

  const offset = circumference * (1 - Math.max(0, Math.min(100, shown)) / 100);

  return (
    <div className="ring-wrap">
      <svg width="132" height="132" viewBox="0 0 132 132">
        <circle
          className="ring-track"
          cx="66"
          cy="66"
          r={radius}
          fill="none"
          strokeWidth="10"
        />
        <circle
          className="ring-value"
          cx="66"
          cy="66"
          r={radius}
          fill="none"
          strokeWidth="10"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="ring-label">
        <span className="num">{Math.round(score)}</span>
        <span className="cap">관찰 지표</span>
      </div>
    </div>
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
      <div className="ico">{icon}</div>
      <div style={{ color: "var(--ink)", fontWeight: 600, marginBottom: 4 }}>
        {title}
      </div>
      <div className="small" style={{ maxWidth: 260, margin: "0 auto" }}>
        {body}
      </div>
      {action ? <div className="mt-16">{action}</div> : null}
    </div>
  );
}

export function Sheet({
  onClose,
  children,
}: {
  onClose: () => void;
  children: ReactNode;
}) {
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

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true">
        <div className="handle" />
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

export function formatDateShort(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("ko-KR", {
    month: "numeric",
    day: "numeric",
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
