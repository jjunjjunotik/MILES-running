import type { NailRecord } from "../../../shared/analysis";
import { buildDemoAnalysis } from "../../../shared/demo";
import { listRecords, saveRecord } from "./storage";

const DAY = 24 * 60 * 60 * 1000;

/**
 * 서버 없이 도는 데모 빌드에서만 쓰인다.
 *
 * 링크를 처음 연 사람이 빈 화면 대신 동작하는 앱을 보도록 예시 기록을 심는다.
 * 기록이 하나라도 있으면 건드리지 않는다. 모두 샘플이며 사진은 없다.
 */
export async function seedExampleRecords(): Promise<boolean> {
  const existing = await listRecords();
  if (existing.length > 0) return false;

  const samples: { daysAgo: number; score: number; note: string }[] = [
    { daysAgo: 24, score: 71, note: "설거지 자주 한 주" },
    { daysAgo: 15, score: 76, note: "핸드크림 챙겨 바르기 시작" },
    { daysAgo: 6, score: 82, note: "" },
  ];

  for (const [index, sample] of samples.entries()) {
    const analysis = buildDemoAnalysis(index * 3);
    const record: NailRecord = {
      id: `example-${index}`,
      createdAt: Date.now() - sample.daysAgo * DAY,
      hand: "right",
      finger: "index",
      note: sample.note,
      analysis: { ...analysis, observationScore: sample.score },
      hasImage: false,
    };
    await saveRecord(record, null);
  }
  return true;
}
