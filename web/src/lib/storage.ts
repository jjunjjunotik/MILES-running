import type { NailRecord } from "../../../shared/analysis";

/**
 * 모든 기록은 이 기기의 브라우저 안(IndexedDB)에만 저장된다.
 * 서버는 분석 요청을 중계할 뿐 어떤 것도 보관하지 않는다.
 */
const DB_NAME = "nailsense";
const DB_VERSION = 1;
const STORE_RECORDS = "records";
const STORE_IMAGES = "images";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_RECORDS)) {
        const store = db.createObjectStore(STORE_RECORDS, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt");
      }
      if (!db.objectStoreNames.contains(STORE_IMAGES)) {
        db.createObjectStore(STORE_IMAGES);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("저장소를 열지 못했습니다."));
  });
  return dbPromise;
}

function tx<T>(
  stores: string[],
  mode: IDBTransactionMode,
  run: (t: IDBTransaction) => IDBRequest<T> | void,
): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const transaction = db.transaction(stores, mode);
        let request: IDBRequest<T> | void;
        transaction.onerror = () =>
          reject(transaction.error ?? new Error("저장소 오류"));
        transaction.oncomplete = () =>
          resolve(request ? request.result : undefined);
        request = run(transaction);
      }),
  );
}

export async function saveRecord(
  record: NailRecord,
  image: Blob | null,
): Promise<void> {
  await tx([STORE_RECORDS, STORE_IMAGES], "readwrite", (t) => {
    t.objectStore(STORE_RECORDS).put(record);
    if (image) t.objectStore(STORE_IMAGES).put(image, record.id);
  });
}

export async function listRecords(): Promise<NailRecord[]> {
  const all = await tx<NailRecord[]>([STORE_RECORDS], "readonly", (t) =>
    t.objectStore(STORE_RECORDS).getAll(),
  );
  return (all ?? []).sort((a, b) => b.createdAt - a.createdAt);
}

export async function getImage(id: string): Promise<Blob | undefined> {
  return await tx<Blob>([STORE_IMAGES], "readonly", (t) =>
    t.objectStore(STORE_IMAGES).get(id),
  );
}

export async function deleteRecord(id: string): Promise<void> {
  await tx([STORE_RECORDS, STORE_IMAGES], "readwrite", (t) => {
    t.objectStore(STORE_RECORDS).delete(id);
    t.objectStore(STORE_IMAGES).delete(id);
  });
}

export async function clearAll(): Promise<void> {
  await tx([STORE_RECORDS, STORE_IMAGES], "readwrite", (t) => {
    t.objectStore(STORE_RECORDS).clear();
    t.objectStore(STORE_IMAGES).clear();
  });
}

/** 사진만 지우고 분석 기록은 남긴다. */
export async function clearImagesOnly(): Promise<void> {
  const records = await listRecords();
  await tx([STORE_RECORDS, STORE_IMAGES], "readwrite", (t) => {
    t.objectStore(STORE_IMAGES).clear();
    const store = t.objectStore(STORE_RECORDS);
    for (const record of records) {
      if (record.hasImage) store.put({ ...record, hasImage: false });
    }
  });
}

/* ----------------------------- 설정 ----------------------------- */

export interface Settings {
  /** 분석에 쓴 사진을 기기에 함께 저장할지 여부 */
  keepPhotos: boolean;
  nickname: string;
  /** 결과 화면에서 항목을 기본으로 펼칠지 */
  expandByDefault: boolean;
}

const SETTINGS_KEY = "nailsense.settings.v1";

export const DEFAULT_SETTINGS: Settings = {
  keepPhotos: true,
  nickname: "",
  expandByDefault: false,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // 저장소를 못 쓰는 환경(시크릿 모드 등)에서도 앱은 계속 동작해야 한다.
  }
}
