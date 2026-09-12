import {
  DISCLAIMER_SHORT,
  METRIC_LABELS,
  STATUS_LABELS,
  type NailAnalysis,
  type Status,
} from "../../../shared/analysis";

const W = 1080;
/** 측정용 캔버스 높이. 실제 카드 높이는 그려 본 뒤 내용에 맞춰 정한다. */
const MEASURE_H = 2200;
const BOTTOM_PAD = 64;

const COLORS: Record<Status, string> = {
  good: "#2f9169",
  watch: "#c08a1e",
  consult: "#cf6b4f",
};

const SOFT: Record<Status, string> = {
  good: "#e8f4ee",
  watch: "#fbf2df",
  consult: "#fceee9",
};

const FONT_STACK =
  '"Pretendard", -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif';

/**
 * 공유용 카드 이미지를 캔버스로 직접 그린다.
 *
 * 사진 자체는 카드에 넣지 않는다. 공유 이미지가 손톱 사진을 실어 나르지 않도록
 * 관찰 요약만 담는 것이 기본값이다.
 */
export async function renderShareCard(
  analysis: NailAnalysis,
  meta: { dateLabel: string; partLabel: string; nickname: string },
): Promise<Blob> {
  // 제목 줄 수에 따라 내용 높이가 달라지므로, 한 번 그려 높이를 재고 다시 그린다.
  const probe = document.createElement("canvas");
  probe.width = W;
  probe.height = MEASURE_H;
  const probeCtx = probe.getContext("2d");
  if (!probeCtx) throw new Error("카드를 만들지 못했습니다.");
  const contentBottom = paint(probeCtx, MEASURE_H, analysis, meta);

  const height = Math.round(contentBottom + BOTTOM_PAD);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("카드를 만들지 못했습니다.");
  paint(ctx, height, analysis, meta);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw new Error("카드를 만들지 못했습니다.");
  return blob;
}

/** 카드를 그리고 내용이 끝나는 y 좌표를 돌려준다. */
function paint(
  ctx: CanvasRenderingContext2D,
  H: number,
  analysis: NailAnalysis,
  meta: { dateLabel: string; partLabel: string; nickname: string },
): number {
  // 배경
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#ffffff");
  bg.addColorStop(1, "#eef8f6");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const pad = 72;
  let y = 96;

  // 브랜드
  ctx.fillStyle = "#1f9e8b";
  roundRect(ctx, pad, y - 26, 46, 46, 14);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 24px ${FONT_STACK}`;
  ctx.textBaseline = "middle";
  ctx.fillText("N", pad + 15, y - 2);

  ctx.fillStyle = "#0f5c50";
  ctx.font = `700 26px ${FONT_STACK}`;
  ctx.fillText("NailSense", pad + 62, y - 3);

  ctx.fillStyle = "#77828f";
  ctx.font = `500 23px ${FONT_STACK}`;
  ctx.textAlign = "right";
  ctx.fillText(meta.dateLabel, W - pad, y - 3);
  ctx.textAlign = "left";

  y += 72;

  // 헤드라인
  ctx.fillStyle = "#11181f";
  ctx.font = `700 58px ${FONT_STACK}`;
  ctx.textBaseline = "top";
  y = wrapText(ctx, analysis.headline, pad, y, W - pad * 2, 72);

  y += 14;
  ctx.fillStyle = "#77828f";
  ctx.font = `500 26px ${FONT_STACK}`;
  const subject = meta.nickname ? `${meta.nickname} · ` : "";
  ctx.fillText(`${subject}${meta.partLabel}`, pad, y);

  y += 66;

  // 점수 카드
  const cardH = 188;
  ctx.fillStyle = "rgba(255,255,255,0.82)";
  roundRect(ctx, pad, y, W - pad * 2, cardH, 28);
  ctx.fill();
  ctx.strokeStyle = "#e3eaee";
  ctx.lineWidth = 2;
  roundRect(ctx, pad, y, W - pad * 2, cardH, 28);
  ctx.stroke();

  drawRing(ctx, pad + 104, y + cardH / 2, 66, analysis.observationScore);

  const textX = pad + 200;
  ctx.fillStyle = "#11181f";
  ctx.font = `700 30px ${FONT_STACK}`;
  ctx.fillText("관찰 지표", textX, y + 46);
  ctx.fillStyle = "#77828f";
  ctx.font = `500 23px ${FONT_STACK}`;
  wrapText(
    ctx,
    "사진 속 겉모습이 얼마나 고르게 보이는지를 나타낸 참고 수치입니다. 건강 점수가 아닙니다.",
    textX,
    y + 88,
    W - pad - textX - 34,
    32,
  );

  y += cardH + 44;

  // 항목 그리드 (2열 x 3행)
  const colW = (W - pad * 2 - 20) / 2;
  const rowH = 132;
  analysis.metrics.slice(0, 6).forEach((metric, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = pad + col * (colW + 20);
    const top = y + row * (rowH + 18);

    ctx.fillStyle = "rgba(255,255,255,0.82)";
    roundRect(ctx, x, top, colW, rowH, 22);
    ctx.fill();
    ctx.strokeStyle = "#e3eaee";
    roundRect(ctx, x, top, colW, rowH, 22);
    ctx.stroke();

    ctx.fillStyle = "#11181f";
    ctx.font = `600 27px ${FONT_STACK}`;
    ctx.fillText(METRIC_LABELS[metric.key], x + 26, top + 28);

    // 상태 배지
    const label = STATUS_LABELS[metric.status];
    ctx.font = `600 22px ${FONT_STACK}`;
    const badgeW = ctx.measureText(label).width + 34;
    ctx.fillStyle = SOFT[metric.status];
    roundRect(ctx, x + 26, top + 70, badgeW, 40, 20);
    ctx.fill();
    ctx.fillStyle = COLORS[metric.status];
    ctx.beginPath();
    ctx.arc(x + 26 + 15, top + 90, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText(label, x + 26 + 26, top + 79);
  });

  y += rowH * 3 + 18 * 2 + 48;

  // 고지 문구
  ctx.fillStyle = "#eef2f4";
  roundRect(ctx, pad, y, W - pad * 2, 116, 22);
  ctx.fill();
  ctx.fillStyle = "#5a6673";
  ctx.font = `500 22px ${FONT_STACK}`;
  wrapText(
    ctx,
    `${DISCLAIMER_SHORT} 변화가 이어지면 의료 전문가와 상담하세요.`,
    pad + 28,
    y + 30,
    W - pad * 2 - 56,
    32,
  );

  return y + 116;
}

function drawRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  score: number,
) {
  ctx.lineWidth = 14;
  ctx.strokeStyle = "#e3eaee";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "#1f9e8b";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(
    cx,
    cy,
    r,
    -Math.PI / 2,
    -Math.PI / 2 + (Math.PI * 2 * Math.max(0, Math.min(100, score))) / 100,
  );
  ctx.stroke();
  ctx.lineCap = "butt";

  ctx.fillStyle = "#11181f";
  ctx.font = `700 46px ${FONT_STACK}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(Math.round(score)), cx, cy);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * 한국어는 단어 경계가 공백으로만 나뉘지 않으므로, 공백 단위로 먼저 시도하고
 * 한 덩어리가 줄 폭을 넘으면 글자 단위로 끊는다.
 */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): number {
  const words = text.split(" ");
  let line = "";
  let cursorY = y;

  const flush = () => {
    if (line) {
      ctx.fillText(line, x, cursorY);
      cursorY += lineHeight;
      line = "";
    }
  };

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      line = candidate;
      continue;
    }
    flush();
    if (ctx.measureText(word).width <= maxWidth) {
      line = word;
      continue;
    }
    // 한 어절이 줄보다 길면 글자 단위로 나눈다.
    for (const char of word) {
      const next = line + char;
      if (ctx.measureText(next).width > maxWidth) {
        ctx.fillText(line, x, cursorY);
        cursorY += lineHeight;
        line = char;
      } else {
        line = next;
      }
    }
  }
  flush();
  return cursorY;
}

/** 공유 시트를 지원하면 시트로, 아니면 다운로드로 떨어뜨린다. */
export async function shareOrDownload(
  blob: Blob,
  filename: string,
): Promise<"shared" | "downloaded"> {
  const file = new File([blob], filename, { type: "image/png" });
  const nav = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean;
  };

  if (nav.canShare?.({ files: [file] }) && typeof nav.share === "function") {
    try {
      await nav.share({ files: [file], title: "NailSense 관찰 결과" });
      return "shared";
    } catch (err) {
      // 사용자가 시트를 닫은 경우는 실패가 아니다.
      if (err instanceof DOMException && err.name === "AbortError") {
        return "shared";
      }
    }
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return "downloaded";
}
