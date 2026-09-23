/**
 * 보내기 전에 이 기기에서 먼저 보는 사진 상태.
 *
 * 모델을 부르기 전에 걸러 내면 기다림도 비용도 아낄 수 있다. 다만 판단은
 * 조심스럽게 한다. 애매하면 막지 않고 "다시 찍어 보시겠어요?" 정도로만 안내한다.
 */
export interface ImageQuality {
  /** 0(캄캄) ~ 1(새하얌) 사이의 평균 밝기 */
  brightness: number;
  /** 이웃한 픽셀과의 차이. 초점이 맞을수록 커진다. */
  sharpness: number;
  level: "ok" | "warn";
  issues: string[];
  hint: string | null;
}

export interface PreparedImage {
  /** 서버로 보낼 base64 (data: 접두어 없음) */
  base64: string;
  mediaType: "image/jpeg";
  /** 화면 미리보기용 blob URL. 사용 후 revoke 해야 한다. */
  previewUrl: string;
  /** 사용자가 저장을 허용한 경우에만 IndexedDB 에 들어간다. */
  blob: Blob;
  width: number;
  height: number;
  quality: ImageQuality;
}

const MAX_EDGE = 1280;
const QUALITY = 0.86;

export class ImageError extends Error {}

/**
 * 업로드된 사진을 캔버스에 다시 그려 JPEG 로 인코딩한다.
 *
 * 이 재인코딩에는 두 가지 목적이 있다.
 * 1) 용량을 줄여 전송을 가볍게 한다.
 * 2) 원본에 들어 있던 EXIF 메타데이터(촬영 위치, 기기 정보, 시각)를 전부 떨어뜨린다.
 *    캔버스는 픽셀만 복사하므로 메타데이터가 결과물에 남지 않는다.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!file.type.startsWith("image/")) {
    throw new ImageError("이미지 파일만 올릴 수 있습니다.");
  }
  if (file.size > 25 * 1024 * 1024) {
    throw new ImageError("사진이 너무 큽니다. 25MB 이하로 시도해 주세요.");
  }

  const bitmap = await loadBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImageError("이미지를 처리하지 못했습니다.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  if ("close" in bitmap) bitmap.close();

  const quality = measureQuality(ctx, width, height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", QUALITY),
  );
  if (!blob) throw new ImageError("이미지를 변환하지 못했습니다.");

  return {
    base64: await blobToBase64(blob),
    mediaType: "image/jpeg",
    previewUrl: URL.createObjectURL(blob),
    blob,
    width,
    height,
    quality,
  };
}

/**
 * 가운데 영역의 밝기와 선명도를 잰다.
 *
 * 선명도는 가로로 이웃한 픽셀의 밝기 차이를 평균한 값이다. 초점이 나가면 이웃 픽셀이
 * 서로 비슷해져 이 값이 작아진다. 정확한 측정이 아니라 "눈에 띄게 흐린가"를 가리는
 * 용도이므로, 기준을 낮게 잡아 어지간하면 통과시킨다.
 */
function measureQuality(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): ImageQuality {
  const box = {
    x: Math.round(width * 0.2),
    y: Math.round(height * 0.2),
    w: Math.max(1, Math.round(width * 0.6)),
    h: Math.max(1, Math.round(height * 0.6)),
  };

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(box.x, box.y, box.w, box.h).data;
  } catch {
    // 캔버스를 읽을 수 없는 환경이면 판단하지 않는다.
    return { brightness: 0.5, sharpness: 1, level: "ok", issues: [], hint: null };
  }

  const gray = new Float32Array(box.w * box.h);
  let sum = 0;
  for (let i = 0; i < gray.length; i += 1) {
    const offset = i * 4;
    // 사람 눈이 느끼는 밝기에 가깝게 가중 평균한다.
    const value =
      (0.299 * data[offset]! + 0.587 * data[offset + 1]! + 0.114 * data[offset + 2]!) /
      255;
    gray[i] = value;
    sum += value;
  }
  const brightness = sum / gray.length;

  let diff = 0;
  let count = 0;
  for (let y = 0; y < box.h; y += 2) {
    for (let x = 1; x < box.w; x += 2) {
      diff += Math.abs(gray[y * box.w + x]! - gray[y * box.w + x - 1]!);
      count += 1;
    }
  }
  const sharpness = count > 0 ? (diff / count) * 100 : 0;

  const issues: string[] = [];
  if (brightness < 0.18) issues.push("사진이 어두워요");
  if (brightness > 0.93) issues.push("빛이 너무 강해 하얗게 날아갔어요");
  if (sharpness < 1.1) issues.push("초점이 흐려 보여요");

  return {
    brightness,
    sharpness,
    level: issues.length > 0 ? "warn" : "ok",
    issues,
    hint:
      issues.length > 0
        ? "밝은 창가에서 손톱이 화면의 절반 이상을 채우도록 다시 찍으면 더 잘 볼 수 있어요."
        : null,
  };
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      // from-image: 세로로 찍은 사진이 눕지 않도록 EXIF 회전을 픽셀에 반영한다.
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // 일부 브라우저는 옵션을 지원하지 않는다. 아래 경로로 넘어간다.
    }
  }
  return await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ImageError("이미지를 읽지 못했습니다."));
    };
    img.src = url;
  });
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new ImageError("이미지를 읽지 못했습니다."));
    reader.readAsDataURL(blob);
  });
}
