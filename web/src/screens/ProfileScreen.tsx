import { useEffect, useState } from "react";
import {
  DISCLAIMER_LONG,
  type NailRecord,
} from "../../../shared/analysis";
import {
  clearImagesOnly,
  clearScopedImages,
  listRecords,
  type Settings,
} from "../lib/storage";
import { STANDALONE_DEMO } from "../lib/api";
import {
  ServerError,
  clearServerImages,
  deleteAccount,
  importScans,
  type AuthUser,
} from "../lib/server";
import { Notice, Sheet, TopBar } from "../components/ui";

type PendingAction = "photos" | "all" | "account" | null;

export const APP_VERSION = "1.0.0";

export function ProfileScreen({
  user,
  settings,
  records,
  onChangeSettings,
  onChanged,
  onDeleteAll,
  onSignOut,
  onSignIn,
}: {
  user: AuthUser | null;
  settings: Settings;
  records: NailRecord[];
  onChangeSettings: (settings: Settings) => void;
  onChanged: () => Promise<void> | void;
  onDeleteAll: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onSignIn?: () => void;
}) {
  const [pending, setPending] = useState<PendingAction>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  /** 기록 가져오기 결과. 가져오기 안내가 있던 자리에 보여 준다. */
  const [imported, setImported] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** 계정을 만들기 전에 이 기기에 쌓여 있던 기록. 있으면 가져올 수 있게 안내한다. */
  const [localCount, setLocalCount] = useState(0);

  const photoCount = records.filter((record) => record.hasImage).length;

  useEffect(() => {
    if (STANDALONE_DEMO || !user) return;
    void listRecords()
      .then((found) => setLocalCount(found.length))
      .catch(() => setLocalCount(0));
  }, [user]);

  async function importLocal() {
    setBusy(true);
    try {
      const found = await listRecords();
      const count = await importScans(found);
      setImported(
        count > 0
          ? `Moved ${count} ${count === 1 ? "scan" : "scans"} from this device to your account.`
          : "There were no new scans to move.",
      );
      setLocalCount(0);
      await onChanged();
    } catch (err) {
      setImported(
        err instanceof ServerError ? err.message : "We couldn't move your scans.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function run(action: Exclude<PendingAction, null>) {
    setBusy(true);
    setError(null);
    try {
      if (action === "photos") {
        if (STANDALONE_DEMO || !user) {
          await clearImagesOnly();
        } else {
          // 사진은 기기에서 지우고, 서버에는 "사진 없음"으로 표시만 남긴다.
          await clearScopedImages();
          await clearServerImages();
        }
        setDone("All saved photos were deleted. Your scan history is still here.");
        await onChanged();
      } else if (action === "all") {
        await clearScopedImages();
        await onDeleteAll();
        setDone("All scans and photos were deleted.");
      } else {
        // 비밀번호가 없는 소셜 계정은 이메일을 그대로 적어 확인한다.
        await deleteAccount(
          user?.hasPassword ? { password } : { confirmEmail: password },
        );
        await clearScopedImages();
        setPassword("");
        await onSignOut();
        return;
      }
    } catch (err) {
      if (action === "account") {
        setError(
          err instanceof ServerError
            ? err.message
            : "We couldn't delete your account.",
        );
        setBusy(false);
        return;
      }
      setDone("Delete didn't work. Please try again in a moment.");
    } finally {
      setBusy(false);
      if (action !== "account") setPending(null);
    }
  }

  return (
    <>
      <TopBar title="Profile" />
      <main className="screen">
        {user ? (
          <section className="account">
            <div style={{ minWidth: 0 }}>
              <div className="name">{user.displayName || "No name"}</div>
              <div className="sub">{user.email}</div>
            </div>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => void onSignOut()}
            >
              Log out
            </button>
          </section>
        ) : !STANDALONE_DEMO ? (
          <section className="account">
            <div>
              <div className="name">Saving on this device</div>
              <div className="sub">
                Create an account to see your history on other devices.
              </div>
            </div>
            {onSignIn && (
              <button
                className="btn btn-primary btn-sm signin-btn"
                onClick={onSignIn}
                aria-label="Log in or create an account"
              >
                Log in
              </button>
            )}
          </section>
        ) : null}

        {localCount > 0 && (
          <div className="import-box">
            <div className="t">{localCount} {localCount === 1 ? "scan" : "scans"} saved on this device</div>
            <p>
              These were saved before you had an account. Move them to your
              account to see them on other devices.
            </p>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => void importLocal()}
              disabled={busy}
            >
              Move to account
            </button>
          </div>
        )}

        {imported && (
          <div className="mt-16" role="status">
            <Notice>{imported}</Notice>
          </div>
        )}

        <section className="sec" style={{ marginTop: 28 }}>
          <label className="field-label" htmlFor="nickname">
            Nickname <span className="opt">(optional)</span>
          </label>
          <input
            id="nickname"
            className="field"
            maxLength={12}
            autoComplete="nickname"
            value={settings.nickname}
            onChange={(event) =>
              onChangeSettings({ ...settings, nickname: event.target.value })
            }
          />
          <p className="field-help">
            Shown on your results and share cards.
            {user ? " Saved to your account, so it follows you to other devices." : ""}
          </p>
        </section>

        <section className="sec">
          <h3 className="sec-title">Your history</h3>
          <ul className="list">
            <li className="row">
              <div className="row-main">
                <div className="row-title">Scans</div>
                <div className="row-sub">Results saved so far</div>
              </div>
              <span className="row-end num">{records.length}</span>
            </li>
            <li className="row">
              <div className="row-main">
                <div className="row-title">Saved photos</div>
                <div className="row-sub">Kept on this device only</div>
              </div>
              <span className="row-end num">{photoCount}</span>
            </li>
          </ul>
        </section>

        <section className="sec">
          <h3 className="sec-title">Settings</h3>
          <div className="list">
            <ToggleRow
              label="Save analyzed photos"
              sub="When off, only results are kept and photos aren't saved."
              on={settings.keepPhotos}
              onToggle={() =>
                onChangeSettings({
                  ...settings,
                  keepPhotos: !settings.keepPhotos,
                })
              }
            />
            <ToggleRow
              label="Expand result details"
              sub="Show each area's details open on the result screen."
              on={settings.expandByDefault}
              onToggle={() =>
                onChangeSettings({
                  ...settings,
                  expandByDefault: !settings.expandByDefault,
                })
              }
            />
          </div>
        </section>

        <section className="sec">
          <h3 className="sec-title">Your data</h3>
          <div className="list">
            <button className="row" onClick={() => setPending("photos")}>
              <div className="row-main">
                <div className="row-title">Delete photos only</div>
                <div className="row-sub">Keeps your scan history, removes the photos</div>
              </div>
            </button>
            <button className="row danger" onClick={() => setPending("all")}>
              <div className="row-main">
                <div className="row-title">Delete all history</div>
                <div className="row-sub">Removes every result and photo</div>
              </div>
            </button>
          </div>
          {done && (
            <div className="mt-12">
              <Notice>{done}</Notice>
            </div>
          )}
        </section>

        <section className="sec">
          <h3 className="sec-title">Privacy</h3>
          <QA
            title="Photos stay on this device"
            body="Nail photos are used only for analysis and are never stored on our server."
          />
          <QA
            title="Only you see your history"
            body="Only you can view or delete your scans."
          />
        </section>

        <section className="sec">
          <h3 className="sec-title">About</h3>
          <QA title="Not a diagnosis" body={DISCLAIMER_LONG} />
          <QA
            title="What is the observation index?"
            body="A reference number from 0 to 100 for how even the nail looks in the photo. It is not a health score, and it only means something when comparing photos taken in similar conditions."
          />
        </section>

        {user && (
          <section className="sec">
            <h3 className="sec-title">Account</h3>
            <div className="list">
              <button
                className="row danger"
                onClick={() => setPending("account")}
              >
                <div className="row-main">
                  <div className="row-title">Delete account</div>
                  <div className="row-sub">
                    Removes your account and all scans. This can't be undone.
                  </div>
                </div>
              </button>
            </div>
          </section>
        )}

        <p className="version">NailSense v{APP_VERSION}</p>
      </main>

      {pending && (
        <Sheet
          label={
            pending === "photos"
              ? "Delete photos"
              : pending === "all"
                ? "Delete all history"
                : "Delete account"
          }
          onClose={() => {
            if (busy) return;
            setPending(null);
            setPassword("");
            setError(null);
          }}
        >
          <h3>
            {pending === "photos"
              ? "Delete all saved photos?"
              : pending === "all"
                ? "Delete all history?"
                : "Delete your account?"}
          </h3>
          <p>
            {pending === "photos"
              ? `${photoCount} ${photoCount === 1 ? "photo" : "photos"} on this device will be deleted. Your results stay.`
              : pending === "all"
                ? `${records.length} ${records.length === 1 ? "scan" : "scans"} and their photos will be deleted. This can't be undone.`
                : "Your account, all scans and the photos on this device will be deleted. This can't be undone."}
          </p>

          {pending === "account" && (
            <div className="mt-16">
              <label className="field-label" htmlFor="confirm-delete">
                {user?.hasPassword
                  ? "Enter your password to confirm"
                  : `Type ${user?.email} to confirm`}
              </label>
              <input
                id="confirm-delete"
                className="field"
                type={user?.hasPassword ? "password" : "email"}
                value={password}
                autoComplete={user?.hasPassword ? "current-password" : "off"}
                onChange={(event) => setPassword(event.target.value)}
              />
              {error && (
                <p className="form-error mt-8" role="alert">
                  {error}
                </p>
              )}
            </div>
          )}
          <div className="btn-row mt-16">
            <button
              className="btn btn-secondary"
              onClick={() => {
                setPending(null);
                setPassword("");
                setError(null);
              }}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              className="btn btn-danger"
              disabled={busy}
              onClick={() => void run(pending)}
            >
              Delete
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}

function ToggleRow({
  label,
  sub,
  on,
  onToggle,
}: {
  label: string;
  sub: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      className="row"
      onClick={onToggle}
      role="switch"
      aria-checked={on}
      aria-label={label}
    >
      <div className="row-main">
        <div className="row-title">{label}</div>
        <div className="row-sub">{sub}</div>
      </div>
      <span className={`switch${on ? " on" : ""}`} />
    </button>
  );
}

function QA({ title, body }: { title: string; body: string }) {
  return (
    <div className="qa">
      <h4>{title}</h4>
      <p>{body}</p>
    </div>
  );
}
