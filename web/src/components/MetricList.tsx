import { useState } from "react";
import {
  CONFIDENCE_LABELS,
  METRIC_DESCRIPTIONS,
  METRIC_LABELS,
  type Metric,
} from "../../../shared/analysis";
import { ChevronIcon } from "./Icons";
import { StatusTag } from "./ui";

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
    <div>
      {metrics.map((metric) => {
        const isOpen = open.has(metric.key);
        const bodyId = `metric-${metric.key}`;
        return (
          <div key={metric.key} className={`metric${isOpen ? " open" : ""}`}>
            <button
              className="metric-head"
              onClick={() => toggle(metric.key)}
              aria-expanded={isOpen}
              aria-controls={bodyId}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="metric-top">
                  <span className="metric-name">
                    {METRIC_LABELS[metric.key]}
                  </span>
                  <StatusTag status={metric.status} />
                </div>
                {!isOpen && <div className="metric-obs">{metric.observation}</div>}
              </div>
              <ChevronIcon size={18} className="chev" />
            </button>

            <div className="metric-body" id={bodyId} inert={!isOpen}>
              <div>
                <div className="metric-inner">
                  <div>
                    <h5>사진에서 보이는 것</h5>
                    <p>{metric.observation}</p>
                  </div>
                  <div>
                    <h5>일반적인 정보</h5>
                    <p>{metric.explanation}</p>
                  </div>
                  <div className="scope">
                    <div>확인 정도: {CONFIDENCE_LABELS[metric.confidence]}</div>
                    <div>살펴본 범위: {METRIC_DESCRIPTIONS[metric.key]}</div>
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
