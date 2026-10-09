import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
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
import { LibraryScreen } from "./screens/LibraryScreen";
import { ProfileScreen } from "./screens/ProfileScreen";
import { OnboardingScreen } from "./screens/OnboardingScreen";
import { AuthScreen } from "./screens/AuthScreen";
import { PlanScreen } from "./screens/PlanScreen";
import { LegalSheet } from "./components/Legal";
import { fetchBillingStatus } from "./lib/billing";
import { giveConsent, hasConsent } from "./lib/consent";
import {
  HEALTH_CONSENT_VERSION,
  type BillingStatus,
  type UsageInfo,
} from "../../shared/billing";
import type { LegalDocId } from "../../shared/legal";
import { RETURN_TAB_KEY } from "./i18n";
import { IS_APP } from "./lib/platform";

/**
 * 휴대폰 앱은 스토어 인앱 구독 화면을 쓴다(웹 결제 창을 앱에 띄우면 스토어 심사에서 거절된다).
 * 웹 빌드에는 이 화면과 RevenueCat 코드가 들어가지 않는다.
 */
const StorePlanScreen = IS_APP
  ? lazy(() => import("./screens/StorePlanScreen").then((m) => ({ default: m.StorePlanScreen })))
  : null;
import {
  DEFAULT_SETTINGS,
  clearAll,
  deleteImage,
  deleteRecord as deleteLocalRecord,
  getImage,
  listRecords,
  loadSettings,
  saveSettings,
  setStorageScope,
  type Settings,
} from "./lib/storage";
import { health, STANDALONE_DEMO } from "./lib/api";
import {
  deleteAllScans,
  deleteScan,
  fetchMe,
  fetchPreferences,
  listScans,
  logout as serverLogout,
  savePreferences,
  toRecord,
  type AuthUser,
  type ServerScan,
} from "./lib/server";
import { seedExampleRecords } from "./lib/seed";
import { IconContext, OfflineIcon } from "./components/Icons";
import { L } from "./i18n";

/** 아이콘 기본값. 장식용이라 화면 낭독기에서는 숨기고, 뜻은 옆의 글자가 전한다. */
const ICON_DEFAULTS = {
  size: 20,
  weight: "regular" as const,
  "aria-hidden": true,
};

export type Tab = "home" | "scan" | "library" | "history" | "profile";

/**
 * 앱이 지금 어느 단계에 있는지.
 *
 * 로그인은 관문이 아니다. 온보딩을 지나면 바로 쓸 수 있고, 그때 기록은 이 기기에 쌓인다.
 * 로그인은 프로필에서 고르는 선택이며, 그때부터 기록이 계정에 저장된다.
 */
type Phase = "loading" | "onboarding" | "ready";

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

const ONBOARDED_KEY = "nailsense.onboarded.v1";

export function App() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [tab, setTab] = useState<Tab>(() => {
    // 언어를 바꾸느라 다시 불러왔다면 프로필로 돌아온다.
    try {
      const back = sessionStorage.getItem(RETURN_TAB_KEY);
      sessionStorage.removeItem(RETURN_TAB_KEY);
      if (back === "profile") return "profile";
    } catch {
      // 저장소를 못 쓰면 홈에서 시작한다.
    }
    return "home";
  });
  const [records, setRecords] = useState<NailRecord[]>([]);
  const [failedScans, setFailedScans] = useState<ServerScan[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [result, setResult] = useState<ResultView | null>(null);
  const [demoMode, setDemoMode] = useState(false);
  /** 서버가 쓰는 분석 업체("Gemini"/"Claude"). 동의 창에서 받는 곳을 밝힐 때 쓴다. */
  const [provider, setProvider] = useState<string | null>(null);
  /** 프로필에서 직접 열었을 때만 보이는 로그인 화면 */
  const [showAuth, setShowAuth] = useState(false);
  /** 요금제 화면. 로그인하러 갔다 와도 그대로 돌아오도록 따로 기억한다. */
  const [showPlan, setShowPlan] = useState(false);
  /** 어느 화면 위에서든 여는 약관 시트 */
  const [legalDoc, setLegalDoc] = useState<LegalDocId | null>(null);
  /** 요금제와 사용량. 결제 기능이 꺼져 있으면 enabled: false */
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  // 이전 결과의 blob URL 을 확실히 해제하기 위해 ref 로 들고 있는다.
  const currentUrl = useRef<string | null>(null);
  // 콜백들이 최신 로그인 상태를 보도록 ref 로도 들고 있는다.
  const userRef = useRef<AuthUser | null>(null);
  userRef.current = user;

  const refreshBilling = useCallback(async () => {
    const status = await fetchBillingStatus();
    if (status) setBilling(status);
  }, []);

  /** 분석 직후처럼 사용량만 바뀌었을 때 */
  const updateUsage = useCallback((usage: UsageInfo) => {
    setBilling((current) => (current ? { ...current, usage } : current));
  }, []);

  /** 기록을 다시 읽는다. 로그인했으면 계정에서, 아니면 이 기기에서. */
  const refreshRecords = useCallback(async (signedIn: boolean = Boolean(userRef.current)) => {
    if (STANDALONE_DEMO || !signedIn) {
      try {
        setRecords(await listRecords());
      } catch {
        setRecords([]);
      }
      return;
    }

    try {
      const scans = await listScans();
      setRecords(
        scans
          .map(toRecord)
          .filter((record): record is NailRecord => record !== null),
      );
      setFailedScans(scans.filter((scan) => scan.status === "failed"));
    } catch {
      // 네트워크가 끊겼을 때 이미 보고 있던 목록을 지우지 않는다.
    }
  }, []);

  /** 로그인 직후, 그리고 새로고침 후 세션이 살아 있을 때 하는 일. */
  const enterApp = useCallback(
    async (signedIn: AuthUser) => {
      setUser(signedIn);
      // 사진은 기기 안에 사용자별로 나뉘어 저장된다.
      setStorageScope(signedIn.id);

      try {
        const prefs = await fetchPreferences();
        setSettings({
          nickname: prefs.nickname || signedIn.displayName,
          keepPhotos: prefs.keepPhotos,
          expandByDefault: prefs.expandByDefault,
        });
        // 이 계정으로 지금 문구에 동의한 적이 있으면 이 기기에서도 다시 묻지 않는다.
        if (
          !hasConsent() &&
          prefs.healthConsentVersion === HEALTH_CONSENT_VERSION &&
          prefs.healthConsentAt
        ) {
          giveConsent(prefs.healthConsentAt);
        }
      } catch {
        setSettings(loadSettings());
      }

      await Promise.all([refreshRecords(true), refreshBilling()]);
      setPhase("ready");
    },
    [refreshRecords, refreshBilling],
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const seenOnboarding = localStorage.getItem(ONBOARDED_KEY) === "1";

      void health().then((info) => {
        if (!info || cancelled) return;
        setDemoMode(!info.configured && info.demoAvailable);
        setProvider(info.provider ?? null);
      });
      void refreshBilling();

      // 서버 없이 도는 단일 HTML 데모: 계정이라는 개념 자체가 없다.
      if (STANDALONE_DEMO) {
        setSettings(loadSettings());
        try {
          await seedExampleRecords();
        } catch {
          // 저장소를 못 써도 앱은 그대로 동작한다.
        }
        await refreshRecords(false);
        if (!cancelled) setPhase(seenOnboarding ? "ready" : "onboarding");
        return;
      }

      // 지난번에 로그인해 두었으면 그대로 이어 간다. 아니면 이 기기에 저장하며 쓴다.
      let me: AuthUser | null = null;
      try {
        me = await fetchMe();
      } catch {
        me = null;
      }
      if (cancelled) return;

      if (me) {
        await enterApp(me);
        if (!cancelled && !seenOnboarding) setPhase("onboarding");
        return;
      }

      setSettings(loadSettings());
      await refreshRecords(false);
      if (!cancelled) setPhase(seenOnboarding ? "ready" : "onboarding");
    })();

    return () => {
      cancelled = true;
    };
  }, [enterApp, refreshRecords, refreshBilling]);

  // 네트워크가 끊기고 돌아오는 것을 화면 위쪽 띠로 알린다.
  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      void refreshRecords();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [refreshRecords]);

  // 앱을 다른 데 갔다 돌아왔을 때 목록을 새로 맞춘다.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && phase === "ready") {
        void refreshRecords();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [phase, refreshRecords]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [tab, result, showPlan]);

  const updateSettings = useCallback(
    (next: Settings) => {
      setSettings(next);
      saveSettings(next);
      if (!STANDALONE_DEMO && user) {
        // 설정은 계정에도 남겨 다른 기기에서 이어진다.
        void savePreferences({
          nickname: next.nickname,
          keepPhotos: next.keepPhotos,
          expandByDefault: next.expandByDefault,
        }).catch(() => undefined);
      }
    },
    [user],
  );

  const showResult = useCallback((view: ResultView) => {
    if (currentUrl.current && currentUrl.current !== view.imageUrl) {
      URL.revokeObjectURL(currentUrl.current);
    }
    currentUrl.current = view.imageUrl;
    setResult(view);
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

  const removeRecord = useCallback(
    async (id: string) => {
      if (STANDALONE_DEMO || !userRef.current) {
        await deleteLocalRecord(id);
      } else {
        await deleteScan(id);
        // 서버에서 지웠으면 이 기기의 사진도 같이 지운다.
        await deleteImage(id).catch(() => undefined);
      }
      await refreshRecords();
    },
    [refreshRecords],
  );

  const removeAllRecords = useCallback(async () => {
    if (STANDALONE_DEMO || !userRef.current) {
      await clearAll();
    } else {
      await deleteAllScans();
    }
    await refreshRecords();
  }, [refreshRecords]);

  const signOut = useCallback(async () => {
    try {
      await serverLogout();
    } catch {
      // 서버에 닿지 못해도 이 기기에서는 나간다.
    }
    if (IS_APP) void import("./lib/store").then((m) => m.forgetStoreUser());
    setStorageScope(null);
    setUser(null);
    setRecords([]);
    setFailedScans([]);
    setResult(null);
    setSettings(loadSettings());
    setTab("home");
    setShowPlan(false);
    // 로그인 화면으로 쫓아내지 않는다. 이 기기에 저장하며 계속 쓸 수 있다.
    await Promise.all([refreshRecords(false), refreshBilling()]);
  }, [refreshRecords, refreshBilling]);

  const finishOnboarding = useCallback(() => {
    try {
      localStorage.setItem(ONBOARDED_KEY, "1");
    } catch {
      // 저장소를 못 써도 흐름은 이어진다.
    }
    setPhase("ready");
  }, []);

  return (
    <IconContext.Provider value={ICON_DEFAULTS}>
      <div className="app">
        {renderPhase()}
        {legalDoc && <LegalSheet doc={legalDoc} onClose={() => setLegalDoc(null)} />}
      </div>
    </IconContext.Provider>
  );

  function renderPhase() {
    if (phase === "loading") {
      return (
        <main className="boot" aria-busy="true">
          <span className="wordmark">NailSense</span>
          <span className="sr-only">{L("Loading", "불러오는 중")}</span>
        </main>
      );
    }

    if (phase === "onboarding") {
      return <OnboardingScreen onDone={finishOnboarding} />;
    }

    if (showAuth) {
      return (
        <AuthScreen
          onSignedIn={(signedIn) => {
            setShowAuth(false);
            void enterApp(signedIn);
          }}
          onBack={() => setShowAuth(false)}
        />
      );
    }

    if (showPlan && StorePlanScreen) {
      return (
        <Suspense fallback={null}>
          <StorePlanScreen
            billing={billing}
            user={user}
            onBack={() => setShowPlan(false)}
            onSignIn={() => setShowAuth(true)}
            onBillingChange={setBilling}
            onOpenLegal={setLegalDoc}
          />
        </Suspense>
      );
    }

    if (showPlan) {
      return (
        <PlanScreen
          billing={billing}
          user={user}
          onBack={() => setShowPlan(false)}
          onBillingChange={setBilling}
          onOpenLegal={setLegalDoc}
        />
      );
    }

    return (
      <>
        {!online && (
          <div className="offline-bar" role="status">
            <OfflineIcon size={16} />
            {L("You're offline. Saved records are still available.", "네트워크가 끊겼어요. 저장된 기록은 계속 볼 수 있어요.")}
          </div>
        )}

        {result ? (
          <ResultScreen
            result={result}
            settings={settings}
            records={records}
            onStartScan={() => {
              setResult(null);
              setTab("scan");
            }}
            onGoHistory={() => {
              setResult(null);
              setTab("history");
            }}
            onClose={() => setResult(null)}
          />
        ) : (
          <>
            {tab === "home" && (
              <HomeScreen
                records={records}
                settings={settings}
                demoMode={demoMode}
                signedIn={Boolean(user)}
                onStartScan={() => setTab("scan")}
                onOpenRecord={openRecord}
                onGoHistory={() => setTab("history")}
                onGoLibrary={() => setTab("library")}
              />
            )}

            {tab === "scan" && (
              <ScanScreen
                settings={settings}
                demoMode={demoMode}
                online={online}
                signedIn={Boolean(user)}
                usage={billing?.enabled ? billing.usage : null}
                provider={provider}
                onUsage={updateUsage}
                onOpenPlan={billing?.enabled ? () => setShowPlan(true) : undefined}
                onSignIn={() => setShowAuth(true)}
                onDone={async (view) => {
                  await refreshRecords();
                  showResult(view);
                }}
              />
            )}

            {tab === "library" && <LibraryScreen />}

            {tab === "history" && (
              <HistoryScreen
                records={records}
                failedScans={failedScans}
                onOpenRecord={openRecord}
                onStartScan={() => setTab("scan")}
                onDelete={removeRecord}
                onChanged={refreshRecords}
              />
            )}

            {tab === "profile" && (
              <ProfileScreen
                user={user}
                onSignIn={() => setShowAuth(true)}
                settings={settings}
                records={records}
                onChangeSettings={updateSettings}
                onChanged={refreshRecords}
                onDeleteAll={removeAllRecords}
                onSignOut={signOut}
                billing={billing}
                onOpenPlan={() => setShowPlan(true)}
                onOpenLegal={setLegalDoc}
              />
            )}
          </>
        )}

        {/* 결과를 보는 중에도 탭은 그대로 둔다. 어디에 있든 빠져나갈 길이 있어야 한다. */}
        <TabBar
          active={tab}
          onChange={(next) => {
            setResult(null);
            setTab(next);
          }}
        />
      </>
    );
  }
}
