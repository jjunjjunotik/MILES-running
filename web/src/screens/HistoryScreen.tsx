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
        <TopBar title="기록" />
        <main className="screen">
          <Empty
            icon={<HistoryIcon size={26} />}
            title="기록이 비어 있어요"
            body="분석할 때마다 날짜별로 쌓여서, 시간이 지나며 어떻게 달라지는지 비교할 수 있어요."
            action={
              <button className="btn btn-primary btn-sm" onClick={onStartScan}>
                <CameraIcon size={18} />
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
      <main className="screen">
        {fingersInUse.length > 1 && (
          <div className="chips scroll" role="group" aria-label="손가락별로 보기">
            <button
              className="chip"
              aria-pressed={filter === "all"}
              onClick={() => setFilter("all")}
            >
              전체
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
              관찰 지표 추이
              {filter !== "all" && (
                <span className="count">{FINGER_LABELS[filter]}</span>
              )}
            </h3>
            <TrendChart records={filtered} />
          </section>
        )}

        <section className="sec" style={filtered.length >= 2 ? undefined : { marginTop: 20 }}>
          <h3 className="sec-title">
            전체 기록 <span className="count">{filtered.length}건</span>
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
                    aria-label={`관찰 지표 ${Math.round(record.analysis.observationScore)}`}
                  >
                    <Reading value={record.analysis.observationScore} small />
                    {delta !== null && <Delta value={delta} />}
                  </div>
                  <button
                    className="icon-btn"
                    aria-label="이 기록 삭제"
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
            <h3 className="sec-title">분석되지 않은 시도</h3>
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
                      {scan.errorMessage ?? "분석이 끝나지 않았어요."}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <p className="fineprint">
              사진이 흐리거나 손톱이 보이지 않으면 결과를 만들지 않아요. 다시
              찍으면 새 기록으로 쌓여요.
            </p>
          </section>
        )}

        <p className="fineprint-block">
          관찰 지표는 사진끼리 비교하기 위한 참고 수치예요. 조명과 각도에 따라
          값이 달라질 수 있으니, 비슷한 환경에서 찍은 사진끼리 비교해 주세요.
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
    <Sheet label="기록 삭제" onClose={() => !busy && onCancel()}>
      <h3>이 기록을 지울까요?</h3>
      <p>
        {record ? `${formatDate(record.createdAt)} 기록` : "선택한 기록"}과
        함께 저장된 사진이 이 기기에서 완전히 지워져요. 되돌릴 수 없어요.
      </p>
      <div className="btn-row mt-16">
        <button className="btn btn-secondary" onClick={onCancel} disabled={busy}>
          취소
        </button>
        <button
          className="btn btn-danger"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void onConfirm().finally(() => setBusy(false));
          }}
        >
          삭제
        </button>
      </div>
    </Sheet>
  );
}
