/* ==========================================================================
   MILES · bootstrap
   ========================================================================== */

(function (M) {
  'use strict';

  function boot() {
    M.State.init();
    M.UI.init();

    // Offer real GPS straight away, but never block on it: the simulated
    // location keeps every screen usable if permission is refused.
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'geolocation' }).then((status) => {
        const note = document.getElementById('geoStatus');
        if (status.state === 'granted') {
          if (note) note.textContent = 'Granted';
          M.UI.locate();
        } else if (note) {
          note.textContent = status.state === 'denied' ? 'Denied — using simulated location' : 'Not requested';
        }
      }).catch(() => { /* unsupported */ });
    }

    // Leaving mid-run should not silently discard it.
    window.addEventListener('beforeunload', (event) => {
      if (M.Tracker.active) {
        event.preventDefault();
        event.returnValue = '';
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.MILES);
