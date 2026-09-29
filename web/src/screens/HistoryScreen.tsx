import { useEffect, useMemo, useState } from "react";
import {
  FINGER_KEYS,
  FINGER_LABELS,
  topAttention,
  type FingerKey,
  type NailRecord,
} from "../../../shared/analysis";
import type { ServerScan } from "../lib/server";
import { TrendChart } from "../components/TrendChart";
import { Thumb } from "../components/Thumb";
import { CameraIcon, HistoryIcon, TrashIcon } from "../components/Icons";
import {
  AttentionTag,
  Delta,
  Empty,
  Reading,
  Sheet,
  TopBar,
  formatDate,
  formatRelative,
  partLabel,
} from "../components/ui";

type Filter = "all" | FingerKey;

export function HistoryScreen({
  records,
  failedScans = [],
  onOpenRecord,
  onStartScan,
  onDelete,
  onChanged,
}: {
  records: NailRecord[];
  /** 분석까지 가지 못한 시도. 왜 안 됐는지 남겨 둔다. */
  failedScans?: ServerScan[];
  onOpenRecord: (record: NailRecord) => void;
  onStartScan: () => void;
  onDelete: (id: string) => Promise<void>;
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
        <TopBar title="History" />
        <main className="screen">
          <Empty
            icon={<HistoryIcon size={26} />}
            title="No history yet"
            body="Each scan is saved by date, so you can compare how your nails change over time."
            action={
              <button className="btn btn-primary btn-sm" onClick={onStartScan}>
                <CameraIcon size={18} />
                Make your first scan
              </button>
            }
          />
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar title="History" />
      <main className="screen">
        {fingersInUse.length > 1 && (
          <div className="chips scroll" role="group" aria-label="Filter by finger">
            <button
              className="chip"
              aria-pressed={filter === "all"}
              onClick={() => setFilter("all")}
            >
              All
            </button>
            {fingersInUse.map((key) => (
              <button
                key={key}
                className="chip"
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
              >
                {FINGER_LABELS[key]}
              </button>
            ))}
          </div>
        )}

        {filtered.length >= 2 && (
          <section className="sec" style={{ marginTop: 28 }}>
            <h3 className="sec-title">
              Observation index
              {filter !== "all" && (
                <span className="count">{FINGER_LABELS[filter]}</span>
              )}
            </h3>
            <TrendChart records={filtered} />
          </section>
        )}

        <section className="sec" style={filtered.length >= 2 ? undefined : { marginTop: 20 }}>
          <h3 className="sec-title">
            All scans <span className="count">{filtered.length}</span>
          </h3>
          <ul className="history-list">
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
              const attention = topAttention(record.analysis.findings);

              return (
                <li className="history-item" key={record.id}>
                  <Thumb record={record} />
                  <button
                    className="history-open"
                    onClick={() => onOpenRecord(record)}
                  >
                    <div className="history-title">
                      {record.analysis.headline}
                    </div>
                    <div className="history-meta">
                      {formatRelative(record.createdAt)},{" "}
                      {partLabel(record.hand, FINGER_LABELS[record.finger])}
                    </div>
                    {attention && (
                      <div className="tags">
                        <AttentionTag attention={attention} />
                      </div>
                    )}
                  </button>
                  <div
                    className="history-reading"
                    aria-label={`Observation index ${Math.round(record.analysis.observationScore)}`}
                  >
                    <Reading value={record.analysis.observationScore} small />
                    {delta !== null && <Delta value={delta} />}
                  </div>
                  <button
                    className="icon-btn"
                    aria-label="Delete this scan"
                    onClick={() => setPendingDelete(record.id)}
                  >
                    <TrashIcon size={19} />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {failedScans.length > 0 && (
          <section className="sec">
            <h3 className="sec-title">Scans that didn't finish</h3>
            <ul className="list">
              {failedScans.slice(0, 5).map((scan) => (
                <li className="row" key={scan.id}>
                  <div className="row-main">
                    <div className="row-title">
                      {formatRelative(scan.capturedAt)},{" "}
                      {partLabel(
                        scan.hand,
                        FINGER_LABELS[scan.finger as FingerKey] ?? "",
                      )}
                    </div>
                    <div className="row-sub">
                      {scan.errorMessage ?? "The analysis didn't finish."}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <p className="fineprint">
              We don't make a result when the photo is blurry or no nail is
              visible. A new photo is saved as a new scan.
            </p>
          </section>
        )}

        <p className="fineprint-block">
          The observation index is a reference number for comparing photos. Light
          and angle change it, so compare photos taken in similar conditions.
        </p>
      </main>

      {pendingDelete && (
        <ConfirmDelete
          record={records.find((r) => r.id === pendingDelete)}
          onCancel={() => setPendingDelete(null)}
          onConfirm={async () => {
            await onDelete(pendingDelete);
            setPendingDelete(null);
            await onChanged();
          }}
        />
      )}
    </>
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
    <Sheet label="Delete scan" onClose={() => !busy && onCancel()}>
      <h3>Delete this scan?</h3>
      <p>
        {record ? `The scan from ${formatDate(record.createdAt)}` : "This scan"}{" "}
        and its photo will be permanently deleted from this device. This can't
        be undone.
      </p>
      <div className="btn-row mt-16">
        <button className="btn btn-secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          className="btn btn-danger"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void onConfirm().finally(() => setBusy(false));
          }}
        >
          Delete
        </button>
      </div>
    </Sheet>
  );
}
