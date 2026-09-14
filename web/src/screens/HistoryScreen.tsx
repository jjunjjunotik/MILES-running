import { useEffect, useMemo, useState } from "react";
import {
  FINGER_KEYS,
  FINGER_LABELS,
  type FingerKey,
  type NailRecord,
} from "../../../shared/analysis";
import { deleteRecord, getImage } from "../lib/storage";
import { TrendChart } from "../components/TrendChart";
import { DeltaBadge } from "./ResultScreen";
import {
  CameraIcon,
  ChevronIcon,
  HistoryIcon,
  TrashIcon,
  TrendIcon,
} from "../components/Icons";
import {
  Empty,
  Notice,
  TopBar,
  formatDate,
  formatRelative,
} from "../components/ui";

type Filter = "all" | FingerKey;

export function HistoryScreen({
  records,
  onOpenRecord,
  onStartScan,
  onChanged,
}: {
  records: NailRecord[];
  onOpenRecord: (record: NailRecord) => void;
  onStartScan: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const filtered = useMemo(
    () =>
      filter === "all"
        ? records
        : records.filter((record) => record.finger === filter),
    [records, filter],
  );

  // 필터에 해당하는 기록이 없어지면 전체로 되돌린다.
  useEffect(() => {
    if (filter !== "all" && filtered.length === 0) setFilter("all");
  }, [filter, filtered.length]);

  const fingersInUse = useMemo(
    () => FINGER_KEYS.filter((key) => records.some((r) => r.finger === key)),
    [records],
  );

  if (records.length === 0) {
    return (
      <>
        <TopBar title="기록" />
        <main className="screen">
          <Empty
            icon={<HistoryIcon size={24} />}
            title="기록이 비어 있어요"
            body="분석할 때마다 날짜별로 쌓여서, 시간이 지나며 어떻게 달라지는지 비교할 수 있어요."
            action={
              <button
                className="btn btn-primary btn-sm"
                onClick={onStartScan}
                style={{ width: "auto" }}
              >
                <CameraIcon size={17} />
                첫 기록 만들기
              </button>
            }
          />
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar title="기록" />
      <main className="screen stagger">
        {fingersInUse.length > 1 && (
          <div className="chip-row" style={{ marginBottom: 4 }}>
            <button
              className={`chip${filter === "all" ? " active" : ""}`}
              onClick={() => setFilter("all")}
            >
              전체
            </button>
            {fingersInUse.map((key) => (
              <button
                key={key}
                className={`chip${filter === key ? " active" : ""}`}
                onClick={() => setFilter(key)}
              >
                {FINGER_LABELS[key]}
              </button>
            ))}
          </div>
        )}

        {filtered.length >= 2 && (
          <div className="card mt-12">
            <div className="flex gap-8" style={{ marginBottom: 6 }}>
              <TrendIcon size={16} />
              <span style={{ fontWeight: 600, fontSize: 14 }}>
                관찰 지표 추이
                {filter !== "all" ? ` · ${FINGER_LABELS[filter]}` : ""}
              </span>
            </div>
            <TrendChart records={filtered} />
          </div>
        )}

        <div className="section-title">
          전체 {filtered.length}건
        </div>
        <div className="card">
          {filtered.map((record, index) => {
            // 같은 부위의 바로 이전 기록과 비교한다.
            const earlier = filtered
              .slice(index + 1)
              .find(
                (other) =>
                  other.finger === record.finger && other.hand === record.hand,
              );
            const delta = earlier
              ? Math.round(
                  record.analysis.observationScore -
                    earlier.analysis.observationScore,
                )
              : null;

            return (
              <div className="history-item" key={record.id}>
                <Thumb record={record} />
                <button
                  className="flex-1"
                  style={{ textAlign: "left" }}
                  onClick={() => onOpenRecord(record)}
                >
                  <div
                    className="truncate"
                    style={{ fontWeight: 600, fontSize: 14.5 }}
                  >
                    {record.analysis.headline}
                  </div>
                  <div className="small muted" style={{ marginTop: 2 }}>
                    {formatRelative(record.createdAt)} ·{" "}
                    {record.hand === "left" ? "왼손" : "오른손"}{" "}
                    {FINGER_LABELS[record.finger]}
                  </div>
                  <div className="flex gap-8" style={{ marginTop: 6 }}>
                    <span className="pill pill-accent">
                      {Math.round(record.analysis.observationScore)}점
                    </span>
                    {delta !== null && <DeltaBadge value={delta} />}
                  </div>
                </button>
                <button
                  className="icon-btn"
                  aria-label="이 기록 삭제"
                  onClick={() => setPendingDelete(record.id)}
                >
                  <TrashIcon size={16} />
                </button>
                <ChevronIcon size={16} />
              </div>
            );
          })}
        </div>

        <div className="mt-16">
          <Notice>
            관찰 지표는 사진끼리 비교하기 위한 참고 수치입니다. 조명과 각도에
            따라 값이 달라질 수 있으니, 비슷한 환경에서 찍은 사진끼리 비교하는
            것이 좋습니다.
          </Notice>
        </div>
      </main>

      {pendingDelete && (
        <ConfirmDelete
          record={records.find((r) => r.id === pendingDelete)}
          onCancel={() => setPendingDelete(null)}
          onConfirm={async () => {
            await deleteRecord(pendingDelete);
            setPendingDelete(null);
            await onChanged();
          }}
        />
      )}
    </>
  );
}

function Thumb({ record }: { record: NailRecord }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!record.hasImage) return;
    let objectUrl: string | null = null;
    let cancelled = false;

    void getImage(record.id).then((blob) => {
      if (cancelled || !blob) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [record.id, record.hasImage]);

  if (url) {
    return <img className="history-thumb" src={url} alt="" />;
  }
  return (
    <div className="history-thumb-empty" aria-hidden="true">
      <HistoryIcon size={18} />
    </div>
  );
}

function ConfirmDelete({
  record,
  onCancel,
  onConfirm,
}: {
  record: NailRecord | undefined;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <>
      <div className="sheet-backdrop" onClick={onCancel} />
      <div className="sheet" role="dialog" aria-modal="true">
        <div className="handle" />
        <h3 style={{ margin: "0 0 6px", fontSize: 17 }}>이 기록을 지울까요?</h3>
        <p className="small muted" style={{ marginTop: 0 }}>
          {record ? `${formatDate(record.createdAt)}의 기록` : "선택한 기록"}과
          함께 저장된 사진이 이 기기에서 완전히 삭제됩니다. 되돌릴 수 없어요.
        </p>
        <div className="btn-row mt-16">
          <button className="btn btn-secondary" onClick={onCancel}>
            취소
          </button>
          <button
            className="btn btn-primary"
            style={{ background: "var(--consult)", boxShadow: "none" }}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void onConfirm().finally(() => setBusy(false));
            }}
          >
            삭제
          </button>
        </div>
      </div>
    </>
  );
}
