import { useEffect, useState } from "react";
import type { NailRecord } from "../../../shared/analysis";
import { getImage } from "../lib/storage";
import { CameraIcon } from "./Icons";

/** 기기에 저장해 둔 사진이 있으면 그 사진을, 없으면 빈 자리만 보인다. */
export function Thumb({ record }: { record: NailRecord }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!record.hasImage) return;
    let objectUrl: string | null = null;
    let cancelled = false;

    void getImage(record.id)
      .then((blob) => {
        if (cancelled || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [record.id, record.hasImage]);

  if (url) return <img className="thumb" src={url} alt="" />;
  return (
    <div className="thumb" aria-hidden="true">
      <CameraIcon size={22} />
    </div>
  );
}
