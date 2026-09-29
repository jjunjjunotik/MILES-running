/* ==========================================================================
   MILES · native
   The one place that knows whether MILES is running as the Android or iOS
   app or in a browser. In the app, GPS comes from the background-location
   plugin, so a run keeps recording with the screen off or another app in
   front; Android shows its "run in progress" notification while it does. In
   a browser it is the ordinary geolocation API, exactly as before.
   ========================================================================== */

(function (M) {
  'use strict';

  const Cap = window.Capacitor;
  const isApp = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  const Background = isApp && Cap.registerPlugin ? Cap.registerPlugin('BackgroundGeolocation') : null;
  // Android only: asks to show the "Run in progress" notification (see
  // RunNoticePlugin.java). Without it Android 13+ hides the notification.
  const RunNotice = isApp && Cap.getPlatform() === 'android' ? Cap.registerPlugin('RunNotice') : null;
  let noticeAsked = null;

  const Native = {
    isApp,
    platform: isApp ? Cap.getPlatform() : 'web',

    /**
     * Calls `onFix({ lat, lng, altitude })` for every position until the
     * returned function is called. `onError` hears a refusal once; the run
     * carries on without GPS either way. `options.background` keeps it going
     * with the screen off — a run asks for that, "centre on me" does not.
     */
    watchPosition(onFix, onError, options) {
      const background = !!(options && options.background);
      const fail = onError || function () {};
      if (Background) {
        let id = null;
        let stopped = false;
        if (background && RunNotice && !noticeAsked) noticeAsked = RunNotice.request().catch(() => {});
        const watch = { requestPermissions: true, stale: false, distanceFilter: 0 };
        if (background) {
          // On Android this is the text of the notification that keeps the
          // run recording; its presence is what makes the watcher run in the
          // background at all.
          watch.backgroundTitle = 'Run in progress';
          watch.backgroundMessage = 'MILES is recording your route.';
        }
        Promise.resolve(background && noticeAsked).then(() => (stopped ? null : Background.addWatcher(
          watch,
          (loc, err) => {
            if (err) { fail(err); return; }
            if (loc) onFix({ lat: loc.latitude, lng: loc.longitude, altitude: loc.altitude });
          }
        ))).then((watcher) => {
          if (watcher == null) return;
          id = watcher;
          if (stopped) Background.removeWatcher({ id });
        }).catch(fail);
        return () => {
          stopped = true;
          if (id !== null) Background.removeWatcher({ id }).catch(() => {});
        };
      }

      if (!navigator.geolocation) return () => {};
      let watch = null;
      try {
        watch = navigator.geolocation.watchPosition(
          (pos) => onFix({ lat: pos.coords.latitude, lng: pos.coords.longitude, altitude: pos.coords.altitude }),
          fail,
          { enableHighAccuracy: true, maximumAge: 1000, timeout: 8000 }
        );
      } catch (err) { /* insecure context */ }
      return () => {
        if (watch !== null) {
          try { navigator.geolocation.clearWatch(watch); } catch (err) { /* ignore */ }
        }
      };
    },

    /** One position, for "centre on me". Same permission path as a run. */
    currentPosition(onFix, onError) {
      let stop = null;
      let done = false;
      const finish = (fn) => (value) => {
        if (done) return;
        done = true;
        if (stop) stop();
        fn(value);
      };
      const got = finish(onFix);
      const failed = finish(onError || function () {});
      stop = this.watchPosition(got, failed);
      if (done) stop();
      setTimeout(() => failed(new Error('timeout')), 15000);
    },

    /** Sends the runner to the app's settings, where a refused permission is turned back on. */
    openSettings() {
      if (Background) Background.openSettings().catch(() => {});
    },
  };

  if (isApp) document.documentElement.dataset.platform = Native.platform;
  M.Native = Native;
})(window.MILES);
