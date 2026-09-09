/* ==========================================================================
   MILES · coach
   A running coach that knows your actual training: a plan built from your
   real volume, form work aimed at what your data suggests, and an assistant
   you can ask anything.

   WHERE THE MODEL LIVES. This app is a static front end, so it never holds an
   API key — a key shipped to a browser is a key you have given away. Three
   backends are tried in order, and the UI always says which one answered:

     1. `claude.use("sample")` — when the page runs as a published Artifact,
        the viewer's own Claude answers. No key, nothing to host.
     2. A proxy you run — POST {system, messages} to an endpoint you set in
        You → Coach AI. `server/coach-proxy.mjs` is a working one: it holds
        the key server-side and calls Claude with the official SDK.
     3. Offline coaching — the deterministic planner below. No network, no
        model, still a usable plan. This is what makes the feature honest
        rather than a dead button when nothing is configured.
   ========================================================================== */

(function (M) {
  'use strict';

  const { Units, Stats, clamp, clock } = M;

  const GOALS = {
    consistency: { key: 'consistency', name: 'Run more often', detail: 'Build the habit before the mileage' },
    '5k':        { key: '5k',   name: 'Faster 5K',      detail: 'Sharpen speed over a short, honest distance', race: 5000 },
    '10k':       { key: '10k',  name: 'Run a 10K',      detail: 'Hold a steady effort for the hour', race: 10000 },
    half:        { key: 'half', name: 'Half marathon',  detail: 'Build to 21.1 km without breaking', race: 21097 },
    territory:   { key: 'territory', name: 'Take more ground', detail: 'Loop-shaped training that grows your map' },
  };

  const SESSIONS = {
    rest:     { key: 'rest',     name: 'Rest',       tone: '#64748b' },
    easy:     { key: 'easy',     name: 'Easy',       tone: '#2ee6a8' },
    long:     { key: 'long',     name: 'Long',       tone: '#2fe0ff' },
    tempo:    { key: 'tempo',    name: 'Tempo',      tone: '#ffb020' },
    interval: { key: 'interval', name: 'Intervals',  tone: '#ff3d8b' },
    loop:     { key: 'loop',     name: 'Loop',       tone: '#a855f7' },
  };

  const Coach = {
    GOALS,
    SESSIONS,
    endpoint: '',            // set in You → Coach AI
    _sample: null,
    _sampleTried: false,

    /* --- Provider ---------------------------------------------------------- */

    /** Resolves the Artifact sampling capability once, if this view has it. */
    async _artifactSampler() {
      if (this._sampleTried) return this._sample;
      this._sampleTried = true;
      try {
        if (window.claude && typeof window.claude.use === 'function') {
          this._sample = await window.claude.use('sample');
        }
      } catch (err) {
        this._sample = null;
      }
      return this._sample;
    },

    async provider() {
      if (await this._artifactSampler()) return 'artifact';
      if (this.endpoint) return 'proxy';
      return 'offline';
    },

    /**
     * Asks the coach a question.
     * @returns {Promise<{text: string, source: 'artifact'|'proxy'|'offline'}>}
     */
    async ask(messages, options) {
      const opts = options || {};
      const system = opts.system || this.systemPrompt();

      const sampler = await this._artifactSampler();
      if (sampler) {
        try {
          const turns = [{ role: 'user', content: system + '\n\n---\n\n' + flatten(messages) }];
          const result = await sampler(turns, { modelTier: opts.tier || 'default' });
          if (result && result.text) return { text: result.text.trim(), source: 'artifact' };
        } catch (err) {
          if (err && err.code === 'not_granted') return { text: this.offline(messages, opts), source: 'offline' };
          // fall through to the next backend
        }
      }

      if (this.endpoint) {
        try {
          const response = await fetch(this.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ system, messages }),
          });
          if (!response.ok) throw new Error('HTTP ' + response.status);
          const data = await response.json();
          if (data && data.text) return { text: String(data.text).trim(), source: 'proxy' };
          throw new Error('empty response');
        } catch (err) {
          return { text: this.offline(messages, opts), source: 'offline', note: 'Coach endpoint did not answer' };
        }
      }

      return { text: this.offline(messages, opts), source: 'offline' };
    },

    /* --- Context -----------------------------------------------------------
       The coach is only worth asking because it knows your training. ------ */

    facts(state) {
      const s = state || M.State.data;
      const week = Stats.weekly(s);
      const rolling = Stats.rolling7(s);
      const runs = s.activities;
      const longest = runs.reduce((m, a) => Math.max(m, a.distance), 0);
      const paced = runs.filter((a) => a.distance > 800);
      const avgPace = paced.length
        ? paced.reduce((sum, a) => sum + a.duration / a.distance, 0) / paced.length
        : 0;
      const crew = M.Crew ? M.Crew.mine(s) : null;

      return {
        name: s.profile.name,
        units: Units.system,
        weekDistance: week.distance,
        weekRuns: week.runs,
        rolling7: rolling,
        tier: Stats.tier(s).tier.name,
        rank: Stats.rank(s).current.name,
        streak: Stats.streak(s),
        longest,
        avgPace,
        totalRuns: runs.length,
        territory: Stats.totalArea(s),
        races: runs.filter((a) => a.kind === 'race').length,
        wins: runs.filter((a) => a.kind === 'race' && a.placing === 1).length,
        crew: crew ? crew.name : null,
        recent: runs.slice(0, 5).map((a) => ({
          kind: a.kind || 'free',
          distance: a.distance,
          duration: a.duration,
          daysAgo: Math.round((Date.now() - a.startedAt) / 864e5),
        })),
      };
    },

    /** The facts, written the way a coach would read them. */
    brief(state) {
      const f = this.facts(state);
      const d = (m) => `${Units.distText(m)} ${Units.distLabel()}`;
      const lines = [
        `Runner: ${f.name} (rank ${f.rank}, intensity tier ${f.tier})`,
        `Last 7 days: ${d(f.rolling7)} across ${f.weekRuns} runs this calendar week`,
        `Longest run ever: ${d(f.longest)}`,
        `Average pace: ${Units.paceText(f.avgPace)} ${Units.paceLabel()}`,
        `Current streak: ${f.streak} day(s); ${f.totalRuns} runs recorded in total`,
        `Territory held: ${Units.areaText(f.territory)} ${Units.areaLabel()}`,
        `Races run: ${f.races} (won ${f.wins})`,
        f.crew ? `Crew: ${f.crew}` : 'Not in a crew',
        'Recent runs: ' + (f.recent.length
          ? f.recent.map((r) => `${r.kind} ${d(r.distance)} in ${clock(r.duration)} (${r.daysAgo}d ago)`).join('; ')
          : 'none'),
        `Preferred units: ${f.units === 'km' ? 'kilometres' : 'miles'}`,
      ];
      return lines.join('\n');
    },

    systemPrompt() {
      return [
        'You are the running coach inside MILES, a running app.',
        'You are talking to the runner whose data appears below. Use it — refer to their actual numbers rather than talking in generalities.',
        '',
        'How to answer:',
        '- Be concrete and brief. Short paragraphs or tight bullets, no preamble.',
        '- Give numbers in the runner\'s own units, which are stated in the data.',
        '- Progress mileage conservatively: about 10% a week, with an easier week every fourth.',
        '- Most weekly volume should be easy running. At most two hard sessions a week.',
        '- Never diagnose an injury or give medical advice. If they describe pain that persists, tell them plainly to see a physio or doctor.',
        '- If the data does not support an answer, say so instead of inventing it.',
        '',
        'The runner\'s current training:',
        this.brief(),
      ].join('\n');
    },

    /* --- Plan ---------------------------------------------------------------
       Built locally from real numbers, whether or not a model is available.
       When a model IS available it annotates this plan rather than replacing
       it, so the mileage maths stays trustworthy. ------------------------- */

    buildPlan(state, options) {
      const s = state || M.State.data;
      const opts = options || {};
      const goal = GOALS[opts.goal] || GOALS.consistency;
      const weeks = clamp(opts.weeks || 4, 2, 12);
      const daysPerWeek = clamp(opts.days || 4, 2, 6);

      const base = Math.max(Stats.rolling7(s), 8000);      // never plan from zero
      const longest = Math.max(s.activities.reduce((m, a) => Math.max(m, a.distance), 0), base * 0.3);

      const plan = { goal, weeks: [], createdAt: Date.now(), weeksCount: weeks, daysPerWeek };

      for (let w = 0; w < weeks; w++) {
        // Three weeks up, one week down — the standard way to absorb load.
        const isDown = (w + 1) % 4 === 0;
        const growth = Math.pow(1.1, w - Math.floor(w / 4));
        const volume = isDown ? base * growth * 0.75 : base * growth;

        const sessions = this._week(goal, daysPerWeek, volume, longest, w, weeks, isDown);
        plan.weeks.push({
          index: w + 1,
          volume: sessions.reduce((sum, x) => sum + x.distance, 0),
          down: isDown,
          note: isDown
            ? 'Recovery week — hold the effort back even if you feel good.'
            : w === weeks - 1 && goal.race
              ? 'Race week. Stay sharp, stay fresh.'
              : null,
          sessions,
        });
      }
      return plan;
    },

    _week(goal, days, volume, longest, w, total, isDown) {
      const isRaceWeek = !!goal.race && w === total - 1;
      const longShare = goal.key === 'half' ? 0.38 : goal.key === '10k' ? 0.32 : 0.3;

      // Which quality sessions this goal cares about.
      const quality = goal.key === '5k' ? ['interval', 'tempo']
        : goal.key === '10k' ? ['tempo', 'interval']
          : goal.key === 'half' ? ['tempo']
            : goal.key === 'territory' ? ['loop']
              : [];

      const out = [];
      const longDistance = isRaceWeek && goal.race ? goal.race : Math.min(volume * longShare, longest * 1.12);
      out.push({
        type: isRaceWeek && goal.race ? 'long' : goal.key === 'territory' ? 'loop' : 'long',
        distance: Math.round(longDistance / 100) * 100,
        note: isRaceWeek && goal.race
          ? `Goal effort — the ${Units.distText(goal.race)} ${Units.distLabel()} itself`
          : goal.key === 'territory'
            ? 'Run it as one closed loop and claim what it encloses'
            : 'Conversational the whole way',
      });

      let remaining = volume - out[0].distance;
      const others = Math.max(1, days - 1);
      const qualityCount = isDown || isRaceWeek ? 0 : Math.min(quality.length, others - 1);

      for (let i = 0; i < qualityCount; i++) {
        const type = quality[i];
        const distance = Math.round((remaining * 0.28) / 100) * 100;
        out.push({
          type,
          distance,
          note: type === 'interval' ? '6 × 3 min hard, 2 min jog between'
            : type === 'tempo' ? '20 min at comfortably hard, easy either side'
              : 'Closed loop — start and finish in the same place',
        });
        remaining -= distance;
      }

      const easyCount = others - qualityCount;
      for (let i = 0; i < easyCount; i++) {
        out.push({
          type: 'easy',
          distance: Math.round((remaining / easyCount) / 100) * 100,
          note: 'Easy means easy. You should be able to talk.',
        });
      }

      for (let i = out.length; i < 7; i++) out.push({ type: 'rest', distance: 0, note: null });
      return out;
    },

    /* --- Form ---------------------------------------------------------------
       Generic cues, plus the two or three that this runner's data argues for. */

    formNotes(state) {
      const f = this.facts(state);
      const notes = [
        { key: 'cadence', title: 'Cadence over stride', body: 'Aim for quick, light steps — around 170–180 per minute. Reaching further in front of you is what turns a stride into a brake.' },
        { key: 'posture', title: 'Run tall, lean from the ankles', body: 'Stack ears over shoulders over hips. Any forward lean comes from the ankle, not a folded waist.' },
        { key: 'foot', title: 'Land under your hips', body: 'Where the foot lands matters far more than which part touches first. Under your centre of mass, not out in front.' },
        { key: 'arms', title: 'Arms drive back, not across', body: 'Elbows around 90°, hands relaxed. Swing front-to-back — crossing the midline twists the trunk and wastes work.' },
        { key: 'breath', title: 'Breathe from the belly', body: 'Low, rhythmic breathing. If you cannot speak a full sentence on an easy run, it is not an easy run.' },
      ];

      const flags = [];
      if (f.rolling7 > 0 && f.weekRuns >= 5 && f.streak >= 6) {
        flags.push({ tone: 'warn', title: 'You have not taken a day off', body: `A ${f.streak}-day streak is a fine thing right up until it is an injury. Put one rest day in this week.` });
      }
      if (f.longest > 0 && f.rolling7 > 0 && f.longest > f.rolling7 * 0.55) {
        flags.push({ tone: 'warn', title: 'Your long run is a big share of your week', body: 'One run carrying more than half your weekly volume is where a lot of calf and knee trouble starts. Grow the easy days first.' });
      }
      if (f.weekRuns <= 1) {
        flags.push({ tone: 'info', title: 'Frequency before distance', body: 'Three short runs beat one long one for building durability. Add a run before you add kilometres.' });
      }
      return { notes, flags };
    },

    /* --- Offline coaching ---------------------------------------------------
       Deterministic answers so the coach is never a dead button. --------- */

    offline(messages, opts) {
      const question = (flatten(messages) || '').toLowerCase();
      const f = this.facts();
      const d = (m) => `${Units.distText(m)} ${Units.distLabel()}`;

      if (opts && opts.kind === 'plan') {
        return 'Working offline, so this plan comes from your numbers rather than a model: '
          + `it starts at ${d(f.rolling7)} a week — what you have actually been running — and grows about 10% a week `
          + 'with an easier fourth week. Connect a coach endpoint in You → Coach AI for written coaching on top of it.';
      }

      if (opts && opts.kind === 'form') {
        const { flags } = this.formNotes();
        if (flags.length) {
          return flags.map((x) => `${x.title}. ${x.body}`).join('\n\n')
            + '\n\nThose come from your own numbers. For written coaching on top of them, set a coach endpoint in You → Coach AI.';
        }
        return 'Nothing in your data is waving a flag right now: your volume, long run and rest days are in a sensible relationship. '
          + `Keep most of your ${d(f.rolling7)} a week easy, and work on cadence — quick, light steps landing under your hips.`;
      }

      if (/too much|overtrain|너무 많|과훈련|rest|휴식|쉬어/.test(question)) {
        const share = f.rolling7 > 0 ? Math.round((f.longest / f.rolling7) * 100) : 0;
        return `You have run ${d(f.rolling7)} in the last 7 days across ${f.weekRuns} runs this week, on a ${f.streak}-day streak. `
          + (f.streak >= 6
            ? 'That streak is the part I would change first — take one full rest day this week.'
            : 'That is a reasonable load as long as most of it is easy.')
          + (share > 55 ? ` Your longest run is about ${share}% of your week, which is a lot for one session — grow the easy days first.` : '')
          + ' The rule that keeps people healthy is dull: add about 10% a week, and take every fourth week easier.';
      }
      if (/faster|speed|빨리|스피드|기록/.test(question)) {
        return `You average ${Units.paceText(f.avgPace)} ${Units.paceLabel()}. Getting faster is mostly about running more, easy, `
          + 'plus one hard session a week — 6 × 3 minutes hard with 2 minutes jog is enough to start. '
          + 'Two hard sessions is the ceiling; a third is how people get hurt rather than fast.';
      }
      if (/tomorrow|today|what should i run|내일|오늘|뭘 뛰/.test(question)) {
        const plan = M.State.data.coach.plan;
        if (plan && plan.weeks.length) {
          const next = plan.weeks[0].sessions.find((x) => x.type !== 'rest');
          if (next) return `Your plan has you down for a ${this.SESSIONS[next.type].name.toLowerCase()} run of ${d(next.distance)} — ${next.note}`;
        }
        return f.streak >= 5
          ? 'Rest. A five-day streak with no day off is where the value stops going up.'
          : `An easy ${d(Math.max(4000, f.rolling7 * 0.2))} at a pace you could hold a conversation at. Build the plan in the Plan tab for a real week.`;
      }
      if (/injur|pain|hurt|sore|아프|통증/.test(question)) {
        return 'I cannot assess an injury, and I would not want to guess at one. Pain that persists past a couple of easy days, '
          + 'or any pain that changes how you run, is worth a physio or doctor rather than an app. In the meantime, rest beats pushing through.';
      }
      if (/pace|속도|페이스/.test(question)) {
        return `Your average across recorded runs is ${Units.paceText(f.avgPace)} ${Units.paceLabel()}. `
          + 'Easy runs should sit roughly a minute per kilometre slower than that, and most of your week should be easy. '
          + 'If every run feels the same effort, you are training one gear.';
      }
      if (/long|거리|늘리/.test(question)) {
        return `Your longest is ${d(f.longest)} and you are averaging ${d(f.rolling7)} a week. `
          + 'Add about 10% a week, and let the long run be under a third of the weekly total.';
      }
      if (/territory|영토|loop|루프/.test(question)) {
        return `You hold ${Units.areaText(f.territory)} ${Units.areaLabel()}. Territory rewards closed loops, not distance — `
          + 'a wide, round route encloses far more than an out-and-back of the same length.';
      }
      if (/race|레이스|경쟁/.test(question)) {
        return f.races
          ? `You have raced ${f.races} time(s) and won ${f.wins}. Race pace is not your training pace — put two easy days either side of one.`
          : 'You have not raced yet. Start at 1 km against one friend; short races teach pacing faster than long ones.';
      }

      return 'The coach is running offline, so this is what your own data says: '
        + `${d(f.rolling7)} in the last 7 days, longest run ${d(f.longest)}, average pace ${Units.paceText(f.avgPace)} ${Units.paceLabel()}, `
        + `${f.streak}-day streak. For written coaching, set a coach endpoint in You → Coach AI, or open this app as a published Artifact.`;
    },
  };

  function flatten(messages) {
    if (typeof messages === 'string') return messages;
    return (messages || []).map((m) => `${m.role === 'assistant' ? 'Coach' : 'Runner'}: ${m.content}`).join('\n\n');
  }

  M.Coach = Coach;
})(window.MILES);
