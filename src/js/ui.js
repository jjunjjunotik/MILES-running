/* ==========================================================================
   MILES · ui
   Screen rendering and event wiring. Every render reads from State, so any
   change — a finished run, a unit switch — repaints the whole app coherently.
   ========================================================================== */

(function (M) {
  'use strict';

  const { $, $$, el, State, Stats, Units, Geo, Bus, Tracker, Live, clamp, clock, relTime } = M;

  const TAB_SCREENS = ['home', 'crew', 'territory', 'quests', 'feed', 'profile'];

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
      this.bindCrew();

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
      if (tab === 'crew') this.renderCrew();
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
      if (this.tab === 'crew') this.renderCrew();
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

      $('#homeAvatar').addEventListener('click', () => this.go('profile'));
      $('#startSolo').addEventListener('click', () => { $('#soloSheet').hidden = false; });
      $('#startDuo').addEventListener('click', () => this.openRaceLobby());
      $('#locateBtn').addEventListener('click', () => this.locate());

      $$('#soloSheet [data-kind]').forEach((btn) => {
        btn.addEventListener('click', () => {
          $('#soloSheet').hidden = true;
          this.beginRun({ kind: btn.dataset.kind });
        });
      });
      $('#soloSheet').addEventListener('click', (event) => {
        if (event.target === $('#soloSheet')) $('#soloSheet').hidden = true;
      });

      $$('#racePicker button').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.raceTarget = Number(btn.dataset.distance);
          $$('#racePicker button').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
        });
      });

      $('#lobbyAddFriend').addEventListener('click', () => { if (this.promptFriend()) this.renderFriendPicker(); });
      $('#duoCancel').addEventListener('click', () => { $('#duoSheet').hidden = true; });
      $('#duoStart').addEventListener('click', () => {
        if (!this.pendingRivals.length) {
          this.toast('Pick at least one runner to race');
          return;
        }
        $('#duoSheet').hidden = true;
        this.beginRun({ kind: 'race', rivals: this.pendingRivals.slice(), target: this.raceTarget });
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

    openRaceLobby() {
      this.raceTarget = this.raceTarget || 5000;
      this.pendingRivals = State.data.friends.slice(0, 1);
      $$('#racePicker button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.distance) === this.raceTarget)));
      this.renderFriendPicker();
      $('#duoSheet').hidden = false;
    },

    renderFriendPicker() {
      const picker = $('#friendPicker');
      picker.innerHTML = '';

      State.data.friends.forEach((f) => {
        const picked = this.pendingRivals.some((r) => r.id === f.id);
        const btn = el('button', { class: 'friend', type: 'button', 'aria-pressed': String(picked) }, [
          el('span', { class: 'friend-avatar', style: `background:${f.color}`, text: f.initials }),
          el('div', { class: 'stack grow', style: 'gap:3px' }, [
            el('span', { style: 'font-weight:700;font-size:14px', text: f.name }),
            el('span', { class: 'tiny', text: `${Units.paceText(f.pace / 1000)} ${Units.paceLabel()} · ${Units.distText(f.weekly)} ${Units.distLabel()} this week` }),
          ]),
          el('span', { class: 'chip' + (f.online ? ' chip--live' : ''), text: f.online ? 'Online' : 'Bot' }),
        ]);

        btn.addEventListener('click', () => {
          const at = this.pendingRivals.findIndex((r) => r.id === f.id);
          if (at >= 0) {
            this.pendingRivals.splice(at, 1);
          } else if (this.pendingRivals.length >= M.MAX_RIVALS) {
            this.toast(`A race holds you and <b>${M.MAX_RIVALS}</b> others — drop someone first`);
            return;
          } else {
            this.pendingRivals.push(f);
          }
          this.renderFriendPicker();
        });
        picker.appendChild(btn);
      });

      $('#raceCount').textContent = `${this.pendingRivals.length} of ${M.MAX_RIVALS} picked`;
    },

    /** Shared by the lobby and the profile: one prompt, one new friend. */
    promptFriend() {
      const name = window.prompt('Who are you adding?');
      if (name === null) return null;
      const friend = State.addFriend(name);
      if (!friend) {
        this.toast(name.trim() ? 'You already have a friend by that name' : 'That needs a name');
        return null;
      }
      this.toast(`<b>${friend.name}</b> can now line up with you`);
      return friend;
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
      Bus.on('live:peers', () => { this.renderRaceBoard(); this.renderRunMap(); });
      Bus.on('live:joined', (peer) => this.toast(`<b>${peer.name}</b> joined the race — live`, null));
      Bus.on('live:finished', (bot) => this.toast(`<b>${bot.name}</b> crossed the line`));
      // Crossing your own finish line ends the race for you.
      Bus.on('run:finished', () => this.finishRun());
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
      const kind = M.KINDS[options.kind] || M.KINDS.free;
      const run = Tracker.start(options);
      this.go('run');

      $('#runModeChip').textContent = kind.badge;
      $('#runModeChip').style.color = kind.accent;
      $('#runLiveChip').hidden = options.kind !== 'race';
      $('#raceBoard').hidden = options.kind !== 'race';
      $('#pauseBtn').textContent = 'Pause';
      $('#loopHint').hidden = true;
      $('#finishBtn').textContent = options.kind === 'race' ? 'Give up' : 'Finish';

      if (options.kind === 'race') {
        $('#raceTarget').textContent = `${Units.distText(run.target)} ${Units.distLabel()}`;
      }

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

      // The third cell answers the question the current run kind is asking.
      if (run.kind === 'race') {
        const left = Math.max(0, run.target - run.distance);
        $('#runLoop').textContent = Units.distText(left);
        $('#runLoopLabel').textContent = `${Units.distLabel()} to go`;
        $('#runLoop').style.color = left === 0 ? 'var(--ok)' : '';
        this.renderRaceBoard(run);
      } else if (run.kind === 'territory') {
        const back = run.route.length > 1 ? Geo.distance(run.route[0], run.route[run.route.length - 1]) : 0;
        $('#runLoop').textContent = run.closure ? Units.areaText(run.closure.area) : `${Math.round(back)} m`;
        $('#runLoopLabel').textContent = run.closure ? `${Units.areaLabel()} captured` : 'To start';
        $('#runLoop').style.color = run.closure ? 'var(--violet)' : '';
      } else {
        $('#runLoop').textContent = String(Math.round(run.elevation));
        $('#runLoopLabel').textContent = 'Elev m';
        $('#runLoop').style.color = '';
      }
    },

    /** The live standings: everyone, ordered, against the same distance. */
    renderRaceBoard(run) {
      const state = run || Tracker.state;
      if (!state || state.kind !== 'race') return;

      const target = state.target;
      const field = Live.list().map((p) => ({
        name: p.name, initials: p.initials, color: p.color, me: false,
        distance: Math.min(p.distance, target),
        finishedAt: p.finishedAt === undefined ? null : p.finishedAt,
      }));

      field.push({
        name: 'You', initials: State.data.profile.initials, color: '#c8ff2e', me: true,
        distance: Math.min(state.distance, target),
        finishedAt: state.finishedAt,
      });

      // Finishers first by their time on the line, then whoever is furthest.
      field.sort((a, b) => {
        if (a.finishedAt !== null && b.finishedAt !== null) return a.finishedAt - b.finishedAt;
        if (a.finishedAt !== null) return -1;
        if (b.finishedAt !== null) return 1;
        return b.distance - a.distance;
      });

      const myPlace = field.findIndex((e) => e.me) + 1;
      const place = $('#racePlace');
      place.textContent = M.ordinal(myPlace);
      place.setAttribute('data-lead', String(myPlace === 1));

      const rows = $('#raceRows');
      rows.innerHTML = '';
      field.forEach((entry, i) => {
        const done = entry.finishedAt !== null;
        rows.appendChild(el('div', { class: 'race-row', 'data-me': String(entry.me), 'data-done': String(done) }, [
          el('span', { class: 'race-pos', text: String(i + 1) }),
          el('span', { class: 'race-dot', style: `background:${entry.color}`, text: (entry.initials || '?').slice(0, 2) }),
          el('div', {}, [
            el('span', { class: 'race-name', text: entry.name }),
            el('span', { class: 'race-track' }, [
              el('i', { style: `width:${clamp((entry.distance / target) * 100, 2, 100)}%;background:${entry.color}` }),
            ]),
          ]),
          el('span', {
            class: 'race-time',
            text: done ? clock(entry.finishedAt) : `${Units.distText(entry.distance)} ${Units.distLabel()}`,
          }),
        ]));
      });
    },

    renderRunMap() {
      const run = Tracker.state;
      if (!run) return;
      const map = this.maps.run;
      map.layers.route = run.route;
      // Land is only relevant to the run that is taking it; on a race or a
      // free run it just floods the map when you happen to start inside a plot.
      map.layers.territories = run.kind === 'territory' ? State.data.territories.slice(0, 8) : [];
      map.layers.me = run.route[run.route.length - 1] || State.data.profile.home;
      map.layers.rivals = Live.list().filter((p) => p.position);
      map.layers.ghost = [];

      // Keep the runner and the start pin both in view.
      map.fit([run.route.slice(-260), [run.route[0] || map.layers.me]]);
      // The first few strides would otherwise zoom to a couple of metres per
      // pixel of empty street.
      map.mpp = Math.max(map.mpp, 0.7);
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
      this.cardReturn = null;
      this.showFinish(activity, result);
    },

    /* --- Finish ------------------------------------------------------------ */

    bindFinish() {
      $('#doneBtn').addEventListener('click', () => {
        // A card opened from your history or the feed returns there; one
        // finished at the end of a run goes home.
        const back = this.cardReturn || 'home';
        this.cardReturn = null;
        this.go(back);
      });
      $('#saveCardBtn').addEventListener('click', () => {
        // downloadCard reports whether it actually started a download; the
        // fallback paths report their own outcome, so don't claim success.
        const saved = M.downloadCard($('#cardCanvas'), `miles-${new Date(this.lastActivity.startedAt).toISOString().slice(0, 10)}.png`);
        if (saved) this.toast('Record card saved as <b>PNG</b>');
      });
    },

    showFinish(activity, result) {
      this.go('finish');
      $('#finishTitle').textContent = activity.title;
      $('#finishEyebrow').textContent = 'Run complete';
      $('#doneBtn').textContent = 'Done';
      M.renderCard($('#cardCanvas'), activity, {
        athlete: State.data.profile.name,
        rank: Stats.rank(State.data).current.name,
        totalArea: Stats.totalArea(State.data),
      });

      const extras = $('#finishExtras');
      extras.innerHTML = '';

      if (activity.kind === 'race' && activity.results) {
        extras.appendChild(el('div', { class: 'card stack' }, [
          el('span', { class: 'card-title', text: `Result · ${Units.distText(activity.target)} ${Units.distLabel()}` }),
          el('div', { class: 'stack', style: 'gap:9px' }, activity.results.map((r) => el('div', { class: 'race-row', 'data-me': String(r.me), 'data-done': String(r.finishedAt !== null) }, [
            el('span', { class: 'race-pos', text: String(r.place) }),
            el('span', { class: 'race-dot', style: `background:${r.color}`, text: (r.initials || '?').slice(0, 2) }),
            el('span', { class: 'race-name', text: r.name }),
            el('span', {
              class: 'race-time',
              text: r.finishedAt !== null ? clock(r.finishedAt) : `${Units.distText(r.distance)} ${Units.distLabel()}`,
            }),
          ]))),
        ]));
      }

      if (activity.kind === 'territory' && !result.territory) {
        extras.appendChild(el('div', { class: 'card stack' }, [
          el('span', { class: 'card-title', text: 'No land taken' }),
          el('span', { class: 'tiny', text: 'The loop never closed — finish within 30 m of where you started and everything inside is yours.' }),
        ]));
      }

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


    /* --- Crew ---------------------------------------------------------------
       A crew is a club with a home turf. Captains get the tools to run it. */

    bindCrew() {
      $('#createCrewBtn').addEventListener('click', () => this.openCreateCrew());
      $('#crewSheet').addEventListener('click', (event) => {
        if (event.target === $('#crewSheet')) $('#crewSheet').hidden = true;
      });
    },

    renderCrew() {
      const state = State.data;
      const mine = M.Crew.mine(state);
      const host = $('#myCrew');
      host.innerHTML = '';

      if (mine) {
        host.appendChild(this.crewHero(mine));
      } else {
        const pending = M.Crew.all(state).find((c) => c.pendingMe);
        host.appendChild(el('div', { class: 'card stack' }, [
          el('span', { class: 'card-title', text: pending ? 'Waiting on a captain' : 'No crew yet' }),
          el('p', {
            class: 'muted',
            text: pending
              ? `${pending.name} reviews every request. You will get in when their captain says so.`
              : 'Join one of the crews near you, or start your own and run it yourself.',
          }),
          el('button', {
            class: 'btn btn--primary btn--block', type: 'button', text: 'Start a crew',
            onclick: () => this.openCreateCrew(),
          }),
        ]));
      }

      const nearby = M.Crew.nearby(state);
      $('#nearbyCount').textContent = `${nearby.length} within 5 ${Units.distLabel()}`;
      const list = $('#nearbyCrews');
      list.innerHTML = '';
      nearby.forEach((crew) => {
        const card = el('button', { class: 'crew-card', type: 'button' }, [
          el('span', { class: 'crew-badge', style: `border-color:${crew.color}55`, text: crew.emoji }),
          el('div', { class: 'stack grow', style: 'gap:3px' }, [
            el('span', { style: 'font-weight:700;font-size:14px', text: crew.name }),
            el('span', { class: 'tiny truncate', text: crew.tagline }),
            el('span', { class: 'tiny', style: `color:${crew.color}`, text: `${M.Crew.memberCount(crew)} runners · ${Units.distText(M.Crew.weeklyVolume(crew))} ${Units.distLabel()} this week` }),
          ]),
          el('div', { class: 'stack', style: 'gap:4px;align-items:flex-end;flex:none' }, [
            el('span', { class: 'stat-value', style: 'font-size:14px', text: Units.distText(crew.distance) }),
            el('span', { class: 'stat-label', text: Units.distLabel() + ' away' }),
          ]),
        ]);
        card.addEventListener('click', () => this.openCrewSheet(crew.id));
        list.appendChild(card);
      });
    },

    crewHero(crew) {
      const isLeader = M.Crew.isLeader(crew);
      const band = M.Crew.paceBand(crew);
      return el('div', { class: 'crew-hero' }, [
        el('div', { class: 'row' }, [
          el('span', { class: 'crew-badge', style: `border-color:${crew.color}66`, text: crew.emoji }),
          el('div', { class: 'stack grow', style: 'gap:3px' }, [
            el('span', { class: 'crew-name', text: crew.name }),
            el('span', { class: 'tiny', text: crew.tagline }),
          ]),
          el('span', { class: 'role-tag', 'data-role': isLeader ? 'leader' : 'member', text: isLeader ? 'Captain' : 'Member' }),
        ]),
        el('div', { class: 'crew-stats' }, [
          statCell(String(M.Crew.memberCount(crew)), 'Runners'),
          statCell(Units.distText(M.Crew.weeklyVolume(crew)), Units.distLabel() + ' / week'),
          statCell(band ? Units.paceText(band[0] / 1000) : '—', 'Best pace'),
        ]),
        el('div', { class: 'row row--between' }, [
          el('span', { class: 'tiny', text: `Meets ${crew.schedule.day} · ${crew.schedule.time} · ${crew.schedule.spot}` }),
        ]),
        el('button', {
          class: 'btn btn--block' + (isLeader ? ' btn--primary' : ''), type: 'button',
          text: isLeader ? `Manage crew${crew.requests.length ? ` · ${crew.requests.length} waiting` : ''}` : 'Open crew',
          onclick: () => this.openCrewSheet(crew.id),
        }),
      ]);

      function statCell(value, label) {
        return el('div', { class: 'cell' }, [
          el('div', { class: 'stat-value', text: value }),
          el('div', { class: 'stat-label', text: label }),
        ]);
      }
    },

    openCreateCrew() {
      if (M.Crew.mine(State.data)) {
        this.toast('Leave your current crew first');
        return;
      }
      const body = $('#crewSheetBody');
      body.innerHTML = '';

      const name = el('input', { class: 'input', id: 'newCrewName', placeholder: 'Crew name', maxlength: '28' });
      const tagline = el('input', { class: 'input', id: 'newCrewTagline', placeholder: 'One line about the crew', maxlength: '60' });
      const spot = el('input', { class: 'input', id: 'newCrewSpot', placeholder: 'Where you meet' });
      const day = el('select', { class: 'input' });
      ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach((d) => day.appendChild(el('option', { value: d, text: d })));
      day.value = 'Sat';
      const time = el('input', { class: 'input', type: 'time', value: '08:00' });
      const emoji = el('select', { class: 'input' });
      ['🏃', '🔥', '⚡', '🌅', '⛰️', '🏴', '🌙', '🐺'].forEach((e) => emoji.appendChild(el('option', { value: e, text: e })));
      const open = el('select', { class: 'input' }, [
        el('option', { value: 'open', text: 'Anyone can join' }),
        el('option', { value: 'review', text: 'I approve each request' }),
      ]);

      body.appendChild(el('div', { class: 'stack' }, [
        el('h3', { style: 'font-size:20px', text: 'Start a crew' }),
        el('p', { class: 'muted', text: 'You will be its captain, which means the member list is yours to run.' }),
        el('label', { class: 'field-label', text: 'Name' }), name,
        el('label', { class: 'field-label', text: 'Tagline' }), tagline,
        el('div', { class: 'row', style: 'gap:var(--s-3)' }, [
          el('div', { class: 'stack grow', style: 'gap:6px' }, [el('label', { class: 'field-label', text: 'Icon' }), emoji]),
          el('div', { class: 'stack grow', style: 'gap:6px' }, [el('label', { class: 'field-label', text: 'Joining' }), open]),
        ]),
        el('label', { class: 'field-label', text: 'Regular run' }),
        el('div', { class: 'row', style: 'gap:var(--s-3)' }, [day, time]),
        spot,
        el('div', { class: 'row', style: 'gap:var(--s-3);margin-top:var(--s-3)' }, [
          el('button', { class: 'btn grow', type: 'button', text: 'Cancel', onclick: () => { $('#crewSheet').hidden = true; } }),
          el('button', {
            class: 'btn btn--primary grow', type: 'button', text: 'Found it',
            onclick: () => {
              const result = State.crewAction((state) => M.Crew.create(state, {
                name: name.value, tagline: tagline.value, emoji: emoji.value,
                day: day.value, time: time.value, spot: spot.value,
                openJoin: open.value === 'open',
              }));
              if (result.error) { this.toast(result.error); return; }
              $('#crewSheet').hidden = true;
              this.renderCrew();
              this.toast(`<b>${result.crew.name}</b> is yours — ${result.crew.requests.length} runners already asked to join`);
            },
          }),
        ]),
      ]));

      $('#crewSheet').hidden = false;
      setTimeout(() => name.focus(), 60);
    },

    openCrewSheet(crewId) {
      const crew = M.Crew.all(State.data).find((c) => c.id === crewId);
      if (!crew) return;
      this.activeCrew = crewId;
      const isLeader = M.Crew.isLeader(crew);
      const mine = M.Crew.mine(State.data);
      const isMember = !!mine && mine.id === crew.id;
      const body = $('#crewSheetBody');
      body.innerHTML = '';

      const parts = [
        el('div', { class: 'row' }, [
          el('span', { class: 'crew-badge', style: `border-color:${crew.color}66`, text: crew.emoji }),
          el('div', { class: 'stack grow', style: 'gap:3px' }, [
            el('span', { class: 'crew-name', text: crew.name }),
            el('span', { class: 'tiny', text: crew.tagline }),
          ]),
        ]),
        el('div', { class: 'crew-stats' }, [
          cell(String(M.Crew.memberCount(crew)), 'Runners'),
          cell(Units.distText(M.Crew.weeklyVolume(crew)), Units.distLabel() + ' / week'),
          isMember
            ? cell(new Date(crew.foundedAt).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }), 'Founded')
            : cell(Units.distText(crew.distance), Units.distLabel() + ' away'),
        ]),
        el('p', { class: 'tiny', text: `Meets ${crew.schedule.day} at ${crew.schedule.time} · ${crew.schedule.spot}` }),
      ];

      // Captain's desk: requests first, because they are the thing waiting.
      if (isLeader && crew.requests.length) {
        parts.push(el('span', { class: 'card-title', text: `Join requests · ${crew.requests.length}` }));
        crew.requests.forEach((person) => {
          parts.push(el('div', { class: 'request' }, [
            el('span', { class: 'friend-avatar', style: `background:${person.color}`, text: person.initials }),
            el('div', { class: 'stack grow', style: 'gap:2px' }, [
              el('span', { style: 'font-weight:700;font-size:14px', text: person.name }),
              el('span', { class: 'tiny', text: `${Units.distText(person.weekly)} ${Units.distLabel()} a week · asked ${relTime(person.at || Date.now())}` }),
            ]),
            el('button', {
              class: 'icon-btn icon-btn--ok', type: 'button', text: '✓', 'aria-label': 'Approve',
              onclick: () => {
                const r = State.crewAction((st) => M.Crew.approve(st, crew.id, person.id));
                if (r.error) { this.toast(r.error); return; }
                this.toast(`<b>${r.joiner.name}</b> is in`);
                this.openCrewSheet(crew.id);
                this.renderCrew();
              },
            }),
            el('button', {
              class: 'icon-btn icon-btn--no', type: 'button', text: '✕', 'aria-label': 'Decline',
              onclick: () => {
                State.crewAction((st) => M.Crew.decline(st, crew.id, person.id));
                this.openCrewSheet(crew.id);
                this.renderCrew();
              },
            }),
          ]));
        });
      }

      parts.push(el('span', { class: 'card-title', text: `Members · ${crew.members.length}` }));
      const roster = el('div', { class: 'stack', style: 'gap:0' });
      crew.members.slice().sort((a, b) => (a.role === 'leader' ? -1 : b.role === 'leader' ? 1 : b.weekly - a.weekly)).forEach((member) => {
        const isMe = member.id === 'me';
        const row = el('div', { class: 'member' }, [
          el('span', { class: 'friend-avatar', style: `background:${member.color}`, text: member.initials }),
          el('div', { class: 'stack grow', style: 'gap:2px' }, [
            el('span', {
              style: `font-weight:${isMe ? 800 : 600};font-size:14px;color:${isMe ? 'var(--accent)' : 'var(--text-hi)'}`,
              // Don't write "You (you)" when that is literally their name.
              text: isMe && member.name.toLowerCase() !== 'you' ? `${member.name} (you)` : member.name,
            }),
            el('span', { class: 'tiny', text: `${Units.distText(member.weekly)} ${Units.distLabel()} this week` }),
          ]),
          el('span', { class: 'role-tag', 'data-role': member.role, text: M.Crew.ROLES[member.role] }),
        ]);
        if (isLeader && !isMe) {
          row.appendChild(el('button', {
            class: 'icon-btn', type: 'button', text: '⋯', 'aria-label': 'Manage ' + member.name,
            onclick: () => this.manageMember(crew.id, member.id),
          }));
        }
        roster.appendChild(row);
      });
      parts.push(roster);

      // Actions depend on who you are to this crew.
      const actions = [];
      if (isLeader) {
        actions.push(el('button', { class: 'btn grow', type: 'button', text: 'Edit crew', onclick: () => this.editCrew(crew.id) }));
        actions.push(el('button', {
          class: 'btn btn--danger grow', type: 'button', text: 'Disband',
          onclick: () => {
            if (!window.confirm(`Disband ${crew.name}? This cannot be undone.`)) return;
            State.crewAction((st) => M.Crew.disband(st, crew.id));
            $('#crewSheet').hidden = true;
            this.renderCrew();
            this.toast('Crew disbanded');
          },
        }));
      } else if (isMember) {
        actions.push(el('button', {
          class: 'btn btn--danger btn--block', type: 'button', text: 'Leave crew',
          onclick: () => {
            const r = State.crewAction((st) => M.Crew.leave(st, crew.id));
            if (r.error) { this.toast(r.error); return; }
            $('#crewSheet').hidden = true;
            this.renderCrew();
            this.toast('You left the crew');
          },
        }));
      } else {
        actions.push(el('button', {
          class: 'btn btn--primary btn--block', type: 'button',
          text: crew.pendingMe ? 'Request sent' : crew.openJoin ? 'Join crew' : 'Ask to join',
          onclick: () => {
            if (crew.pendingMe) return;
            const r = State.crewAction((st) => M.Crew.join(st, crew.id));
            if (r.error) { this.toast(r.error); return; }
            $('#crewSheet').hidden = true;
            this.renderCrew();
            this.toast(r.pending ? `Request sent to <b>${crew.name}</b>` : `You are in <b>${crew.name}</b>`);
          },
        }));
      }
      parts.push(el('div', { class: 'row', style: 'gap:var(--s-3);margin-top:var(--s-4)' }, actions));

      parts.forEach((node) => body.appendChild(node));
      $('#crewSheet').hidden = false;

      function cell(value, label) {
        return el('div', { class: 'cell' }, [
          el('div', { class: 'stat-value', text: value }),
          el('div', { class: 'stat-label', text: label }),
        ]);
      }
    },

    manageMember(crewId, memberId) {
      const crew = M.Crew.all(State.data).find((c) => c.id === crewId);
      const member = crew && crew.members.find((m) => m.id === memberId);
      if (!member) return;
      const body = $('#crewSheetBody');
      body.innerHTML = '';

      const act = (fn, message) => {
        const r = State.crewAction(fn);
        if (r.error) { this.toast(r.error); return; }
        if (message) this.toast(message);
        this.openCrewSheet(crewId);
        this.renderCrew();
      };

      body.appendChild(el('div', { class: 'stack' }, [
        el('div', { class: 'row' }, [
          el('span', { class: 'friend-avatar', style: `background:${member.color}`, text: member.initials }),
          el('div', { class: 'stack grow', style: 'gap:2px' }, [
            el('span', { style: 'font-weight:800;font-size:17px', text: member.name }),
            el('span', { class: 'tiny', text: `${M.Crew.ROLES[member.role]} · joined ${relTime(member.joinedAt)}` }),
          ]),
        ]),
        member.role === 'pacer'
          ? el('button', { class: 'btn btn--block', type: 'button', text: 'Demote to member', onclick: () => act((st) => M.Crew.setRole(st, crewId, memberId, 'member'), `${member.name} is a member`) })
          : el('button', { class: 'btn btn--block', type: 'button', text: 'Make a pacer', onclick: () => act((st) => M.Crew.setRole(st, crewId, memberId, 'pacer'), `${member.name} leads the pack now`) }),
        el('button', {
          class: 'btn btn--block', type: 'button', text: 'Hand over the crew',
          onclick: () => {
            if (!window.confirm(`Make ${member.name} captain? You become a member.`)) return;
            act((st) => M.Crew.handOver(st, crewId, memberId), `${member.name} is now captain`);
          },
        }),
        el('button', {
          class: 'btn btn--danger btn--block', type: 'button', text: 'Remove from crew',
          onclick: () => {
            if (!window.confirm(`Remove ${member.name}?`)) return;
            act((st) => M.Crew.remove(st, crewId, memberId), `${member.name} removed`);
          },
        }),
        el('button', { class: 'btn btn--ghost btn--block', type: 'button', text: 'Back', onclick: () => this.openCrewSheet(crewId) }),
      ]));
    },

    editCrew(crewId) {
      const crew = M.Crew.all(State.data).find((c) => c.id === crewId);
      if (!crew) return;
      const body = $('#crewSheetBody');
      body.innerHTML = '';

      const name = el('input', { class: 'input', value: crew.name, maxlength: '28' });
      const tagline = el('input', { class: 'input', value: crew.tagline, maxlength: '60' });
      const spot = el('input', { class: 'input', value: crew.schedule.spot });
      const time = el('input', { class: 'input', type: 'time', value: crew.schedule.time });
      const day = el('select', { class: 'input' });
      ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Tue & Thu', 'Mon & Fri'].forEach((d) => day.appendChild(el('option', { value: d, text: d })));
      day.value = crew.schedule.day;
      const open = el('select', { class: 'input' }, [
        el('option', { value: 'open', text: 'Anyone can join' }),
        el('option', { value: 'review', text: 'I approve each request' }),
      ]);
      open.value = crew.openJoin ? 'open' : 'review';

      body.appendChild(el('div', { class: 'stack' }, [
        el('h3', { style: 'font-size:20px', text: 'Edit crew' }),
        el('label', { class: 'field-label', text: 'Name' }), name,
        el('label', { class: 'field-label', text: 'Tagline' }), tagline,
        el('label', { class: 'field-label', text: 'Joining' }), open,
        el('label', { class: 'field-label', text: 'Regular run' }),
        el('div', { class: 'row', style: 'gap:var(--s-3)' }, [day, time]),
        spot,
        el('div', { class: 'row', style: 'gap:var(--s-3);margin-top:var(--s-3)' }, [
          el('button', { class: 'btn grow', type: 'button', text: 'Back', onclick: () => this.openCrewSheet(crewId) }),
          el('button', {
            class: 'btn btn--primary grow', type: 'button', text: 'Save',
            onclick: () => {
              const r = State.crewAction((st) => M.Crew.edit(st, crewId, {
                name: name.value, tagline: tagline.value, openJoin: open.value === 'open',
                schedule: { day: day.value, time: time.value, spot: spot.value },
              }));
              if (r.error) { this.toast(r.error); return; }
              this.toast('Crew updated');
              this.openCrewSheet(crewId);
              this.renderCrew();
            },
          }),
        ]),
      ]));
    },


    /* --- Quests ------------------------------------------------------------- */

    renderQuests() {
      const s = State.data;
      this.renderRankLadder();

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


    /* --- Rank ladder ---------------------------------------------------------
       Every rank is a disc; its ring is the XP earned inside that rank's band.
       Swipe sideways to look back at what you passed and ahead at what is
       next. ---------------------------------------------------------------- */

    /** Where each rank stands relative to the XP you have earned. */
    rankStates() {
      const xp = Stats.xp(State.data);
      return M.RANKS.map((rank, i) => {
        const next = M.RANKS[i + 1] || null;
        const band = next ? next.xp - rank.xp : 0;
        const into = clamp(xp - rank.xp, 0, band || 1);

        let state = 'locked';
        if (next && xp >= next.xp) state = 'done';
        else if (xp >= rank.xp) state = 'current';

        return {
          rank,
          next,
          state,
          xp,
          earned: into,
          band,
          // A rank you have passed shows a full ring; one you have not
          // reached shows an empty one.
          progress: state === 'done' ? 1 : state === 'locked' ? 0 : (band ? into / band : 1),
        };
      });
    },

    renderRankLadder() {
      const entries = this.rankStates();
      const track = $('#rankTrack');
      const dots = $('#rankDots');
      track.innerHTML = '';
      dots.innerHTML = '';
      track.appendChild(el('i', { class: 'rank-spacer', 'aria-hidden': 'true' }));

      const R = 46;                               // ring radius in viewBox units
      const CIRCUMFERENCE = 2 * Math.PI * R;
      const TONE = { done: '#2ee6a8', current: '#ffb020', locked: 'rgba(255,255,255,0.18)' };

      entries.forEach((entry, i) => {
        const tone = TONE[entry.state];
        const pct = Math.round(entry.progress * 100);

        const ring = el('div', { class: 'rank-ring', html: `
          <svg viewBox="0 0 110 110" aria-hidden="true">
            <circle class="track" cx="55" cy="55" r="${R}" stroke-width="7"></circle>
            <circle class="fill" cx="55" cy="55" r="${R}" stroke-width="7" stroke="${tone}"
                    stroke-dasharray="${CIRCUMFERENCE.toFixed(2)}"
                    stroke-dashoffset="${(CIRCUMFERENCE * (1 - entry.progress)).toFixed(2)}"></circle>
          </svg>` });

        ring.appendChild(el('div', { class: 'rank-face' }, [
          el('span', { class: 'rank-letter', text: entry.rank.badge }),
          el('span', { class: 'rank-pct', text: entry.state === 'locked' ? 'Locked' : `${pct}%` }),
        ]));

        const slide = el('div', {
          class: 'rank-slide',
          'data-state': entry.state,
          'data-focused': String(entry.state === 'current'),
          role: 'button',
          tabindex: '-1',
          'aria-label': `${entry.rank.name}, ${entry.state}`,
        }, [
          ring,
          el('span', { class: 'rank-slide-name', text: entry.rank.name }),
          el('span', {
            class: 'rank-slide-xp',
            text: entry.state === 'done' ? 'Reached'
              : entry.state === 'current' && entry.band ? `${entry.earned} / ${entry.band} XP`
                : entry.state === 'current' ? `${entry.xp} XP`
                  : `${entry.rank.xp} XP`,
          }),
        ]);

        slide.addEventListener('click', () => this.focusRank(i));
        track.appendChild(slide);

        const dot = el('button', {
          type: 'button',
          'aria-label': entry.rank.name,
          'aria-current': String(entry.state === 'current'),
        });
        dot.addEventListener('click', () => this.focusRank(i));
        dots.appendChild(dot);
      });

      track.appendChild(el('i', { class: 'rank-spacer', 'aria-hidden': 'true' }));

      // Open on the rank you are actually on.
      const start = Math.max(0, entries.findIndex((e) => e.state === 'current'));
      this.rankIndex = start;
      this.showRankDetail(start);

      const deck = $('#rankDeck');
      if (!deck.dataset.bound) {
        deck.dataset.bound = 'true';
        // Native scrolling does the swiping; this only reports where it landed.
        deck.addEventListener('scroll', () => {
          clearTimeout(this._rankScroll);
          this._rankScroll = setTimeout(() => this.syncRankFocus(), 90);
        }, { passive: true });

        deck.addEventListener('keydown', (event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          this.focusRank(this.rankIndex + (event.key === 'ArrowRight' ? 1 : -1));
        });
      }

      // Jump without animating on first paint, so it opens already centred.
      requestAnimationFrame(() => this.focusRank(start, 'auto'));
    },

    /** Centres a rank in the deck; the scroll handler updates the rest. */
    focusRank(index, behavior) {
      const slides = $$('#rankTrack .rank-slide');
      const at = clamp(index, 0, slides.length - 1);
      const slide = slides[at];
      if (!slide) return;
      const deck = $('#rankDeck');
      deck.scrollTo({
        left: slide.offsetLeft - (deck.clientWidth - slide.offsetWidth) / 2,
        behavior: behavior || 'smooth',
      });
      this.markRank(at);
    },

    /** Works out which disc the deck came to rest on. */
    syncRankFocus() {
      const deck = $('#rankDeck');
      const centre = deck.scrollLeft + deck.clientWidth / 2;
      let best = 0;
      let bestGap = Infinity;
      $$('#rankTrack .rank-slide').forEach((slide, i) => {
        const gap = Math.abs(slide.offsetLeft + slide.offsetWidth / 2 - centre);
        if (gap < bestGap) { bestGap = gap; best = i; }
      });
      this.markRank(best);
    },

    markRank(index) {
      if (this.rankIndex === index && $('#rankDetail').childNodes.length) return;
      this.rankIndex = index;
      $$('#rankTrack .rank-slide').forEach((slide, i) => slide.setAttribute('data-focused', String(i === index)));
      $$('#rankDots button').forEach((dot, i) => dot.setAttribute('aria-current', String(i === index)));
      this.showRankDetail(index);
    },

    showRankDetail(index) {
      const entry = this.rankStates()[index];
      if (!entry) return;
      const box = $('#rankDetail');
      box.setAttribute('data-state', entry.state);
      box.innerHTML = '';

      const eyebrow = entry.state === 'done' ? 'Behind you'
        : entry.state === 'current' ? 'Where you are' : 'Ahead of you';

      let body;
      if (entry.state === 'done') {
        body = `You passed ${entry.rank.name} at ${entry.rank.xp} XP. It is yours for good — rank never drops.`;
      } else if (entry.state === 'current' && entry.next) {
        const left = entry.next.xp - entry.xp;
        body = `${entry.earned} of ${entry.band} XP earned in this band. ${left} XP more and you are a ${entry.next.name}.`;
      } else if (entry.state === 'current') {
        body = `Top of the ladder, on ${entry.xp} XP. There is nothing above this one.`;
      } else {
        body = `${entry.rank.xp} XP unlocks ${entry.rank.name} — ${entry.rank.xp - entry.xp} XP from where you are now.`;
      }

      box.appendChild(el('span', { class: 'stat-label', text: eyebrow }));
      box.appendChild(el('h3', { text: entry.rank.name }));
      box.appendChild(el('p', { text: body }));

      if (entry.state !== 'done') {
        const next = M.QUESTS
          .map((q) => M.questView(State.data, q))
          .filter((v) => !v.complete)
          .sort((a, b) => b.ratio - a.ratio)[0];
        if (next) {
          box.appendChild(el('span', {
            class: 'tiny',
            text: `Closest quest: ${next.quest.name} — ${Math.round(next.ratio * 100)}% done, worth ${next.quest.xp} XP.`,
          }));
        }
      }
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
            kindChip(a),
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

      /** The same badge vocabulary the record cards use. */
      function kindChip(a) {
        const k = M.KINDS[a.kind || 'free'];
        const won = a.kind === 'race' && a.placing === 1;
        return el('span', {
          class: 'chip',
          style: `border-color:${k.accent}55;color:${k.accent}`,
          text: a.kind === 'race' && a.placing ? (won ? 'WON' : M.ordinal(a.placing)) : k.badge,
        });
      }

      function stat(value, label) {
        return el('div', { class: 'stack', style: 'gap:2px' }, [
          el('span', { class: 'stat-value', style: 'font-size:16px', text: value }),
          el('span', { class: 'stat-label', text: label }),
        ]);
      }
    },

    showCardPreview(activity, item) {
      this.cardReturn = this.tab;
      this.go('finish');
      $('#finishTitle').textContent = activity.title;
      $('#finishEyebrow').textContent = item && !item.me && item.who !== State.data.profile.name
        ? `${item.who}'s card` : 'Record card';
      $('#doneBtn').textContent = 'Back';
      M.renderCard($('#cardCanvas'), activity, {
        athlete: item ? item.who : State.data.profile.name,
        rank: Stats.rank(State.data).current.name,
        totalArea: Stats.totalArea(State.data),
      });
      const extras = $('#finishExtras');
      extras.innerHTML = '';
      if (activity.splits && activity.splits.length) {
        extras.appendChild(el('div', { class: 'card stack' }, [
          el('span', { class: 'card-title', text: 'Splits' }),
          el('div', { class: 'stack', style: 'gap:6px' }, activity.splits.map((sp) => el('div', { class: 'row row--between' }, [
            el('span', { class: 'tiny', text: `KM ${sp.km}` }),
            el('span', { class: 'stat-value', style: 'font-size:13px', text: clock(sp.seconds) }),
          ]))),
        ]));
      }
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
          const kind = loop ? 'territory' : rand() > 0.5 ? 'race' : 'free';
          const fieldSize = 2 + Math.floor(rand() * 4);
          out.push({
            who: f.name, initials: f.initials, color: f.color, me: false,
            activity: {
              id: `f-${f.id}-${i}`,
              startedAt: Date.now() - (rand() * 4 + i) * 864e5,
              kind,
              title: M.KINDS[kind].name,
              distance,
              duration: (distance / 1000) * paceSec,
              elevation: Math.round(rand() * 120),
              route,
              splits: [],
              loopClosed: loop,
              claimedArea: area,
              target: kind === 'race' ? Math.round(distance / 1000) * 1000 : null,
              placing: kind === 'race' ? 1 + Math.floor(rand() * fieldSize) : null,
              fieldSize: kind === 'race' ? fieldSize : null,
              finished: kind === 'race' ? true : null,
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

      $('#addFriendBtn').addEventListener('click', () => this.promptFriend());

      $$('#historyFilter button').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.historyKind = btn.dataset.kind;
          $$('#historyFilter button').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
          this.renderHistory();
        });
      });

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

      this.renderFriendList();
      this.renderHistory();
    },

    renderFriendList() {
      const list = $('#friendList');
      const friends = State.data.friends;
      list.innerHTML = '';
      $('#friendCount').textContent = `${friends.length} racing`;

      if (!friends.length) {
        list.appendChild(el('div', { class: 'empty', text: 'No friends yet. Add one and they can line up in your next race.' }));
        return;
      }

      friends.forEach((f) => {
        list.appendChild(el('div', { class: 'friend' }, [
          el('span', { class: 'friend-avatar', style: `background:${f.color}`, text: f.initials }),
          el('div', { class: 'stack grow', style: 'gap:3px' }, [
            el('span', { style: 'font-weight:700;font-size:14px', text: f.name }),
            el('span', { class: 'tiny', text: `${Units.paceText(f.pace / 1000)} ${Units.paceLabel()} race pace` }),
          ]),
          el('button', {
            class: 'chip', type: 'button', text: 'Remove',
            onclick: () => {
              if (!window.confirm(`Remove ${f.name}?`)) return;
              State.removeFriend(f.id);
              this.toast(`<b>${f.name}</b> removed`);
            },
          }),
        ]));
      });
    },

    /** Every card you have earned, filtered by what kind of run it was. */
    renderHistory() {
      const list = $('#historyList');
      const kind = this.historyKind || 'all';
      const runs = State.data.activities.filter((a) => kind === 'all' || (a.kind || 'free') === kind);
      list.innerHTML = '';

      if (!runs.length) {
        list.style.display = 'block';
        list.appendChild(el('div', { class: 'empty', text: kind === 'all' ? 'No runs yet.' : 'No runs of that kind yet.' }));
        return;
      }
      list.style.display = '';

      runs.forEach((a) => {
        const k = M.KINDS[a.kind || 'free'];
        const canvas = el('canvas');
        // A race is remembered by where you came; land, by how much you took.
        const value = a.kind === 'race' && a.placing
          ? M.ordinal(a.placing)
          : a.claimedArea
            ? `${Units.areaText(a.claimedArea)} ${Units.areaLabel()}`
            : `${Units.distText(a.distance)} ${Units.distLabel()}`;

        const item = el('button', { class: 'history-item', type: 'button', 'data-kind': a.kind || 'free' }, [
          canvas,
          el('span', { class: 'history-badge', text: k.badge }),
          el('span', { class: 'history-value', text: value }),
          el('span', { class: 'tiny', text: relTime(a.startedAt) }),
        ]);
        item.addEventListener('click', () => {
          this.lastActivity = a;
          this.showCardPreview(a, { who: State.data.profile.name });
        });
        list.appendChild(item);
        requestAnimationFrame(() => M.drawRouteThumb(canvas, a.route, {
          stroke: k.accent,
          fill: a.claimedArea ? 'rgba(139,92,246,0.28)' : null,
          pad: 7, width: 2,
        }));
      });
    },
  };

  M.UI = UI;
})(window.MILES);
