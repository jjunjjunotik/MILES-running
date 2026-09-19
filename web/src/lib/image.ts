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
