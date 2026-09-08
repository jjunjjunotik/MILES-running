/* ==========================================================================
   MILES · tracker
   Drives an active run: position, distance, pace, splits, loop closure and
   the live telemetry feed. Uses real GPS when the browser grants it and
   falls back to a simulated runner so the app is demonstrable anywhere.
   ========================================================================== */

(function (M) {
  'use strict';

  const { Geo, Bus, Live, uid, clamp } = M;

  const MIN_LOOP_DISTANCE = 400;   // metres before a loop may be closed
  const CLOSE_RADIUS = 30;         // metres from the start that counts as "back"
  const MIN_STEP = 1.2;            // metres; below this it is GPS jitter
  const MAX_STEP = 60;             // metres; above this it is a GPS jump

  const Tracker = {
    active: false,
    mode: 'solo',
    rival: null,
    state: null,
    _watchId: null,
    _timer: null,
    _sim: null,

    /** Speeds up simulated runs so a demo does not take an hour. */
    demoSpeed: 12,

    start(options) {
      const opts = options || {};
      const home = M.State.data.profile.home;

      this.active = true;
      this.mode = opts.mode || 'solo';
      this.rival = opts.rival || null;

      this.state = {
        id: uid(),
        startedAt: Date.now(),
        mode: this.mode,
        rivalName: this.rival ? this.rival.name : null,
        distance: 0,
        duration: 0,
        elevation: 0,
        route: [],
        splits: [],
        paused: false,
        currentPace: 0,
        loopReady: false,
        loopClosed: false,
        closure: null,
        source: 'sim',
      };

      this._sim = {
        position: home,
        heading: Math.random() * Math.PI * 2,
        // A gentle constant turn, in radians per second, makes the simulated
        // runner come back to its own start — that is how territory gets
        // captured in a demo. At ~2.9 m/s these rates trace a loop of roughly
        // 1.2–1.8 km, which closes in a couple of minutes at 12x.
        turnRate: (Math.random() > 0.5 ? 1 : -1) * (0.0105 + Math.random() * 0.005),
        speed: 2.9,
        phase: 0,
      };

      this._startGeolocation();
      this._lastTick = Date.now();
      this._timer = setInterval(() => this._tick(), 250);

      if (this.mode === 'duo' && this.rival) {
        Live.join(opts.room || 'duo-' + this.rival.id, {
          id: uid(),
          name: M.State.data.profile.name,
          initials: M.State.data.profile.initials,
          color: '#c8ff2e',
        });
        Live.startBot(this.rival, home);
      }

      Bus.emit('run:started', this.state);
      return this.state;
    },

    _startGeolocation() {
      if (!navigator.geolocation) return;
      try {
        this._watchId = navigator.geolocation.watchPosition(
          (pos) => {
            this.state.source = 'gps';
            this._push({ lat: pos.coords.latitude, lng: pos.coords.longitude }, pos.coords.altitude);
          },
          () => { /* denied or unavailable: the simulator keeps the run alive */ },
          { enableHighAccuracy: true, maximumAge: 1000, timeout: 8000 }
        );
      } catch (err) { /* insecure context */ }
    },

    pause() {
      if (!this.active) return;
      this.state.paused = !this.state.paused;
      Bus.emit('run:paused', this.state);
    },

    _tick() {
      if (!this.active || this.state.paused) { this._lastTick = Date.now(); return; }

      const now = Date.now();
      const realDt = (now - this._lastTick) / 1000;
      this._lastTick = now;
      const dt = this.state.source === 'gps' ? realDt : realDt * this.demoSpeed;

      this.state.duration += dt;

      if (this.state.source !== 'gps') this._simulate(dt);
      if (this.mode === 'duo') this._advanceRival(dt);

      this.state.currentPace = this.state.distance > 20
        ? this.state.duration / this.state.distance
        : 0;

      this._checkLoop();
      this._publish();
      Bus.emit('run:tick', this.state);
    },

    _simulate(dt) {
      const sim = this._sim;
      sim.phase += dt * 0.35;
      sim.speed = clamp(2.9 + Math.sin(sim.phase * 0.4) * 0.35, 2.2, 3.9);
      sim.heading += (sim.turnRate + Math.sin(sim.phase) * 0.004) * dt;
      const step = sim.speed * dt;
      sim.position = Geo.offset(sim.position, Math.cos(sim.heading) * step, Math.sin(sim.heading) * step);
      this._push(sim.position, null, step);
    },

    /** Adds a fix to the route, rejecting jitter and impossible jumps. */
    _push(latlng, altitude, knownStep) {
      const route = this.state.route;
      if (!route.length) {
        route.push(latlng);
        this.state.startPoint = latlng;
        Bus.emit('run:position', this.state);
        return;
      }
      const last = route[route.length - 1];
      const step = knownStep !== undefined ? knownStep : Geo.distance(last, latlng);
      if (step < MIN_STEP || step > MAX_STEP) {
        if (step > MAX_STEP) route[route.length - 1] = latlng;   // teleport, do not count
        return;
      }

      const before = this.state.distance;
      route.push(latlng);
      this.state.distance += step;
      this.state.elevation += Math.max(0, Math.sin(this.state.distance / 320) * 0.9);

      // Split every whole kilometre, converted for display later.
      const kmBefore = Math.floor(before / 1000);
      const kmAfter = Math.floor(this.state.distance / 1000);
      if (kmAfter > kmBefore) {
        const prev = this.state.splits.reduce((s, x) => s + x.seconds, 0);
        this.state.splits.push({ km: kmAfter, seconds: this.state.duration - prev });
        Bus.emit('run:split', this.state);
      }

      Bus.emit('run:position', this.state);
    },

    _advanceRival(dt) {
      const bot = Live.tickBot(dt);
      if (bot) Bus.emit('live:peers', Live.list());
    },

    /* --- Territory ---------------------------------------------------------
       A loop counts when you have run far enough to enclose something and
       have come back within reach of where you started. --------------------- */

    _checkLoop() {
      const route = this.state.route;
      if (route.length < 8 || this.state.distance < MIN_LOOP_DISTANCE) return;
      const back = Geo.distance(route[0], route[route.length - 1]) <= CLOSE_RADIUS;
      if (back === this.state.loopReady) return;
      this.state.loopReady = back;

      // Passing the start captures the loop and the capture is latched, so a
      // runner never has to hit Finish while standing inside a 30 m circle.
      // Running a second, wider loop replaces the first with the bigger one.
      if (back && (!this.state.closure || this.state.distance > this.state.closure.distance)) {
        this.state.closure = {
          polygon: route.slice(),
          distance: this.state.distance,
          area: Geo.polygonArea(route),
        };
        this.state.loopClosed = true;
        Bus.emit('run:captured', this.state);
      }
      Bus.emit('run:loop', this.state);
    },

    _publish() {
      if (this.mode !== 'duo') return;
      const telemetry = {
        name: M.State.data.profile.name,
        initials: M.State.data.profile.initials,
        color: '#c8ff2e',
        distance: this.state.distance,
        duration: this.state.duration,
        currentPace: this.state.currentPace * 1000,
        position: this.state.route[this.state.route.length - 1] || null,
      };
      Live.remember(telemetry);
      Live.publish(telemetry);
    },

    /** Ends the run and returns a stored activity (null if too short to keep). */
    stop() {
      if (!this.active) return null;
      this.active = false;
      if (this._timer) clearInterval(this._timer);
      if (this._watchId !== null && navigator.geolocation) {
        try { navigator.geolocation.clearWatch(this._watchId); } catch (err) { /* ignore */ }
      }
      this._timer = null;
      this._watchId = null;

      const s = this.state;
      const rivals = Live.list();
      const rival = rivals[0] || null;

      const route = Geo.simplify(s.route, 2.5);
      const closure = s.closure;
      const activity = {
        id: s.id,
        startedAt: s.startedAt,
        mode: s.mode,
        title: titleFor(s),
        distance: s.distance,
        duration: s.duration,
        elevation: Math.round(s.elevation),
        route,
        splits: s.splits,
        loopClosed: !!closure,
        territoryPolygon: closure ? Geo.simplify(closure.polygon, 2.5) : null,
        claimedArea: 0,
        source: s.source,
        rival: rival ? rival.name : s.rivalName,
        rivalDistance: rival ? rival.distance : null,
        won: rival ? s.distance >= rival.distance : null,
      };

      Live.leave();
      this.state = null;
      Bus.emit('run:stopped', activity);
      return activity;
    },

    /** Time of day gives the run its default name, the way Strava does. */
  };

  function titleFor(s) {
    const hour = new Date(s.startedAt).getHours();
    const part = hour < 5 ? 'Night' : hour < 11 ? 'Morning' : hour < 15 ? 'Midday' : hour < 19 ? 'Afternoon' : 'Evening';
    if (s.closure) return `${part} Territory Loop`;
    return s.mode === 'duo' ? `${part} Duel` : `${part} Run`;
  }

  M.Tracker = Tracker;
})(window.MILES);
