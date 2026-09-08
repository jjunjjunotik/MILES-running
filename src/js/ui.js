/* ==========================================================================
   MILES · ui
   Screen rendering and event wiring. Every render reads from State, so any
   change — a finished run, a unit switch — repaints the whole app coherently.
   ========================================================================== */

(function (M) {
  'use strict';

  const { $, $$, el, State, Stats, Units, Geo, Bus, Tracker, Live, clamp, clock, relTime } = M;

  const TAB_SCREENS = ['home', 'territory', 'quests', 'feed', 'profile'];

  const UI = {
    tab: 'home',
    maps: {},
    range: 'week',
    pendingRival: null,
    lastActivity: null,

    /* --- Boot ------------------------------------------------------------ */

    init() {
      this.range = State.data.rangeMode || 'week';
      this.buildMaps();
      this.bindChrome();
      this.bindHome();
      this.bindRun();
      this.bindFinish();
      this.bindProfile();

      Bus.on('state:changed', () => this.renderAll());
      this.renderAll();
      this.tickMapAnimation();
    },

    buildMaps() {
      this.maps.home = new M.MapView($('#homeMap'), { mpp: 1.4, padding: 30 });
      this.maps.run = new M.MapView($('#runMap'), { mpp: 1.1, padding: 34 });
      this.maps.territory = new M.MapView($('#terrMap'), { mpp: 2.4, padding: 26 });
      Object.values(this.maps).forEach((map) => map.setAnchor(State.data.profile.home));
    },

    /** One rAF loop keeps the "you are here" pulse alive on the visible map. */
    tickMapAnimation() {
      const step = () => {
        const map = this.tab === 'run' ? this.maps.run : this.tab === 'home' ? this.maps.home : null;
        if (map && map.layers.me) map.draw();
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },

    /* --- Navigation & toasts --------------------------------------------- */

    bindChrome() {
      $$('#tabbar button').forEach((btn) => {
        btn.addEventListener('click', () => this.go(btn.dataset.tab));
      });
      $$('[data-goto]').forEach((btn) => {
        btn.addEventListener('click', () => this.go(btn.dataset.goto));
      });
    },

    go(tab) {
      this.tab = tab;
      $$('.screen').forEach((s) => s.setAttribute('data-active', String(s.id === 'screen-' + tab)));
      $$('#tabbar button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
      $('#tabbar').style.display = (tab === 'run' || tab === 'finish') ? 'none' : '';

      const screen = $('#screen-' + tab);
      if (screen) screen.scrollTop = 0;

      if (tab === 'territory') this.renderTerritory();
      if (tab === 'feed') this.renderFeed();
      if (tab === 'home') this.maps.home.invalidate();
    },

    toast(html, kind) {
      const node = el('div', { class: 'toast' + (kind ? ' toast--' + kind : ''), html });
      $('#toasts').appendChild(node);
      setTimeout(() => {
        node.style.transition = 'opacity .3s ease, transform .3s ease';
        node.style.opacity = '0';
        node.style.transform = 'translateY(-8px)';
        setTimeout(() => node.remove(), 320);
      }, 3200);
    },

    /* --- Global render ---------------------------------------------------- */

    renderAll() {
      this.applyEnergy();
      this.renderHome();
      this.renderQuests();
      this.renderProfile();
      if (this.tab === 'territory') this.renderTerritory();
      if (this.tab === 'feed') this.renderFeed();
    },

    /** The core "run more, feel more alive" rule, applied to the whole app. */
    applyEnergy() {
      const { tier, energy } = Stats.tier(State.data);
      const root = document.documentElement;
      root.setAttribute('data-tier', tier.key);
      root.style.setProperty('--energy', energy.toFixed(3));
    },

    /* --- Home ------------------------------------------------------------- */

    bindHome() {
      $$('[data-range]').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.range = btn.dataset.range;
          State.data.rangeMode = this.range;
          State.save();
        });
      });

      $$('[data-unit]').forEach((btn) => {
        btn.addEventListener('click', () => State.setUnits(btn.dataset.unit));
      });

      $('#startSolo').addEventListener('click', () => this.beginRun({ mode: 'solo' }));
      $('#startDuo').addEventListener('click', () => this.openDuoSheet());
      $('#locateBtn').addEventListener('click', () => this.locate());

      $('#duoCancel').addEventListener('click', () => { $('#duoSheet').hidden = true; });
      $('#duoStart').addEventListener('click', () => {
        const rival = this.pendingRival || State.data.friends[0];
        $('#duoSheet').hidden = true;
        this.beginRun({ mode: 'duo', rival });
      });
    },

    renderHome() {
      const s = State.data;
      const weekly = Stats.weekly(s);
      const monthly = Stats.monthly(s);
      const isWeek = this.range === 'week';
      const current = isWeek ? weekly : monthly;
      const previous = isWeek ? Stats.weekly(s, 1) : Stats.monthly(s, 1);

      $$('[data-range]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.range === this.range)));
      $$('[data-unit]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.unit === Units.system)));

      $('#volumeValue').textContent = Units.distText(current.distance);
      $('#volumeUnit').textContent = Units.distLabel();
      $('#volumeLabel').textContent = isWeek ? 'This week' : 'This month';

      const diff = current.distance - previous.distance;
      const deltaNode = $('#volumeDelta');
      const up = diff >= 0;
      deltaNode.className = 'delta ' + (up ? 'delta--up' : 'delta--down');
      deltaNode.textContent = `${up ? '▲' : '▼'} ${Units.distText(Math.abs(diff))} ${Units.distLabel()} vs last ${isWeek ? 'week' : 'month'} · ${current.runs} ${current.runs === 1 ? 'run' : 'runs'}`;

      // Sparkline
      const buckets = isWeek ? Stats.weekDays(s) : Stats.monthBuckets(s);
      const peak = Math.max.apply(null, buckets.concat([1]));
      const spark = $('#volumeSpark');
      spark.innerHTML = '';
      buckets.forEach((v, i) => {
        const bar = el('i', { style: `height:${clamp((v / peak) * 100, 4, 100)}%` });
        const todayIndex = isWeek ? (new Date().getDay() + 6) % 7 : buckets.length - 1;
        if (i === todayIndex) bar.setAttribute('data-today', 'true');
        spark.appendChild(bar);
      });

      // Intensity tier
      const t = Stats.tier(s);
      $('#tierName').textContent = t.tier.name;
      $('#tierCaption').textContent = `Intensity · ${Units.distText(t.week)} ${Units.distLabel()} in the last 7 days`;
      $('#tierNext').textContent = t.next
        ? `${Units.distText(Math.max(0, t.next.from - t.week))} ${Units.distLabel()} to ${t.next.name}`
        : 'Maximum intensity';
      const span = t.next ? t.next.from - t.tier.from : 1;
      $('#tierBar').style.width = `${clamp(((t.week - t.tier.from) / span) * 100, 3, 100)}%`;

      // Streak & identity
      $('#streakValue').textContent = String(Stats.streak(s));
      $('#homeAvatar').textContent = s.profile.initials;

      // Rail tiles
      $('#railArea').textContent = Units.areaText(Stats.totalArea(s));
      $('#railAreaUnit').textContent = Units.areaLabel();
      const done = M.QUESTS.filter((q) => M.questView(s, q).complete).length;
      $('#railQuest').textContent = `${done}/${M.QUESTS.length}`;
      $('#railRank').textContent = Stats.rank(s).current.name;

      this.renderFriendBoard();
      this.renderHomeMap();
    },

    renderFriendBoard() {
      const s = State.data;
      const board = $('#friendBoard');
      board.innerHTML = '';
      const me = { name: 'You', initials: s.profile.initials, color: '#c8ff2e', weekly: Stats.weekly(s).distance, me: true };
      const rows = s.friends.concat([me]).sort((a, b) => b.weekly - a.weekly);
      const top = rows[0].weekly || 1;

      rows.forEach((r, i) => {
        board.appendChild(el('div', { class: 'row', style: 'gap:var(--s-3)' }, [
          el('span', { class: 'stat-label', style: 'width:14px', text: String(i + 1) }),
          el('span', { class: 'owner-swatch', style: `background:${r.color};width:8px;height:24px;border-radius:4px` }),
          el('div', { class: 'stack grow', style: 'gap:5px' }, [
            el('div', { class: 'row row--between' }, [
              el('span', { style: `font-size:13px;font-weight:${r.me ? 800 : 600};color:${r.me ? 'var(--accent)' : 'var(--text-hi)'}`, text: r.name }),
              el('span', { class: 'tiny', text: `${Units.distText(r.weekly)} ${Units.distLabel()}` }),
            ]),
            el('div', { class: 'bar' }, [el('i', { style: `width:${clamp((r.weekly / top) * 100, 3, 100)}%;background:${r.color}` })]),
          ]),
        ]));
      });
    },

    renderHomeMap() {
      const map = this.maps.home;
      const s = State.data;
      map.setAnchor(s.profile.home);
      map.layers.territories = s.territories.slice(0, 6);
      map.layers.route = s.activities.length ? s.activities[0].route : [];
      map.layers.me = s.profile.home;
      map.layers.rivals = [];
      map.setCenter(s.profile.home);
      map.mpp = 3.6;                     // ~1.2 km across: plots read as shapes
      map.invalidate();
    },

    locate() {
      if (!navigator.geolocation) {
        this.toast('Location is not available in this browser');
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const home = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          State.setHome(home);
          Object.values(this.maps).forEach((m) => { m.setAnchor(home); m.setCenter(home); });
          $('#geoNote').textContent = 'Live GPS';
          $('#geoStatus').textContent = 'Granted — using live GPS';
          this.renderHomeMap();
          this.toast('Centred on your <b>real location</b>');
        },
        () => {
          $('#geoStatus').textContent = 'Denied — running on simulated location';
          this.toast('Location denied — staying on the simulated map');
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    },

    /* --- Duo lobby --------------------------------------------------------- */

    openDuoSheet() {
      const picker = $('#friendPicker');
      picker.innerHTML = '';
      this.pendingRival = State.data.friends[0];

      State.data.friends.forEach((f) => {
        const btn = el('button', {
          class: 'friend', type: 'button',
          'aria-pressed': String(f.id === this.pendingRival.id),
        }, [
          el('span', { class: 'friend-avatar', style: `background:${f.color}`, text: f.initials }),
          el('div', { class: 'stack grow', style: 'gap:3px' }, [
            el('span', { style: 'font-weight:700;font-size:14px', text: f.name }),
            el('span', { class: 'tiny', text: `${Units.distText(f.weekly)} ${Units.distLabel()} this week` }),
          ]),
          el('span', { class: 'chip' + (f.online ? ' chip--live' : ''), text: f.online ? 'Online' : 'Offline' }),
        ]);
        btn.addEventListener('click', () => {
          this.pendingRival = f;
          $$('#friendPicker .friend').forEach((b) => b.setAttribute('aria-pressed', 'false'));
          btn.setAttribute('aria-pressed', 'true');
        });
        picker.appendChild(btn);
      });

      $('#duoSheet').hidden = false;
    },

    /* --- Run --------------------------------------------------------------- */

    bindRun() {
      $('#pauseBtn').addEventListener('click', () => {
        Tracker.pause();
        $('#pauseBtn').textContent = Tracker.state && Tracker.state.paused ? 'Resume' : 'Pause';
      });

      $('#finishBtn').addEventListener('click', () => this.finishRun());

      Bus.on('run:tick', (run) => this.renderRun(run));
      Bus.on('run:position', () => this.renderRunMap());
      Bus.on('live:peers', () => { this.renderVersus(); this.renderRunMap(); });
      Bus.on('live:joined', (peer) => this.toast(`<b>${peer.name}</b> joined the duel — live`, null));
      Bus.on('run:captured', (run) => {
        const area = `${Units.areaText(run.closure.area)} ${Units.areaLabel()}`;
        $('#loopHint').hidden = false;
        $('#loopHintText').textContent = `Loop captured · ${area} — finish whenever you like`;
        this.toast(`Loop captured — <b>${area}</b> of land is yours on finish`);
      });
      // The hint stays put once a loop is captured; leaving the start again
      // only means the next, larger loop is still open.
      Bus.on('run:loop', (run) => { if (!run.closure) $('#loopHint').hidden = !run.loopReady; });
      Bus.on('run:split', (run) => {
        const last = run.splits[run.splits.length - 1];
        this.toast(`Split ${last.km} — <b>${clock(last.seconds)}</b>`);
      });
    },

    beginRun(options) {
      const run = Tracker.start(options);
      this.go('run');

      $('#runModeChip').textContent = options.mode === 'duo' ? 'DUO' : 'SOLO';
      $('#runLiveChip').hidden = options.mode !== 'duo';
      $('#versus').hidden = options.mode !== 'duo';
      $('#pauseBtn').textContent = 'Pause';
      $('#loopHint').hidden = true;
      if (options.rival) $('#versusName').textContent = 'vs ' + options.rival.name;

      this.maps.run.setAnchor(State.data.profile.home);
      this.maps.run.mpp = 0.9;
      this.renderRun(run);
      this.renderRunMap();
    },

    renderRun(run) {
      if (!run) return;
      $('#runDistance').textContent = Units.distText(run.distance);
      $('#runDistanceUnit').textContent = Units.isMetric() ? 'kilometres' : 'miles';
      $('#runTime').textContent = clock(run.duration);
      $('#runPace').textContent = Units.paceText(run.currentPace);
      $('#runPaceLabel').textContent = 'Pace ' + Units.paceLabel();
      $('#runSourceChip').textContent = run.source === 'gps' ? 'GPS' : 'SIM';

      const back = run.route.length > 1 ? Geo.distance(run.route[0], run.route[run.route.length - 1]) : 0;
      $('#runLoop').textContent = run.closure
        ? `${Units.areaText(run.closure.area)}`
        : `${Math.round(back)} m`;
      $('#runLoopLabel').textContent = run.closure ? `${Units.areaLabel()} captured` : 'To start';
      $('#runLoop').style.color = run.closure ? 'var(--violet)' : '';

      if (run.mode === 'duo') this.renderVersus(run);
    },

    renderVersus(run) {
      const state = run || Tracker.state;
      if (!state || state.mode !== 'duo') return;
      const rival = Live.list()[0];
      if (!rival) return;

      const mine = state.distance;
      const theirs = rival.distance || 0;
      const gap = mine - theirs;
      const gapNode = $('#versusGap');
      gapNode.setAttribute('data-lead', gap >= 0 ? 'me' : 'rival');
      gapNode.textContent = `${gap >= 0 ? '+' : '−'}${Math.abs(Math.round(gap))} m`;

      // The track shows the gap, not the absolute distance: over a 5 km race
      // two runners 80 m apart would otherwise sit on top of each other.
      const WINDOW = 300;                                  // metres, full deflection
      const offset = clamp(gap / WINDOW, -1, 1) * 40;
      $('#trackMe').style.left = `${50 + offset}%`;
      $('#trackRival').style.left = `${50 - offset}%`;
      $('#trackRival').textContent = (rival.initials || 'RV').slice(0, 2);
      const rivalName = rival.name && rival.name !== State.data.profile.name
        ? rival.name
        : `${rival.name || 'Rival'} (rival)`;
      $('#versusName').textContent = 'vs ' + rivalName;
      $('#versusMine').textContent = `You — ${Units.distText(mine)} ${Units.distLabel()}`;
      $('#versusTheirs').textContent = `${rivalName} — ${Units.distText(theirs)} ${Units.distLabel()}`;
    },

    renderRunMap() {
      const run = Tracker.state;
      if (!run) return;
      const map = this.maps.run;
      map.layers.route = run.route;
      map.layers.territories = State.data.territories.slice(0, 8);
      map.layers.me = run.route[run.route.length - 1] || State.data.profile.home;
      map.layers.rivals = Live.list().filter((p) => p.position);
      map.layers.ghost = [];

      // Keep the runner and the start pin both in view.
      map.fit([run.route.slice(-260), [run.route[0] || map.layers.me]]);
      map.invalidate();
    },

    finishRun() {
      const activity = Tracker.stop();
      if (!activity) return;

      if (activity.distance < 60) {
        this.toast('Too short to save — nothing recorded');
        this.go('home');
        return;
      }

      const result = State.addActivity(activity);
      this.lastActivity = activity;
      this.showFinish(activity, result);
    },

    /* --- Finish ------------------------------------------------------------ */

    bindFinish() {
      $('#doneBtn').addEventListener('click', () => this.go('home'));
      $('#saveCardBtn').addEventListener('click', () => {
        M.downloadCard($('#cardCanvas'), `miles-${new Date(this.lastActivity.startedAt).toISOString().slice(0, 10)}.png`);
        this.toast('Record card saved as <b>PNG</b>');
      });
    },

    showFinish(activity, result) {
      this.go('finish');
      $('#finishTitle').textContent = activity.title;
      M.renderCard($('#cardCanvas'), activity, {
        athlete: State.data.profile.name,
        rank: Stats.rank(State.data).current.name,
      });

      const extras = $('#finishExtras');
      extras.innerHTML = '';

      if (result.territory) {
        extras.appendChild(el('div', { class: 'card stack' }, [
          el('span', { class: 'card-title', text: 'Territory claimed' }),
          el('div', { class: 'row' }, [
            el('div', { class: 'stack grow', style: 'gap:2px' }, [
              el('span', { class: 'stat-value', style: 'font-size:26px;color:var(--violet)', text: `${Units.areaText(result.territory.area)} ${Units.areaLabel()}` }),
              el('span', { class: 'tiny', text: 'Enclosed by your loop and added to your land' }),
            ]),
          ]),
        ]));
      }

      if (activity.mode === 'duo' && activity.rival) {
        extras.appendChild(el('div', { class: 'card stack' }, [
          el('span', { class: 'card-title', text: 'Duel result' }),
          el('div', { class: 'row row--between' }, [
            el('span', { style: `font-weight:800;font-size:18px;color:${activity.won ? 'var(--ok)' : 'var(--bad)'}`, text: activity.won ? `You beat ${activity.rival}` : `${activity.rival} took it` }),
            el('span', { class: 'tiny', text: activity.rivalDistance !== null ? `${Units.distText(activity.rivalDistance)} ${Units.distLabel()}` : '' }),
          ]),
        ]));
      }

      if (result.unlocked.length) {
        extras.appendChild(el('div', { class: 'card stack' }, [
          el('span', { class: 'card-title', text: 'Quests completed' }),
          el('div', { class: 'stack' }, result.unlocked.map((q) => el('div', { class: 'row' }, [
            el('span', { class: 'quest-icon', text: q.icon }),
            el('div', { class: 'stack grow', style: 'gap:2px' }, [
              el('span', { style: 'font-weight:700;font-size:14px', text: q.name }),
              el('span', { class: 'tiny', text: q.note }),
            ]),
            el('span', { class: 'quest-xp', text: `+${q.xp} XP` }),
          ]))),
        ]));
        result.unlocked.forEach((q) => this.toast(`Quest complete — <b>${q.name}</b> +${q.xp} XP`, 'reward'));
      }

      if (activity.splits.length) {
        extras.appendChild(el('div', { class: 'card stack' }, [
          el('span', { class: 'card-title', text: 'Splits' }),
          el('div', { class: 'stack', style: 'gap:6px' }, activity.splits.map((sp) => el('div', { class: 'row row--between' }, [
            el('span', { class: 'tiny', text: `KM ${sp.km}` }),
            el('span', { class: 'stat-value', style: 'font-size:13px', text: clock(sp.seconds) }),
          ]))),
        ]));
      }
    },

    /* --- Territory ---------------------------------------------------------- */

    renderTerritory() {
      const s = State.data;
      const total = Stats.totalArea(s);

      $('#terrTotal').textContent = Units.areaText(total);
      $('#terrTotalUnit').textContent = Units.areaLabel() + ' held';
      $('#terrCount').textContent = String(s.territories.length);
      $('#territoryRankChip').textContent = Stats.rank(s).current.name;

      // Map: my land plus the neighbours' claims.
      const rivalLand = this.rivalTerritories();
      const map = this.maps.territory;
      map.setAnchor(s.profile.home);
      map.layers.territories = s.territories.concat(rivalLand);
      map.layers.route = [];
      map.layers.me = s.profile.home;
      map.layers.rivals = [];
      const all = map.layers.territories.map((t) => t.polygon);
      if (all.length) map.fit(all.concat([[s.profile.home]]));
      map.invalidate();

      // Standings
      const board = $('#terrBoard');
      board.innerHTML = '';
      const rows = [{ name: 'You', color: '#8b5cf6', area: total, me: true }].concat(
        s.friends.map((f) => ({
          name: f.name,
          color: f.color,
          area: rivalLand.filter((t) => t.owner === f.id).reduce((a, t) => a + t.area, 0),
        }))
      ).sort((a, b) => b.area - a.area);

      rows.forEach((r, i) => {
        board.appendChild(el('div', { class: 'owner-row' }, [
          el('span', { class: 'stat-label', style: 'width:14px', text: String(i + 1) }),
          el('span', { class: 'owner-swatch', style: `background:${r.color}` }),
          el('span', { class: 'grow truncate', style: `font-size:13px;font-weight:${r.me ? 800 : 600};color:${r.me ? 'var(--violet)' : 'var(--text-hi)'}`, text: r.name }),
          el('span', { class: 'stat-value', style: 'font-size:13px', text: `${Units.areaText(r.area)} ${Units.areaLabel()}` }),
        ]));
      });

      // Plots
      const list = $('#terrList');
      list.innerHTML = '';
      if (!s.territories.length) {
        list.appendChild(el('div', { class: 'empty', text: 'No land yet. Run a loop back to your starting point and everything inside becomes yours.' }));
        return;
      }
      s.territories.forEach((t) => {
        const canvas = el('canvas');
        const row = el('div', { class: 'plot' }, [
          canvas,
          el('div', { class: 'stack grow', style: 'gap:3px' }, [
            el('span', { style: 'font-weight:700;font-size:14px', text: `${Units.areaText(t.area)} ${Units.areaLabel()}` }),
            el('span', { class: 'tiny', text: relTime(t.claimedAt) }),
          ]),
          el('span', { class: 'chip', text: 'Held' }),
        ]);
        list.appendChild(row);
        requestAnimationFrame(() => M.drawRouteThumb(canvas, t.polygon, {
          stroke: '#8b5cf6', fill: 'rgba(139,92,246,0.28)', pad: 6, width: 1.8,
        }));
      });
    },

    /** Neighbours' claims: stable per friend, so the map never reshuffles. */
    rivalTerritories() {
      if (this._rivalLand) return this._rivalLand;
      const home = State.data.profile.home;
      const land = [];
      State.data.friends.forEach((f, idx) => {
        const rand = M.rng(1000 + idx * 77);
        // Sized like real running loops so the standings are an actual
        // contest rather than a walkover.
        const count = 2 + Math.floor(rand() * 2);
        for (let c = 0; c < count; c++) {
          const cx = (rand() - 0.5) * 2600;
          const cy = (rand() - 0.5) * 2600;
          const radius = 260 + rand() * 320;
          const centre = Geo.offset(home, cx, cy);
          const polygon = [];
          for (let i = 0; i < 16; i++) {
            const t = (i / 16) * Math.PI * 2;
            const r = radius * (0.75 + Math.sin(t * 3 + idx) * 0.2);
            polygon.push(Geo.offset(centre, Math.cos(t) * r, Math.sin(t) * r));
          }
          land.push({
            id: `${f.id}-${c}`, owner: f.id, color: f.color,
            polygon, area: Geo.polygonArea(polygon), claimedAt: Date.now() - rand() * 6e8,
          });
        }
      });
      this._rivalLand = land;
      return land;
    },

    /* --- Quests ------------------------------------------------------------- */

    renderQuests() {
      const s = State.data;
      const rank = Stats.rank(s);

      $('#rankBadge').textContent = rank.current.badge;
      $('#rankName').textContent = rank.current.name;
      $('#rankNext').textContent = rank.next
        ? `${rank.next.xp - rank.xp} XP to ${rank.next.name} · ${rank.xp} XP earned`
        : `Top rank reached · ${rank.xp} XP`;
      $('#rankBar').style.width = `${clamp(rank.progress * 100, 3, 100)}%`;

      const list = $('#questList');
      list.innerHTML = '';
      const views = M.QUESTS.map((q) => M.questView(s, q))
        .sort((a, b) => (a.complete === b.complete ? b.ratio - a.ratio : a.complete ? 1 : -1));

      views.forEach((v) => {
        const shown = v.format === 'dist'
          ? `${Units.distText(v.have)} / ${Units.distText(v.need)} ${Units.distLabel()}`
          : v.format === 'area'
            ? `${Units.areaText(v.have)} / ${Units.areaText(v.need)} ${Units.areaLabel()}`
            : `${Math.min(Math.floor(v.have), v.need)} / ${v.need}`;

        list.appendChild(el('div', { class: 'quest', 'data-done': String(v.complete) }, [
          el('span', { class: 'quest-icon', text: v.quest.icon }),
          el('div', { class: 'stack grow', style: 'gap:6px' }, [
            el('div', { class: 'row row--between' }, [
              el('span', { class: 'quest-name', text: v.quest.name }),
              el('span', { class: 'quest-xp', text: v.complete ? `+${v.quest.xp} XP` : `${v.quest.xp} XP` }),
            ]),
            el('span', { class: 'tiny', text: v.quest.note }),
            el('div', { class: 'bar' }, [el('i', { style: `width:${clamp(v.ratio * 100, 2, 100)}%` })]),
            el('span', { class: 'tiny', text: v.complete ? 'Completed' : shown }),
          ]),
        ]));
      });
    },

    /* --- Feed ---------------------------------------------------------------- */

    renderFeed() {
      const s = State.data;
      const list = $('#feedList');
      list.innerHTML = '';

      const mine = s.activities.map((a) => ({
        activity: a, who: s.profile.name, initials: s.profile.initials, color: '#c8ff2e', me: true,
      }));
      const theirs = this.friendActivities();
      const items = mine.concat(theirs).sort((a, b) => b.activity.startedAt - a.activity.startedAt).slice(0, 14);

      if (!items.length) {
        list.appendChild(el('div', { class: 'empty', text: 'No activity yet — start a run.' }));
        return;
      }

      items.forEach((item) => {
        const a = item.activity;
        const canvas = el('canvas');
        const card = el('article', { class: 'feed-card' }, [
          el('div', { class: 'feed-head' }, [
            el('span', { class: 'friend-avatar', style: `background:${item.color}`, text: item.initials }),
            el('div', { class: 'stack grow', style: 'gap:2px' }, [
              el('span', { style: 'font-weight:700;font-size:14px', text: item.who }),
              el('span', { class: 'tiny', text: `${a.title} · ${relTime(a.startedAt)}` }),
            ]),
            a.mode === 'duo'
              ? el('span', { class: 'chip', style: 'border-color:rgba(255,61,139,.45);color:#ff8ab6', text: a.won ? 'WON' : 'DUO' })
              : el('span', { class: 'chip', text: 'SOLO' }),
          ]),
          el('div', { class: 'feed-body' }, [
            canvas,
            el('div', { class: 'feed-stats' }, [
              stat(`${Units.distText(a.distance)} ${Units.distLabel()}`, 'Distance'),
              stat(clock(a.duration), 'Time'),
              stat(`${Units.paceText(a.duration / Math.max(1, a.distance))}`, 'Pace ' + Units.paceLabel()),
              stat(a.claimedArea ? `${Units.areaText(a.claimedArea)} ${Units.areaLabel()}` : '—', 'Territory'),
            ]),
          ]),
          el('div', { class: 'feed-foot' }, [
            el('button', { class: 'chip', type: 'button', text: '👏 Kudos', onclick: () => this.toast('Kudos sent to <b>' + item.who + '</b>') }),
            el('button', {
              class: 'chip', type: 'button', text: 'Card ↗',
              onclick: () => { this.lastActivity = a; this.showCardPreview(a, item); },
            }),
          ]),
        ]);
        list.appendChild(card);
        requestAnimationFrame(() => M.drawRouteThumb(canvas, a.route, {
          stroke: item.me ? '#c8ff2e' : item.color,
          fill: a.claimedArea ? 'rgba(139,92,246,0.25)' : null,
          pad: 10, width: 2.4,
        }));
      });

      function stat(value, label) {
        return el('div', { class: 'stack', style: 'gap:2px' }, [
          el('span', { class: 'stat-value', style: 'font-size:16px', text: value }),
          el('span', { class: 'stat-label', text: label }),
        ]);
      }
    },

    showCardPreview(activity, item) {
      this.go('finish');
      $('#finishTitle').textContent = activity.title;
      M.renderCard($('#cardCanvas'), activity, {
        athlete: item ? item.who : State.data.profile.name,
        rank: Stats.rank(State.data).current.name,
      });
      $('#finishExtras').innerHTML = '';
    },

    /** Friends' runs, generated once per session so the feed feels populated. */
    friendActivities() {
      if (this._friendFeed) return this._friendFeed;
      const home = State.data.profile.home;
      const out = [];
      State.data.friends.forEach((f, idx) => {
        const rand = M.rng(4200 + idx * 31);
        const runs = 1 + Math.floor(rand() * 2);
        for (let i = 0; i < runs; i++) {
          const loop = rand() > 0.45;
          const distance = 4000 + rand() * 9000;
          const paceSec = 280 + rand() * 110;
          const centre = Geo.offset(home, (rand() - 0.5) * 1600, (rand() - 0.5) * 1600);
          const route = [];
          const radius = distance / (2 * Math.PI) * 0.85;
          const steps = 40;
          for (let k = 0; k <= steps; k++) {
            const t = (k / steps) * Math.PI * 2 * (loop ? 1 : 0.5);
            const r = radius * (1 + Math.sin(t * 3 + idx) * 0.16);
            route.push(Geo.offset(centre, Math.cos(t) * r, Math.sin(t) * r));
          }
          const area = loop ? Geo.polygonArea(route) : 0;
          out.push({
            who: f.name, initials: f.initials, color: f.color, me: false,
            activity: {
              id: `f-${f.id}-${i}`,
              startedAt: Date.now() - (rand() * 4 + i) * 864e5,
              mode: rand() > 0.5 ? 'duo' : 'solo',
              won: rand() > 0.5,
              rival: 'You',
              title: loop ? 'Territory Loop' : 'Tempo Run',
              distance,
              duration: (distance / 1000) * paceSec,
              elevation: Math.round(rand() * 120),
              route,
              splits: [],
              loopClosed: loop,
              claimedArea: area,
            },
          });
        }
      });
      this._friendFeed = out;
      return out;
    },

    /* --- Profile ------------------------------------------------------------- */

    bindProfile() {
      $$('#demoSpeedSeg button').forEach((btn) => {
        btn.addEventListener('click', () => {
          Tracker.demoSpeed = Number(btn.dataset.speed);
          $$('#demoSpeedSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
          this.toast(`Simulated runs now play at <b>${btn.dataset.speed}×</b>`);
        });
      });

      $('#askGeoBtn').addEventListener('click', () => this.locate());

      $('#nameBtn').addEventListener('click', () => {
        const next = window.prompt('What should other runners call you?', State.data.profile.name);
        if (!next || !next.trim()) return;
        State.setProfileName(next.trim());
        this.toast(`You are now <b>${State.data.profile.name}</b>`);
      });

      $('#resetBtn').addEventListener('click', () => {
        if (!window.confirm('Delete every run, territory and quest on this device?')) return;
        this._rivalLand = null;
        this._friendFeed = null;
        State.reset();
        this.go('home');
        this.toast('MILES has been reset');
      });
    },

    renderProfile() {
      const s = State.data;
      const all = Stats.since(s, 0);
      $('#profileAvatar').textContent = s.profile.initials;
      $('#profileName').textContent = s.profile.name;
      $('#profileHandle').textContent = s.profile.handle;
      $('#profileRank').textContent = Stats.rank(s).current.name;
      $('#nameBtn').textContent = s.profile.name;
      $('#kpiDistance').textContent = Units.distText(all.distance, 0);
      $('#kpiDistanceUnit').textContent = Units.distLabel() + ' total';
      $('#kpiRuns').textContent = String(all.runs);
      $('#kpiArea').textContent = Units.areaText(Stats.totalArea(s));
      $('#kpiAreaUnit').textContent = Units.areaLabel() + ' land';
    },
  };

  M.UI = UI;
})(window.MILES);
