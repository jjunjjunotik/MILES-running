import {
  ATTENTION_LABELS,
  DISCLAIMER_SHORT,
  METRIC_LABELS,
  STATUS_LABELS,
  type Attention,
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

/** styles.css 의 att-* 와 같은 색을 쓴다. */
const ATTENTION_COLORS: Record<Attention, string> = {
  routine: "#2f9169",
  monitor: "#c08a1e",
  consult: "#cf6b4f",
  soon: "#b04e33",
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

  y += rowH * 3 + 18 * 2 + 44;

  // 짚어 본 특징. 카드에는 이름과 단계만 담고 자세한 설명은 앱에서 보게 한다.
  const findings = (analysis.findings ?? []).slice(0, 3);
  if (findings.length > 0) {
    const boxPad = 30;
    const rowGap = 50;
    const boxH = 62 + findings.length * rowGap + 40;

    ctx.fillStyle = "rgba(255,255,255,0.82)";
    roundRect(ctx, pad, y, W - pad * 2, boxH, 24);
    ctx.fill();
    ctx.strokeStyle = "#e3eaee";
    ctx.lineWidth = 2;
    roundRect(ctx, pad, y, W - pad * 2, boxH, 24);
    ctx.stroke();

    ctx.fillStyle = "#77828f";
    ctx.font = `700 22px ${FONT_STACK}`;
    ctx.fillText(`짚어 본 특징 ${findings.length}건`, pad + boxPad, y + 26);

    findings.forEach((finding, index) => {
      const top = y + 66 + index * rowGap;
      const color = ATTENTION_COLORS[finding.attention];
      const stage = ATTENTION_LABELS[finding.attention];

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(pad + boxPad + 6, top + 14, 6, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = `600 23px ${FONT_STACK}`;
      const stageW = ctx.measureText(stage).width;
      const labelX = pad + boxPad + 24;
      const labelMax = W - pad - boxPad - stageW - 24 - labelX;

      ctx.fillStyle = "#11181f";
      ctx.font = `600 25px ${FONT_STACK}`;
      ctx.fillText(ellipsize(ctx, finding.label, labelMax), labelX, top);

      ctx.fillStyle = color;
      ctx.font = `600 23px ${FONT_STACK}`;
      ctx.textAlign = "right";
      ctx.fillText(stage, W - pad - boxPad, top + 2);
      ctx.textAlign = "left";
    });

    ctx.fillStyle = "#77828f";
    ctx.font = `500 21px ${FONT_STACK}`;
    ctx.fillText(
      "무엇이 보였는지와 지켜볼 변화는 앱에서 확인할 수 있어요.",
      pad + boxPad,
      y + 66 + findings.length * rowGap + 4,
    );

    y += boxH + 32;
  }

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

/** 한 줄에 들어가지 않는 이름은 끝을 줄임표로 자른다. */
function ellipsize(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (maxWidth <= 0) return "";
  if (ctx.measureText(text).width <= maxWidth) return text;

  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut}…`;
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

export type ShareOutcome = "shared" | "downloaded" | "declined";

/**
 * 이 페이지가 임베드된 뷰어가 파일 저장을 중개해 주는 경우에만 존재한다.
 * 일반 브라우저에서는 undefined 이며, 아래 앵커 방식으로 내려간다.
 */
interface HostDownloads {
  save(request: { filename: string; data: Blob }): Promise<unknown>;
}

interface HostRuntime {
  use(name: "downloads"): Promise<HostDownloads | null>;
}

declare global {
  interface Window {
    claude?: HostRuntime;
  }
}

/**
 * 공유 시트 → 뷰어가 중개하는 저장 → 일반 다운로드 순으로 시도한다.
 * 사용자가 취소한 경우는 실패가 아니라 "declined" 로 구분해 돌려준다.
 */
export async function shareOrDownload(
  blob: Blob,
  filename: string,
): Promise<ShareOutcome> {
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
        return "declined";
      }
    }
  }

  // 샌드박스된 뷰어 안에서는 앵커 다운로드가 조용히 무시된다.
  // 뷰어가 저장을 중개해 주면 그 경로를 쓴다.
  try {
    const downloads = await window.claude?.use("downloads");
    if (downloads) {
      await downloads.save({ filename, data: blob });
      return "downloaded";
    }
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === "declined" || code === "rate_limited") return "declined";
    // 그 밖의 경우에는 아래 기본 경로로 한 번 더 시도한다.
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return "downloaded";
}
