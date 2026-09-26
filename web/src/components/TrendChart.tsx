import { useMemo, useState } from "react";
import type { NailRecord } from "../../../shared/analysis";
import { formatDateShort } from "./ui";

const W = 320;
const H = 132;
const PAD_L = 8;
const PAD_R = 34;
const PAD_T = 18;
const PAD_B = 24;

/**
 * 관찰 지표의 날짜별 추이.
 *
 * 단일 계열이므로 범례를 두지 않고 구획 제목이 무엇을 그린 것인지 말한다.
 * 값 라벨은 마지막 지점 하나에만 붙이고, 나머지 값은 눌렀을 때와
 * 기록 목록에서 확인할 수 있게 한다. 색은 모두 CSS 토큰을 따라 다크 모드에서도 읽힌다.
 */
export function TrendChart({ records }: { records: NailRecord[] }) {
  // 기록은 최신순으로 들어오므로 시간 순서로 뒤집는다. 최근 12건만 본다.
  const points = useMemo(
    () =>
      records
        .slice(0, 12)
        .reverse()
        .map((record) => ({
          id: record.id,
          x: record.createdAt,
          y: record.analysis.observationScore,
        })),
    [records],
  );

  const [selected, setSelected] = useState<number | null>(null);

  if (points.length === 0) return null;

  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  // y축은 0~100 전체가 아니라 값 주변으로 잡되, 최소 20포인트 폭을 보장한다.
  const values = points.map((p) => p.y);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const mid = (rawMin + rawMax) / 2;
  const span = Math.max(20, rawMax - rawMin + 12);
  const yMin = Math.max(0, Math.min(rawMin - 6, mid - span / 2));
  const yMax = Math.min(100, Math.max(rawMax + 6, yMin + span));

  const px = (index: number) =>
    PAD_L +
    (points.length === 1 ? innerW / 2 : (innerW * index) / (points.length - 1));
  const py = (value: number) =>
    PAD_T + innerH * (1 - (value - yMin) / Math.max(1, yMax - yMin));

  const line = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${px(i).toFixed(1)} ${py(p.y).toFixed(1)}`)
    .join(" ");

  const area =
    points.length > 1
      ? `${line} L${px(points.length - 1).toFixed(1)} ${PAD_T + innerH} L${px(0).toFixed(1)} ${PAD_T + innerH} Z`
      : "";

  const last = points[points.length - 1]!;
  const active = selected !== null ? points[selected] : null;
  const first = points[0]!;

  return (
    <div>
      <svg
        className="trend"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`관찰 지표 추이. ${points.length}건의 기록, 가장 최근 값 ${Math.round(last.y)}.`}
        onMouseLeave={() => setSelected(null)}
      >
        {[yMax, (yMax + yMin) / 2, yMin].map((value) => (
          <line
            key={value}
            className="grid"
            x1={PAD_L}
            x2={W - PAD_R}
            y1={py(value)}
            y2={py(value)}
            strokeWidth="1"
          />
        ))}

        {area && <path className="area" d={area} />}
        {points.length > 1 && <path className="line" d={line} />}

        {points.map((point, index) => {
          const strong =
            index === points.length - 1 ||
            selected === index ||
            points.length === 1;
          return (
            <g key={point.id}>
              <circle
                className={strong ? "pt-strong" : "pt"}
                cx={px(index)}
                cy={py(point.y)}
                r={strong ? 4.5 : 3}
              />
              {/* 점은 작아도 누를 곳은 넉넉하게 */}
              <circle
                className="hit"
                cx={px(index)}
                cy={py(point.y)}
                r="16"
                onMouseEnter={() => setSelected(index)}
                onClick={() => setSelected(index)}
              />
            </g>
          );
        })}

        <text
          className="val"
          x={px(points.length - 1) + 12}
          y={py(last.y) + 4}
        >
          {Math.round(last.y)}
        </text>

        <text className="axis" x={PAD_L} y={H - 6}>
          {formatDateShort(first.x)}
        </text>
        {points.length > 1 && (
          <text className="axis" x={W - PAD_R} y={H - 6} textAnchor="end">
            {formatDateShort(last.x)}
          </text>
        )}
      </svg>

      <p className="trend-caption" aria-live="polite">
        {active
          ? `${formatDateShort(active.x)} 기록의 관찰 지표는 ${Math.round(active.y)}입니다.`
          : "점을 누르면 그날의 값을 볼 수 있어요."}
      </p>
    </div>
  );
}
