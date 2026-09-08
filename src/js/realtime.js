/* ==========================================================================
   MILES · realtime
   Live head-to-head telemetry. Two runners in a duo publish distance, pace
   and position several times a second; each sees the other move in real time.

   Transport is pluggable. In this build it is BroadcastChannel, so two open
   tabs (or two windows) genuinely race each other with no server. A pace bot
   stands in when the friend you invited has not joined yet, so a duo run is
   never a dead screen. Swapping in a WebSocket means replacing `_send` and
   the channel wiring below; nothing else changes.
   ========================================================================== */

(function (M) {
  'use strict';

  const { Bus, Geo } = M;

  const STALE_MS = 9000;      // a peer that goes quiet this long is dropped
  const TICK_MS = 1000;

  const Live = {
    channel: null,
    room: null,
    me: null,
    peers: new Map(),
    bot: null,
    _timer: null,

    /** Opens a room. `me` is the identity broadcast to the other side. */
    join(room, me) {
      this.leave();
      this.room = room;
      this.me = me;
      this.peers = new Map();

      try {
        if (typeof BroadcastChannel !== 'undefined') {
          this.channel = new BroadcastChannel('miles-live-' + room);
          this.channel.onmessage = (event) => this._receive(event.data);
        }
      } catch (err) {
        this.channel = null;                       // no transport: bot only
      }

      this._send({ type: 'hello' });
      this._timer = setInterval(() => this._sweep(), TICK_MS);
      return this;
    },

    leave() {
      if (this.channel) { try { this.channel.close(); } catch (err) { /* ignore */ } }
      if (this._timer) clearInterval(this._timer);
      this.channel = null;
      this._timer = null;
      this.bot = null;
      this.peers.clear();
    },

    /** Publishes my current telemetry to everyone else in the room. */
    publish(telemetry) {
      this._send({ type: 'telemetry', telemetry });
    },

    _send(message) {
      if (!this.channel || !this.me) return;
      try {
        this.channel.postMessage(Object.assign({ from: this.me.id, at: Date.now() }, message));
      } catch (err) { /* channel closed mid-flight */ }
    },

    _receive(message) {
      if (!message || message.from === this.me.id) return;
      if (message.type === 'hello') {
        // Someone just joined: answer so they see us immediately.
        this._send({ type: 'telemetry', telemetry: this._lastTelemetry });
        return;
      }
      if (message.type !== 'telemetry' || !message.telemetry) return;

      const t = message.telemetry;
      const peer = Object.assign({}, t, { id: message.from, lastSeen: Date.now(), isBot: false });
      const isNew = !this.peers.has(message.from);
      this.peers.set(message.from, peer);

      // A real runner takes precedence over the stand-in bot.
      if (this.bot) { this.peers.delete('bot'); this.bot = null; }
      if (isNew) Bus.emit('live:joined', peer);
      Bus.emit('live:peers', this.list());
    },

    _sweep() {
      let dropped = false;
      this.peers.forEach((peer, id) => {
        if (!peer.isBot && Date.now() - peer.lastSeen > STALE_MS) { this.peers.delete(id); dropped = true; }
      });
      if (dropped) Bus.emit('live:peers', this.list());
    },

    list() {
      return Array.from(this.peers.values());
    },

    /** Remembers what we last published so a late joiner gets a snapshot. */
    remember(telemetry) { this._lastTelemetry = telemetry; },

    /* --- Pace bot --------------------------------------------------------
       A friend who has not opened their phone yet is represented by a bot
       running their recent average pace, with believable variation so the
       gap opens and closes the way a real race does. --------------------- */

    startBot(friend, origin) {
      this.bot = {
        id: 'bot',
        isBot: true,
        name: friend.name,
        initials: friend.initials,
        color: friend.color,
        distance: 0,
        duration: 0,
        pace: friend.pace || 315,          // seconds per km
        heading: Math.random() * Math.PI * 2,
        origin,
        position: origin,
        phase: Math.random() * 6.28,
      };
      this.peers.set('bot', this.bot);
      Bus.emit('live:peers', this.list());
      return this.bot;
    },

    /** Advances the bot by `dt` seconds of running. */
    tickBot(dt) {
      const bot = this.bot;
      if (!bot) return null;
      bot.duration += dt;
      bot.phase += dt * 0.06;
      // Pace drifts ±6%: surges, then settles.
      const factor = 1 + Math.sin(bot.phase) * 0.06 + Math.sin(bot.phase * 2.7) * 0.02;
      const speed = 1000 / (bot.pace * factor);           // m/s
      const step = speed * dt;
      bot.distance += step;
      bot.currentPace = bot.pace * factor;
      bot.heading += Math.sin(bot.phase * 1.7) * 0.06;
      bot.position = Geo.offset(bot.position, Math.cos(bot.heading) * step, Math.sin(bot.heading) * step);
      bot.lastSeen = Date.now();
      this.peers.set('bot', bot);
      return bot;
    },
  };

  M.Live = Live;
})(window.MILES);
