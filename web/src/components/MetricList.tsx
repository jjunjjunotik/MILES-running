import { useState } from "react";
import {
  CONFIDENCE_LABELS,
  METRIC_DESCRIPTIONS,
  METRIC_LABELS,
  type Metric,
} from "../../../shared/analysis";
import { ChevronIcon } from "./Icons";
import { StatusPill } from "./ui";

export function MetricList({
  metrics,
  expandByDefault,
}: {
  metrics: Metric[];
  expandByDefault: boolean;
}) {
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(expandByDefault ? metrics.map((m) => m.key) : []),
  );

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="card">
      {metrics.map((metric) => {
        const isOpen = open.has(metric.key);
        return (
          <div
            key={metric.key}
            className={`metric${isOpen ? " open" : ""}`}
          >
            <button
              className="metric-head"
              onClick={() => toggle(metric.key)}
              aria-expanded={isOpen}
            >
              <div className="flex-1">
                <div className="flex gap-8">
                  <span className="name">{METRIC_LABELS[metric.key]}</span>
                  <StatusPill status={metric.status} />
                </div>
                {!isOpen && (
                  <div className="obs mt-8">{metric.observation}</div>
                )}
              </div>
              <ChevronIcon />
            </button>

            <div className="metric-body">
              <div>
                <div className="inner">
                  <div className="block">
                    <div className="k">사진에서 보이는 것</div>
                    <div className="v">{metric.observation}</div>
                  </div>
                  <div className="block">
                    <div className="k">AI 설명 · 일반 정보</div>
                    <div className="v">{metric.explanation}</div>
                  </div>
                  <div className="flex gap-8 small muted">
                    <span className="pill pill-neutral">
                      {CONFIDENCE_LABELS[metric.confidence]}
                    </span>
                  </div>
                  <div className="small muted">
                    살펴본 범위: {METRIC_DESCRIPTIONS[metric.key]}
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
