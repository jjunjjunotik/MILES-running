/* ==========================================================================
   MILES · account
   Everything an account needs that the demo never did: signing up and in,
   a forgotten password, the friend code, a new password, your data, blocked
   runners, reporting, signing out and deleting the account. Only with a
   server (api.js); with none, nothing here is shown.
   ========================================================================== */

(function (M) {
  'use strict';

  const { $, el, esc, Api, State, Bus } = M;

  /* What a report can be about, in the words a runner would use. The keys
     are the server's (routes/moderation.js). */
  const REASONS = [
    ['abuse', 'Harassment or bullying'],
    ['hate', 'Hate or discrimination'],
    ['sexual', 'Sexual content'],
    ['violence', 'Violence or threats'],
    ['spam', 'Spam or advertising'],
    ['impersonation', 'Pretending to be someone else'],
    ['cheating', 'Faked runs or GPS'],
    ['other', 'Something else'],
  ];

  const MODES = {
    signup: { title: 'Make your account', submit: 'Create account', busy: 'Creating…' },
    signin: { title: 'Welcome back', submit: 'Sign in', busy: 'Signing in…' },
    reset1: { title: 'Forgot your password?', submit: 'Email me a code', busy: 'Sending…' },
    reset2: { title: 'Choose a new password', submit: 'Set password and sign in', busy: 'Saving…' },
  };

  const UI = () => M.UI;
  const toast = (html, kind) => UI().toast(html, kind);

  const Account = {
    mode: 'signup',
    email: '',
    busy: false,

    init() {
      if (!Api.enabled) return;
      Bus.on('auth:changed', (event) => this.changed(event));
      Bus.on('live:invite', (race) => UI().offerRace(race));
      if (Api.signedIn()) {
        this.hideAuth();
        Api.live.connect();
        M.Sync.pullAll();
      } else {
        this.showAuth();
      }
    },

    changed(event) {
      M.Sync.reset();
      if (event.signedIn) {
        State.useAccount(event.user);
        this.hideAuth();
        UI().go('home');
        // Where you are decides which crews and ground are "near you".
        M.Sync.pullAll().then(() => UI().locate({ quiet: true }));
      } else {
        State.signOut();
        UI().go('home');
        this.mode = 'signin';
        this.showAuth(event.expired ? { error: 'Your session ended. Sign in again.' } : null);
      }
    },

    /* --- The sign-in screen ---------------------------------------------------- */

    showAuth(message) {
      const screen = $('#authScreen');
      this.renderAuth(message);
      screen.hidden = false;
      UI().pinShell();
    },

    hideAuth() {
      $('#authScreen').hidden = true;
    },

    setMode(mode, message) {
      this.mode = mode;
      this.renderAuth(message);
      const first = $('#authScreen .input');
      // Only into a form nobody is typing in yet: a quick tap or a password
      // manager must not have its field taken away mid-word.
      const host = $('#authScreen');
      if (first) setTimeout(() => { if (!host.contains(document.activeElement)) first.focus({ preventScroll: true }); }, 30);
    },

    renderAuth(message) {
      const host = $('#authScreen');
      const mode = this.mode;
      const copy = MODES[mode];
      host.innerHTML = '';

      const field = (label, input, hint) => el('div', { class: 'form-field' }, [
        el('label', { class: 'field-label', for: input.id, text: label }),
        input,
        hint ? el('span', { class: 'auth-hint', text: hint }) : null,
      ]);
      const check = (id, content) => {
        const input = el('input', { type: 'checkbox', id });
        // el() takes nodes; a label mixes words and links.
        const words = content.map((c) => (typeof c === 'string' ? document.createTextNode(c) : c));
        return el('label', { class: 'auth-check', for: id }, [input, el('span', {}, words)]);
      };
      const page = (text, path) => el('a', { href: Api.page(path), target: '_blank', rel: 'noopener', text });

      const name = el('input', { class: 'input', id: 'authName', autocomplete: 'nickname', maxlength: '24', placeholder: 'What your rivals see' });
      const email = el('input', {
        class: 'input', id: 'authEmail', type: 'email', autocomplete: 'email', inputmode: 'email',
        autocapitalize: 'off', spellcheck: 'false', placeholder: 'you@example.com',
      });
      email.value = this.email;
      const password = el('input', {
        class: 'input', id: 'authPassword', type: 'password',
        autocomplete: mode === 'signin' ? 'current-password' : 'new-password',
      });
      const code = el('input', {
        class: 'input', id: 'authCode', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', placeholder: '6 digits',
      });

      const parts = [];
      if (mode === 'signup' || mode === 'signin') {
        parts.push(el('div', { class: 'seg seg--block auth-switch', role: 'group', 'aria-label': 'Account' }, [
          el('button', { type: 'button', 'aria-pressed': String(mode === 'signup'), text: 'New here', onclick: () => this.setMode('signup') }),
          el('button', { type: 'button', 'aria-pressed': String(mode === 'signin'), text: 'Sign in', onclick: () => this.setMode('signin') }),
        ]));
      }
      parts.push(el('h1', { class: 'auth-title', id: 'authTitle', text: copy.title }));
      if (mode === 'reset1') parts.push(el('p', { class: 'auth-note', text: 'Enter the email on your account and we will send a six-digit code to it.' }));
      if (mode === 'signup') parts.push(field('Runner name', name));
      if (mode !== 'reset2') parts.push(field('Email', email));
      if (mode === 'reset2') parts.push(field('Code from the email', code, `Sent to ${this.email}. It works for 15 minutes.`));
      if (mode !== 'reset1') {
        parts.push(field(mode === 'reset2' ? 'New password' : 'Password', password, mode === 'signin' ? null : 'At least 8 characters'));
      }
      let age = null;
      let terms = null;
      if (mode === 'signup') {
        age = check('authAge', ['I am 14 or older']);
        terms = check('authTerms', ['I agree to the ', page('Terms', '/terms'), ' and the ', page('Privacy policy', '/privacy')]);
        parts.push(el('div', { class: 'auth-checks' }, [age, terms]));
      }

      const error = el('p', { class: 'auth-message', id: 'authError', role: 'alert', 'aria-live': 'polite' });
      const say = (m) => {
        error.textContent = m ? (m.error || m.note) : '';
        error.dataset.kind = m && m.error ? 'error' : 'note';
        error.hidden = !m;
      };
      say(message || null);
      parts.push(error);

      const submit = el('button', { class: 'btn btn--primary btn--block', type: 'submit', id: 'authSubmit', text: copy.submit });
      parts.push(submit);

      if (mode === 'signin') {
        parts.push(el('button', { class: 'auth-link', type: 'button', id: 'authForgot', text: 'Forgot your password?', onclick: () => {
          this.email = email.value.trim();
          this.setMode('reset1');
        } }));
      }
      if (mode === 'reset1' || mode === 'reset2') {
        parts.push(el('button', { class: 'auth-link', type: 'button', id: 'authBack', text: 'Back to sign in', onclick: () => this.setMode('signin') }));
      }

      const form = el('form', { class: 'auth-form', novalidate: true }, parts);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        this.submit({ mode, name, email, password, code, age, terms, submit, say });
      });

      host.appendChild(el('div', { class: 'auth-inner' }, [
        el('div', { class: 'auth-brand' }, [
          el('span', { class: 'wordmark auth-mark', text: 'MILES' }),
          el('p', { class: 'auth-lead', text: 'Close a loop and everything inside it is yours.' }),
        ]),
        form,
        el('p', { class: 'auth-foot' }, [
          page('Privacy', '/privacy'), el('span', { text: ' · ' }), page('Terms', '/terms'), el('span', { text: ' · ' }), page('Support', '/support'),
        ]),
      ]));
    },

    async submit(f) {
      if (this.busy) return;
      const mode = f.mode;
      this.email = f.email.value.trim() || this.email;
      if (mode === 'signup') {
        if (!f.name.value.trim()) { f.say({ error: 'Pick a runner name.' }); return; }
        if (!f.age.querySelector('input').checked) { f.say({ error: 'MILES is for runners aged 14 and over.' }); return; }
        if (!f.terms.querySelector('input').checked) { f.say({ error: 'Agree to the terms and the privacy policy to make an account.' }); return; }
      }
      this.busy = true;
      f.submit.disabled = true;
      f.submit.textContent = MODES[mode].busy;
      f.say(null);
      try {
        if (mode === 'signup') {
          await Api.signUp({
            name: f.name.value.trim(), email: this.email, password: f.password.value,
            acceptTerms: true, ageConfirmed: true,
            prefs: { units: State.data.units },
          });
        } else if (mode === 'signin') {
          await Api.signIn(this.email, f.password.value);
        } else if (mode === 'reset1') {
          await Api.post('/v1/auth/password/forgot', { email: this.email });
          this.busy = false;
          this.setMode('reset2', { note: 'If there is an account with that email, the code is on its way.' });
          return;
        } else {
          await Api.resetPassword(this.email, f.code.value, f.password.value);
        }
      } catch (err) {
        f.say({ error: err.message });
      } finally {
        this.busy = false;
        if (f.submit.isConnected) {
          f.submit.disabled = false;
          f.submit.textContent = MODES[mode].submit;
        }
      }
    },

    /* --- The account card on You -------------------------------------------- */

    renderCard() {
      const card = $('#dataCard');
      const s = State.data;
      if (!card || !s.connected) return;
      card.innerHTML = '';
      const account = s.account || {};
      const action = (text, onclick, extra) => el('button', Object.assign({ class: 'btn btn--ghost btn--block', type: 'button', text, onclick }, extra || {}));

      card.appendChild(el('span', { class: 'card-title', text: 'Account' }));
      card.appendChild(el('div', { class: 'setting' }, [
        el('div', { class: 'stack', style: 'gap:2px;min-width:0' }, [
          el('div', { class: 'setting-name', text: 'Email' }),
          el('div', { class: 'tiny truncate', id: 'accountEmail', text: account.email || '' }),
        ]),
      ]));
      card.appendChild(el('div', { class: 'setting' }, [
        el('div', { class: 'stack', style: 'gap:2px' }, [
          el('div', { class: 'setting-name', text: 'Your friend code' }),
          el('div', { class: 'tiny', text: 'A friend adds you with it. Nobody can find you without it.' }),
        ]),
        el('button', {
          class: 'btn btn--ghost btn--sm friend-code', type: 'button', id: 'friendCodeBtn',
          'aria-label': `Share your friend code, ${account.friendCode || ''}`,
          text: account.friendCode || '······',
          onclick: () => this.shareCode(),
        }),
      ]));
      card.appendChild(el('div', { class: 'stack account-actions' }, [
        action('Change password', () => this.changePassword()),
        action('Download your data', () => this.exportData()),
        action('Blocked runners', () => this.blockedList()),
        action('Sign out', () => this.signOut(), { id: 'signOutBtn' }),
        el('button', { class: 'btn btn--danger btn--block', type: 'button', id: 'deleteAccountBtn', text: 'Delete account', onclick: () => this.deleteAccount() }),
      ]));
      card.appendChild(el('p', { class: 'tiny account-links' }, [
        el('a', { href: Api.page('/privacy'), target: '_blank', rel: 'noopener', text: 'Privacy policy' }),
        el('span', { text: ' · ' }),
        el('a', { href: Api.page('/terms'), target: '_blank', rel: 'noopener', text: 'Terms' }),
        el('span', { text: ' · ' }),
        el('a', { href: Api.page('/support'), target: '_blank', rel: 'noopener', text: 'Support' }),
      ]));
    },

    shareCode() {
      const code = State.data.account && State.data.account.friendCode;
      if (!code) return;
      const text = `Race me on MILES — my friend code is ${code}`;
      if (navigator.share) {
        navigator.share({ text }).catch(() => {});
        return;
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(
          () => toast(`Friend code <b>${esc(code)}</b> copied`),
          () => toast(`Your friend code is <b>${esc(code)}</b>`));
        return;
      }
      toast(`Your friend code is <b>${esc(code)}</b>`);
    },

    /** A small form in the ask sheet: fields, a primary button, and Cancel. */
    form(options) {
      const body = $('#askBody');
      body.innerHTML = '';
      const error = el('p', { class: 'auth-message', role: 'alert', 'data-kind': 'error' });
      error.hidden = true;
      const done = () => UI().closeSheet('#askSheet');
      UI()._askDismiss = done;
      const submit = el('button', {
        class: 'btn grow ' + (options.danger ? 'btn--danger' : 'btn--primary'), type: 'submit', text: options.confirmLabel,
      });
      const form = el('form', { class: 'stack', novalidate: true }, [
        el('h3', { class: 'ask-title', text: options.title }),
        options.body ? el('p', { class: 'ask-body', text: options.body }) : null,
      ].concat(options.fields.map((f) => el('div', { class: 'form-field' }, [
        el('label', { class: 'field-label', for: f.input.id, text: f.label }), f.input,
      ]))).concat([
        error,
        el('div', { class: 'row', style: 'gap:var(--s-3);margin-top:var(--s-3)' }, [
          el('button', { class: 'btn grow', type: 'button', text: 'Cancel', onclick: done }),
          submit,
        ]),
      ]));
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        submit.disabled = true;
        error.hidden = true;
        try {
          await options.onSubmit();
          done();
        } catch (err) {
          error.textContent = err.message;
          error.hidden = false;
        } finally {
          submit.disabled = false;
        }
      });
      body.appendChild(form);
      UI().openSheet('#askSheet');
      if (options.fields[0]) {
        setTimeout(() => { if (!body.contains(document.activeElement)) options.fields[0].input.focus({ preventScroll: true }); }, 60);
      }
    },

    changePassword() {
      const current = el('input', { class: 'input', type: 'password', id: 'pwCurrent', autocomplete: 'current-password' });
      const next = el('input', { class: 'input', type: 'password', id: 'pwNext', autocomplete: 'new-password' });
      this.form({
        title: 'Change password',
        body: 'Every other phone signed in to this account is signed out.',
        confirmLabel: 'Change',
        fields: [{ label: 'Current password', input: current }, { label: 'New password · at least 8 characters', input: next }],
        onSubmit: async () => {
          await Api.post('/v1/me/password', { current: current.value, password: next.value }, { keepSession: true });
          toast('Password changed');
        },
      });
    },

    async exportData() {
      try {
        const data = await Api.get('/v1/me/export');
        const json = JSON.stringify(data, null, 2);
        const name = `miles-data-${new Date().toISOString().slice(0, 10)}.json`;
        const file = typeof File !== 'undefined' ? new File([json], name, { type: 'application/json' }) : null;
        // A phone shares the file to wherever you keep things; a browser downloads it.
        if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: 'Your MILES data' });
          return;
        }
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        const a = el('a', { href: url, download: name });
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        toast('Your data is downloading');
      } catch (err) {
        if (err && err.name === 'AbortError') return;      // the share sheet was closed
        toast(esc(err.message));
      }
    },

    async blockedList() {
      let blocked;
      try { blocked = (await Api.get('/v1/blocks')).blocked; } catch (err) { toast(esc(err.message)); return; }
      const body = $('#askBody');
      body.innerHTML = '';
      const done = () => UI().closeSheet('#askSheet');
      UI()._askDismiss = done;
      const rows = blocked.map((b) => el('div', { class: 'friend' }, [
        el('span', { class: 'friend-avatar', style: `--c:${M.Sync.ownerColor(b.id)}`, text: b.initials }),
        el('span', { class: 'person-name grow', text: b.name }),
        el('button', {
          class: 'btn btn--ghost btn--sm', type: 'button', text: 'Unblock',
          onclick: async () => {
            try {
              await Api.del('/v1/blocks/' + b.id);
              toast(`<b>${esc(b.name)}</b> unblocked`);
              M.Sync.refresh();
              this.blockedList();
            } catch (err) { toast(esc(err.message)); }
          },
        }),
      ]));
      body.appendChild(el('div', { class: 'stack' }, [
        el('h3', { class: 'ask-title', text: 'Blocked runners' }),
        el('p', { class: 'ask-body', text: blocked.length
          ? 'You do not see their runs or notices, and neither of you can add the other as a friend.'
          : 'Nobody. Block a runner from their name in the feed, a crew or your friends.' }),
      ].concat(rows).concat([
        el('button', { class: 'btn btn--block', type: 'button', text: 'Done', onclick: done }),
      ])));
      UI().openSheet('#askSheet');
    },

    signOut() {
      UI().confirm({
        title: 'Sign out?',
        body: State.data.outbox && State.data.outbox.length
          ? 'A run on this phone has not reached your account yet. Signing out now loses it.'
          : 'Your runs and ground stay on your account. Sign in on any phone to pick up where you left off.',
        confirmLabel: 'Sign out',
        danger: !!(State.data.outbox && State.data.outbox.length),
      }).then((ok) => { if (ok) Api.signOut(); });
    },

    deleteAccount() {
      const password = el('input', { class: 'input', type: 'password', id: 'deletePassword', autocomplete: 'current-password' });
      this.form({
        title: 'Delete your account?',
        body: 'Your runs, your ground, your crew notices and your friends are deleted for good. Ground you took goes back to whoever held it. If you captain a crew with others in it, the longest-standing of them takes over. A subscription is billed by Apple or Google — cancel it there too.',
        confirmLabel: 'Delete everything',
        danger: true,
        fields: [{ label: 'Your password, to confirm', input: password }],
        onSubmit: async () => {
          await Api.del('/v1/me', { password: password.value }, { keepSession: true });
          Api.forget();
          toast('Your account is deleted');
        },
      });
    },

    /* --- Reporting and blocking ------------------------------------------------ */

    /**
     * Reports something to the moderators. `type` is the server's: user,
     * crew, notice, run or claim.
     */
    report(type, id, what) {
      const body = $('#askBody');
      body.innerHTML = '';
      let reason = null;
      const done = () => UI().closeSheet('#askSheet');
      UI()._askDismiss = done;
      const note = el('textarea', { class: 'input', rows: '3', id: 'reportNote', maxlength: '500', placeholder: 'Anything that helps (optional)' });
      const send = el('button', { class: 'btn btn--primary grow', type: 'button', text: 'Send report', disabled: true });
      const reasons = REASONS.map(([key, label]) => el('button', {
        class: 'report-reason', type: 'button', 'aria-pressed': 'false', 'data-reason': key, text: label,
        onclick: (event) => {
          reason = key;
          body.querySelectorAll('.report-reason').forEach((b) => b.setAttribute('aria-pressed', String(b === event.currentTarget)));
          send.disabled = false;
        },
      }));
      send.addEventListener('click', async () => {
        if (!reason) return;
        send.disabled = true;
        try {
          await Api.post('/v1/reports', { type, id, reason, note: note.value.trim() || undefined });
          done();
          toast('Thanks. Reports are reviewed within 24 hours.');
        } catch (err) {
          send.disabled = false;
          toast(esc(err.message));
        }
      });
      body.appendChild(el('div', { class: 'stack' }, [
        el('h3', { class: 'ask-title', text: `Report ${what}` }),
        el('p', { class: 'ask-body', text: 'What is wrong with it?' }),
        el('div', { class: 'report-reasons', role: 'group', 'aria-label': 'Reason' }, reasons),
        el('div', { class: 'form-field' }, [el('label', { class: 'field-label', for: 'reportNote', text: 'Details' }), note]),
        el('div', { class: 'row', style: 'gap:var(--s-3);margin-top:var(--s-2)' }, [
          el('button', { class: 'btn grow', type: 'button', text: 'Cancel', onclick: done }),
          send,
        ]),
      ]));
      UI().openSheet('#askSheet');
    },

    /** Report or block a runner — from wherever their name appears. */
    personMenu(person, extra) {
      const options = extra || {};
      const body = $('#askBody');
      body.innerHTML = '';
      const done = () => UI().closeSheet('#askSheet');
      UI()._askDismiss = done;
      const isFriend = State.data.friends.some((f) => f.id === person.id);
      const buttons = [];
      if (options.run) {
        buttons.push(el('button', { class: 'btn btn--block', type: 'button', text: 'Report this run', onclick: () => this.report('run', options.run, 'this run') }));
      }
      buttons.push(el('button', { class: 'btn btn--block', type: 'button', text: `Report ${person.name}`, onclick: () => this.report('user', person.id, person.name) }));
      if (isFriend) {
        buttons.push(el('button', { class: 'btn btn--block', type: 'button', text: 'Remove friend', onclick: () => {
          done();
          State.removeFriend(person.id);
          toast(`<b>${esc(person.name)}</b> removed`);
        } }));
      }
      buttons.push(el('button', { class: 'btn btn--danger btn--block', type: 'button', text: `Block ${person.name}`, onclick: () => this.block(person) }));
      buttons.push(el('button', { class: 'btn btn--ghost btn--block', type: 'button', text: 'Cancel', onclick: done }));
      body.appendChild(el('div', { class: 'stack' }, [el('h3', { class: 'ask-title', text: person.name })].concat(buttons)));
      UI().openSheet('#askSheet');
    },

    block(person) {
      UI().confirm({
        title: `Block ${person.name}?`,
        body: 'You stop seeing their runs and notices, a friendship between you ends, and neither of you can add the other. They are not told.',
        confirmLabel: 'Block',
        danger: true,
      }).then(async (ok) => {
        if (!ok) return;
        try {
          await Api.post('/v1/blocks', { userId: person.id });
          State.data.friends = State.data.friends.filter((f) => f.id !== person.id);
          State.data.feed = (State.data.feed || []).filter((i) => i.whoId !== person.id);
          State.save();
          toast(`<b>${esc(person.name)}</b> blocked`);
          M.Sync.refresh();
        } catch (err) { toast(esc(err.message)); }
      });
    },

    /* --- Paying ------------------------------------------------------------------
       Purchases go through the App Store and Google Play, by way of
       RevenueCat (server/README.md). Until the store builds carry its SDK
       there is nothing on the phone that can take a payment, and the app
       says so rather than pretending. */
    purchase(planId) {
      const store = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Purchases;
      if (!store) {
        toast('Subscriptions open with the App Store and Google Play release. The free trial works now.');
        return Promise.resolve(false);
      }
      return store.purchaseStoreProduct({ product: { identifier: planId } })
        .then(() => M.Sync.pullMe().then(() => { State.save(); return true; }))
        .catch((err) => { if (err && !err.userCancelled) toast(esc(err.message || 'The purchase did not go through.')); return false; });
    },

    /** Cancelling is the store's to do; this opens the right page. */
    manageSubscription() {
      const ios = window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform() === 'ios';
      window.open(ios ? 'https://apps.apple.com/account/subscriptions' : 'https://play.google.com/store/account/subscriptions', '_blank', 'noopener');
    },
  };

  M.Account = Account;
})(window.MILES);
