'use strict';

/* What every copy of the app learns from the server instead of being built
   with, so it can change without an app update. Today that is the ArcGIS key
   that licenses the map's tiles: Esri's keys last a year at most, and a key
   built into the app would leave every phone that had not updated without a
   map. Public, like the key itself, which any copy of the app could show. */

module.exports = function configRoutes(router, app) {
  router.get('/v1/config', { auth: false }, async () => ({
    mapKey: app.config.arcgisMapKey || null,
  }));
};
