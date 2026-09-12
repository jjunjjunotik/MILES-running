import { useCallback, useEffect, useRef, useState } from "react";
import type {
  FingerKey,
  NailAnalysis,
  NailRecord,
} from "../../shared/analysis";
import { TabBar } from "./components/TabBar";
import { HomeScreen } from "./screens/HomeScreen";
import { ScanScreen } from "./screens/ScanScreen";
import { ResultScreen } from "./screens/ResultScreen";
import { HistoryScreen } from "./screens/HistoryScreen";
import { ProfileScreen } from "./screens/ProfileScreen";
import {
  DEFAULT_SETTINGS,
  getImage,
  listRecords,
  loadSettings,
  saveSettings,
  type Settings,
} from "./lib/storage";
import { health } from "./lib/api";

export type Tab = "home" | "scan" | "result" | "history" | "profile";

export interface ResultView {
  recordId: string;
  analysis: NailAnalysis;
  createdAt: number;
  hand: "left" | "right";
  finger: FingerKey;
  note: string;
  /** 이 화면에서만 쓰는 blob URL. 화면을 떠날 때 해제한다. */
  imageUrl: string | null;
  demo: boolean;
}

export function App() {
  const [tab, setTab] = useState<Tab>("home");
  const [records, setRecords] = useState<NailRecord[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [result, setResult] = useState<ResultView | null>(null);
  const [demoMode, setDemoMode] = useState(false);

  // 이전 결과의 blob URL 을 확실히 해제하기 위해 ref 로 들고 있는다.
  const currentUrl = useRef<string | null>(null);

  const refreshRecords = useCallback(async () => {
    try {
      setRecords(await listRecords());
    } catch {
      setRecords([]);
    }
  }, []);

  useEffect(() => {
    setSettings(loadSettings());
    void refreshRecords();
    void health().then((info) => {
      if (info) setDemoMode(!info.configured && info.demoAvailable);
    });
  }, [refreshRecords]);

  useEffect(() => {
    // 탭이 바뀌면 화면 위로 올린다.
    window.scrollTo({ top: 0 });
  }, [tab]);

  const updateSettings = useCallback((next: Settings) => {
    setSettings(next);
    saveSettings(next);
  }, []);

  const showResult = useCallback((view: ResultView) => {
    if (currentUrl.current && currentUrl.current !== view.imageUrl) {
      URL.revokeObjectURL(currentUrl.current);
    }
    currentUrl.current = view.imageUrl;
    setResult(view);
    setTab("result");
  }, []);

  const openRecord = useCallback(
    async (record: NailRecord) => {
      let imageUrl: string | null = null;
      if (record.hasImage) {
        try {
          const blob = await getImage(record.id);
          if (blob) imageUrl = URL.createObjectURL(blob);
        } catch {
          imageUrl = null;
        }
      }
      showResult({
        recordId: record.id,
        analysis: record.analysis,
        createdAt: record.createdAt,
        hand: record.hand,
        finger: record.finger,
        note: record.note,
        imageUrl,
        demo: false,
      });
    },
    [showResult],
  );

  useEffect(
    () => () => {
      if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
    },
    [],
  );

  return (
    <div className="app">
      {tab === "home" && (
        <HomeScreen
          records={records}
          settings={settings}
          demoMode={demoMode}
          onStartScan={() => setTab("scan")}
          onOpenRecord={openRecord}
          onGoHistory={() => setTab("history")}
        />
      )}

      {tab === "scan" && (
        <ScanScreen
          settings={settings}
          demoMode={demoMode}
          onDone={async (view) => {
            await refreshRecords();
            showResult(view);
          }}
        />
      )}

      {tab === "result" && (
        <ResultScreen
          result={result}
          settings={settings}
          onStartScan={() => setTab("scan")}
          onGoHistory={() => setTab("history")}
          records={records}
        />
      )}

      {tab === "history" && (
        <HistoryScreen
          records={records}
          onOpenRecord={openRecord}
          onStartScan={() => setTab("scan")}
          onChanged={refreshRecords}
        />
      )}

      {tab === "profile" && (
        <ProfileScreen
          settings={settings}
          records={records}
          onChangeSettings={updateSettings}
          onChanged={refreshRecords}
          demoMode={demoMode}
        />
      )}

      <TabBar active={tab} onChange={setTab} />
    </div>
  );
}
