import type { NailRecord } from "../../../shared/analysis";

/**
 * 사진은 언제나 이 기기의 브라우저 안(IndexedDB)에만 저장된다. 서버로 보내지 않는다.
 *
 * 로그인하면 분석 결과는 계정(서버)에 저장되고, 사진만 여기에 남는다.
 * 같은 기기를 여러 사람이 쓸 수 있으므로 사진 키에 사용자 아이디를 붙여 나눠 둔다.
 * 로그아웃하면 범위가 바뀌어 남의 사진에 손이 닿지 않는다.
 */
const DB_NAME = "nailsense";
const DB_VERSION = 1;
const STORE_RECORDS = "records";
const STORE_IMAGES = "images";

let dbPromise: Promise<IDBDatabase> | null = null;

/** 사진 키 앞에 붙는 범위. 로그인하면 사용자 아이디로 바뀐다. */
let imageScope = "local";

export function setStorageScope(scope: string | null): void {
  imageScope = scope ?? "local";
}

function imageKey(id: string): string {
  return `${imageScope}:${id}`;
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("이 환경에서는 저장소를 쓸 수 없습니다."));
      return;
    }
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


/**
 * IndexedDB 를 쓸 수 없는 환경(시크릿 모드, 샌드박스된 프레임 등)을 위한 대체 저장소.
 * 탭을 닫으면 사라지지만, 앱이 빈 껍데기가 되지는 않게 해 준다.
 */
const memoryRecords = new Map<string, NailRecord>();
const memoryImages = new Map<string, Blob>();
let useMemory = false;

export function isUsingMemoryStore(): boolean {
  return useMemory;
}

async function withDb<T>(
  run: () => Promise<T>,
  fallback: () => T,
): Promise<T> {
  if (useMemory) return fallback();
  try {
    return await run();
  } catch {
    useMemory = true;
    return fallback();
  }
}

export async function saveRecord(
  record: NailRecord,
  image: Blob | null,
): Promise<void> {
  await withDb(
    async () => {
      await tx([STORE_RECORDS, STORE_IMAGES], "readwrite", (t) => {
        t.objectStore(STORE_RECORDS).put(record);
        if (image) t.objectStore(STORE_IMAGES).put(image, imageKey(record.id));
      });
    },
    () => {
      memoryRecords.set(record.id, record);
      if (image) memoryImages.set(record.id, image);
    },
  );
}

export async function listRecords(): Promise<NailRecord[]> {
  const all = await withDb(
    async () =>
      await tx<NailRecord[]>([STORE_RECORDS], "readonly", (t) =>
        t.objectStore(STORE_RECORDS).getAll(),
      ),
    () => [...memoryRecords.values()],
  );
  return (all ?? []).sort((a, b) => b.createdAt - a.createdAt);
}

export async function getImage(id: string): Promise<Blob | undefined> {
  return await withDb(
    async () =>
      await tx<Blob>([STORE_IMAGES], "readonly", (t) =>
        t.objectStore(STORE_IMAGES).get(imageKey(id)),
      ),
    () => memoryImages.get(imageKey(id)),
  );
}

export async function putImage(id: string, image: Blob): Promise<void> {
  await withDb(
    async () => {
      await tx([STORE_IMAGES], "readwrite", (t) =>
        void t.objectStore(STORE_IMAGES).put(image, imageKey(id)),
      );
    },
    () => {
      memoryImages.set(imageKey(id), image);
    },
  );
}

export async function deleteImage(id: string): Promise<void> {
  await withDb(
    async () => {
      await tx([STORE_IMAGES], "readwrite", (t) =>
        void t.objectStore(STORE_IMAGES).delete(imageKey(id)),
      );
    },
    () => {
      memoryImages.delete(imageKey(id));
    },
  );
}

/** 지금 범위(= 로그인한 사용자)의 사진만 지운다. 다른 사용자 사진은 건드리지 않는다. */
export async function clearScopedImages(): Promise<void> {
  const prefix = `${imageScope}:`;
  await withDb(
    async () => {
      const keys =
        (await tx<IDBValidKey[]>([STORE_IMAGES], "readonly", (t) =>
          t.objectStore(STORE_IMAGES).getAllKeys(),
        )) ?? [];
      const mine = keys.filter(
        (key) => typeof key === "string" && key.startsWith(prefix),
      );
      if (mine.length === 0) return;
      await tx([STORE_IMAGES], "readwrite", (t) => {
        const store = t.objectStore(STORE_IMAGES);
        for (const key of mine) store.delete(key);
      });
    },
    () => {
      for (const key of [...memoryImages.keys()]) {
        if (key.startsWith(prefix)) memoryImages.delete(key);
      }
    },
  );
}

export async function deleteRecord(id: string): Promise<void> {
  await withDb(
    async () => {
      await tx([STORE_RECORDS, STORE_IMAGES], "readwrite", (t) => {
        t.objectStore(STORE_RECORDS).delete(id);
        t.objectStore(STORE_IMAGES).delete(imageKey(id));
      });
    },
    () => {
      memoryRecords.delete(id);
      memoryImages.delete(imageKey(id));
    },
  );
}

export async function clearAll(): Promise<void> {
  memoryRecords.clear();
  memoryImages.clear();
  await withDb(
    async () => {
      await tx([STORE_RECORDS, STORE_IMAGES], "readwrite", (t) => {
        t.objectStore(STORE_RECORDS).clear();
        t.objectStore(STORE_IMAGES).clear();
      });
    },
    () => undefined,
  );
}

/** 사진만 지우고 분석 기록은 남긴다. (서버 없이 도는 데모용) */
export async function clearImagesOnly(): Promise<void> {
  const records = await listRecords();
  await clearScopedImages();
  await withDb(
    async () => {
      await tx([STORE_RECORDS], "readwrite", (t) => {
        const store = t.objectStore(STORE_RECORDS);
        for (const record of records) {
          if (record.hasImage) store.put({ ...record, hasImage: false });
        }
      });
    },
    () => {
      for (const record of records) {
        if (record.hasImage) {
          memoryRecords.set(record.id, { ...record, hasImage: false });
        }
      }
    },
  );
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
