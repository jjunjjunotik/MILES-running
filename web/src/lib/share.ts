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
const MEASURE_H = 2400;
const BOTTOM_PAD = 80;
const PAD = 80;

/**
 * 공유 이미지는 어디서 열릴지 모르므로 항상 밝은 바탕으로 그린다.
 * 값은 styles.css 의 라이트 토큰과 같다.
 */
const INK = {
  paper: "#f4f5f7",
  ink: "#16181d",
  ink2: "#40444c",
  ink3: "#5f646d",
  line: "#dfe2e8",
};

const TONE: Record<Attention, string> = {
  routine: "#23704c",
  monitor: "#835800",
  consult: "#a9430f",
  soon: "#b0271d",
};

const STATUS_TONE: Record<Status, Attention> = {
  good: "routine",
  watch: "monitor",
  consult: "consult",
};

const SANS =
  '"IBM Plex Sans KR", -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif';
const MONO = '"IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace';

const INDEX_NOTE =
  "사진 속 겉모습이 얼마나 고르게 보이는지 나타낸 참고 수치예요. 건강 점수가 아니에요.";
const FINDINGS_NOTE = "무엇이 보였는지와 지켜볼 변화는 앱에서 확인할 수 있어요.";

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
  await loadCardFonts(analysis, meta);

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

/**
 * 캔버스는 글꼴이 이미 내려와 있어야 그 글꼴로 그린다. 한글 글꼴은 글자 범위별로
 * 나뉘어 있으므로 카드에 들어갈 글자를 넘겨 필요한 조각만 먼저 받는다.
 * 네트워크가 느려도 카드 만들기가 멈추지 않도록 오래 기다리지는 않는다.
 */
async function loadCardFonts(
  analysis: NailAnalysis,
  meta: { dateLabel: string; partLabel: string; nickname: string },
): Promise<void> {
  if (typeof document === "undefined" || !("fonts" in document)) return;
  const text = [
    "NailSense 관찰 지표 짚어 본 특징 건 님의 0123456789/",
    analysis.headline,
    meta.dateLabel,
    meta.partLabel,
    meta.nickname,
    INDEX_NOTE,
    FINDINGS_NOTE,
    DISCLAIMER_SHORT,
    "변화가 이어지면 의료 전문가와 상담하세요.",
    ...analysis.metrics.map(
      (metric) => METRIC_LABELS[metric.key] + STATUS_LABELS[metric.status],
    ),
    ...(analysis.findings ?? []).map(
      (finding) => finding.label + ATTENTION_LABELS[finding.attention],
    ),
  ].join(" ");
  const faces = [`400 24px ${SANS}`, `600 24px ${SANS}`, `500 24px ${MONO}`];
  try {
    await Promise.race([
      Promise.all(faces.map((face) => document.fonts.load(face, text))),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
  } catch {
    // 글꼴을 못 받으면 시스템 글꼴로 그린다.
  }
}

/** 카드를 그리고 내용이 끝나는 y 좌표를 돌려준다. */
function paint(
  ctx: CanvasRenderingContext2D,
  H: number,
  analysis: NailAnalysis,
  meta: { dateLabel: string; partLabel: string; nickname: string },
): number {
  const inner = W - PAD * 2;

  ctx.fillStyle = INK.paper;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  let y = PAD;

  // 앱 이름과 날짜
  ctx.fillStyle = INK.ink;
  ctx.font = `600 32px ${SANS}`;
  ctx.fillText("NailSense", PAD, y);
  ctx.fillStyle = INK.ink3;
  ctx.font = `400 25px ${SANS}`;
  ctx.textAlign = "right";
  ctx.fillText(meta.dateLabel, W - PAD, y + 5);
  ctx.textAlign = "left";

  y += 96;

  // 한 줄 요약
  ctx.fillStyle = INK.ink;
  ctx.font = `600 54px ${SANS}`;
  y = wrapText(ctx, analysis.headline, PAD, y, inner, 74);

  y += 10;
  ctx.fillStyle = INK.ink3;
  ctx.font = `400 26px ${SANS}`;
  const subject = meta.nickname
    ? `${meta.nickname}님의 ${meta.partLabel}`
    : meta.partLabel;
  ctx.fillText(subject, PAD, y);

  y += 72;
  y = rule(ctx, y);

  // 항목 6개 (2열 3행)
  const colW = inner / 2;
  const rowH = 100;
  analysis.metrics.slice(0, 6).forEach((metric, index) => {
    const x = PAD + (index % 2) * colW;
    const top = y + Math.floor(index / 2) * rowH;
    ctx.fillStyle = INK.ink3;
    ctx.font = `400 24px ${SANS}`;
    ctx.fillText(METRIC_LABELS[metric.key], x, top);
    ctx.fillStyle = TONE[STATUS_TONE[metric.status]];
    ctx.font = `600 29px ${SANS}`;
    ctx.fillText(STATUS_LABELS[metric.status], x, top + 38);
  });
  y += rowH * 3 + 8;
  y = rule(ctx, y);

  // 관찰 지표. 링이나 막대 없이 숫자로만 적는다.
  ctx.fillStyle = INK.ink;
  ctx.font = `600 27px ${SANS}`;
  ctx.fillText("관찰 지표", PAD, y + 12);
  const value = String(Math.round(analysis.observationScore));
  ctx.font = `500 25px ${MONO}`;
  const ofW = ctx.measureText("/100").width;
  ctx.fillStyle = INK.ink3;
  ctx.textAlign = "right";
  ctx.fillText("/100", W - PAD, y + 16);
  ctx.fillStyle = INK.ink;
  ctx.font = `500 46px ${MONO}`;
  ctx.fillText(value, W - PAD - ofW - 6, y);
  ctx.textAlign = "left";

  y += 66;
  ctx.fillStyle = INK.ink3;
  ctx.font = `400 23px ${SANS}`;
  y = wrapText(ctx, INDEX_NOTE, PAD, y, inner, 34);
  y += 34;

  // 짚어 본 특징. 카드에는 이름과 단계만 담고 자세한 설명은 앱에서 보게 한다.
  const findings = (analysis.findings ?? []).slice(0, 3);
  if (findings.length > 0) {
    y = rule(ctx, y);
    ctx.fillStyle = INK.ink;
    ctx.font = `600 27px ${SANS}`;
    ctx.fillText(`짚어 본 특징 ${findings.length}건`, PAD, y);
    y += 58;

    for (const finding of findings) {
      const stage = ATTENTION_LABELS[finding.attention];
      ctx.font = `600 24px ${SANS}`;
      const stageW = ctx.measureText(stage).width;
      ctx.fillStyle = TONE[finding.attention];
      ctx.textAlign = "right";
      ctx.fillText(stage, W - PAD, y + 3);
      ctx.textAlign = "left";

      ctx.fillStyle = INK.ink;
      ctx.font = `400 27px ${SANS}`;
      ctx.fillText(
        ellipsize(ctx, finding.label, inner - stageW - 32),
        PAD,
        y,
      );
      y += 52;
    }

    y += 4;
    ctx.fillStyle = INK.ink3;
    ctx.font = `400 23px ${SANS}`;
    y = wrapText(ctx, FINDINGS_NOTE, PAD, y, inner, 34);
    y += 34;
  }

  // 고지 문구
  y = rule(ctx, y);
  ctx.fillStyle = INK.ink2;
  ctx.font = `400 23px ${SANS}`;
  y = wrapText(
    ctx,
    `${DISCLAIMER_SHORT} 변화가 이어지면 의료 전문가와 상담하세요.`,
    PAD,
    y,
    inner,
    34,
  );

  return y;
}

/** 구획 사이 가는 선. 선 아래에서 다음 내용이 시작할 y 를 돌려준다. */
function rule(ctx: CanvasRenderingContext2D, y: number): number {
  ctx.fillStyle = INK.line;
  ctx.fillRect(PAD, y, W - PAD * 2, 2);
  return y + 40;
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
