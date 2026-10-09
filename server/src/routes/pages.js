'use strict';

/* The pages the stores ask for, served by the API itself so they always
   describe the service that is actually running: the privacy policy, the
   terms (which double as the end-user licence), support, and a way to delete
   an account from a browser — Google Play requires that one to work without
   the app. Plain HTML: no scripts, no trackers, no fonts to fetch. */

const v = require('../validate');
const { reply } = require('../http');
const auth = require('../auth');
const { deleteAccount } = require('../services/accounts');

const UPDATED = '9 October 2026';

const esc = (s) => String(s === undefined || s === null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function page(config, title, body) {
  const app = esc(config.appName);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ${app}</title>
<style>
  :root { --ink: #0e0d0c; --paper: #f4efe7; --mid: #5d574f; --line: #d9d0c1; --flame: #c2410c; color-scheme: light dark; }
  @media (prefers-color-scheme: dark) { :root { --ink: #f4efe7; --paper: #0e0d0c; --mid: #c9c1b5; --line: #3a3631; --flame: #ff9a6c; } }
  html { background: var(--paper); color: var(--ink); }
  body { margin: 0 auto; max-width: 720px; padding: 32px 16px 64px; font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
  header { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; border-bottom: 1px solid var(--line); padding-bottom: 12px; margin-bottom: 24px; }
  .mark { font: italic 800 28px/1 "Barlow Condensed", "Arial Narrow", sans-serif; letter-spacing: -0.01em; color: var(--ink); text-decoration: none; }
  nav a { color: var(--mid); margin-left: 14px; font-size: 14px; }
  h1 { font-size: 30px; line-height: 1.2; margin: 0 0 6px; }
  h2 { font-size: 19px; margin: 32px 0 8px; }
  p, li { color: var(--ink); }
  .muted { color: var(--mid); font-size: 14px; }
  a { color: var(--flame); }
  form { display: grid; gap: 14px; margin: 24px 0; padding: 20px; border: 1px solid var(--line); border-radius: 12px; }
  label { display: grid; gap: 6px; font-weight: 600; font-size: 15px; }
  input[type=email], input[type=password] { font: inherit; padding: 12px; border-radius: 8px; border: 1px solid var(--line); background: transparent; color: inherit; }
  .check { display: flex; gap: 10px; align-items: flex-start; font-weight: 400; }
  .check input { margin-top: 5px; width: 18px; height: 18px; }
  button { font: inherit; font-weight: 700; padding: 13px 18px; border: 0; border-radius: 10px; background: #b91c1c; color: #fff; cursor: pointer; min-height: 48px; }
  .note { padding: 12px 14px; border-radius: 10px; border: 1px solid var(--line); }
  .error { border-color: #b91c1c; }
  table { border-collapse: collapse; width: 100%; font-size: 15px; }
  td, th { text-align: left; vertical-align: top; padding: 8px 10px 8px 0; border-bottom: 1px solid var(--line); }
</style>
</head>
<body>
<header><a class="mark" href="/">${app}</a><nav><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/support">Support</a></nav></header>
<main>
${body}
</main>
</body>
</html>`;
}

function operator(config) {
  return config.companyName ? esc(config.companyName) : `the operator of ${esc(config.appName)}`;
}

function contact(config) {
  return config.contactEmail
    ? `<a href="mailto:${esc(config.contactEmail)}">${esc(config.contactEmail)}</a>`
    : 'the contact address on the store listing';
}

function privacy(config) {
  const app = esc(config.appName);
  return `<h1>Privacy policy</h1>
<p class="muted">Last updated ${UPDATED}</p>
<p>${app} is a running app: you record runs, close loops to claim ground on a shared map, race friends live and run with a crew. This page says what that means for your data. ${app} is run by ${operator(config)}, who decides how this data is used. Questions go to ${contact(config)}.</p>

<h2>What we collect</h2>
<table>
<tr><th>What</th><th>Why</th></tr>
<tr><td>Your email address and a password (stored only as a one-way hash)</td><td>To give you an account you can sign in to on any phone, and to send a code if you forget the password.</td></tr>
<tr><td>Your runner name</td><td>Shown to other runners: on the map, in crews, in races and to your friends.</td></tr>
<tr><td>Your runs: the route (GPS positions), start time, distance, time, pace, splits and climb</td><td>To keep your history, work out quests and ranks, count toward your crew's weekly mission, and show your friends what you ran.</td></tr>
<tr><td>Ground you claim: the loop you closed and what is still yours of it</td><td>The shared map is the game.</td></tr>
<tr><td>Your crew: the crew's name, tagline, photo, meeting time and place, notices, members and join requests</td><td>To run the crew.</td></tr>
<tr><td>Friends, blocks, kudos and reports you make</td><td>To make those features work, and to act on reports.</td></tr>
<tr><td>Your position during a race</td><td>Sent live to the other runners in that race only. It is not stored; the run you save afterwards is.</td></tr>
<tr><td>What you have bought (plan, store, renewal date)</td><td>To unlock what you paid for. Payments are taken by Apple or Google; we never see card details.</td></tr>
<tr><td>Your IP address</td><td>Used in memory to stop abuse (for example, limiting sign-in attempts). Not stored with your account.</td></tr>
</table>

<h2>Location</h2>
<p>${app} uses your phone's location only while you are recording a run you started, and when you ask it to centre the map on you. A run keeps recording with the screen off; while it does, your phone shows a notification saying so. ${app} never tracks you when no run is being recorded.</p>

<h2>Who sees what</h2>
<ul>
<li><b>Everyone using ${app}:</b> your runner name, the ground you hold on the map (the shape of your loops), and the crew you are in.</li>
<li><b>Your crew and anyone viewing it:</b> your runner name, your role and how far you ran this week.</li>
<li><b>Your friends:</b> your runs from the last 30 days. The first and last 200 metres of every route are cut off, so where you start and finish — usually your front door — is not shown.</li>
<li><b>Runners in a race with you:</b> your live distance, pace and position, for that race.</li>
</ul>
<p>Nobody can find you by searching: a friend adds you with the code you give them. You can block anyone, which ends a friendship and hides their runs and notices from you.</p>

<h2>Who we share it with</h2>
<p>We do not sell your data and there is no advertising in ${app}. To run the service we use providers who process data for us under contract: our hosting and database provider, an email provider to send password codes, RevenueCat, which handles subscriptions between the app and the App Store or Google Play, and Esri, which serves the map: your phone asks it for the part of the map on your screen, so it sees that area and your IP address. Choosing the <b>Drawn</b> map in the app stops those requests. We disclose data to authorities only where the law requires it.</p>

<h2>How long we keep it</h2>
<p>Until you delete your account. Deleting it removes your profile, runs, ground, crew notices, friends and blocks straight away; ground your loops had taken from other runners goes back to them. Backups are overwritten within 30 days. Records of purchases are kept as long as tax and consumer law requires.</p>

<h2>Your rights</h2>
<ul>
<li><b>See and take your data:</b> in the app, <b>Download your data</b> (on the You screen, in the Account card) gives you everything as one file.</li>
<li><b>Correct it:</b> change your runner name in the app; delete any run.</li>
<li><b>Delete it:</b> <b>Delete account</b> in the same card, or <a href="/delete-account">on the web</a>.</li>
<li><b>Ask us anything</b> about your data at ${contact(config)}. We answer within 30 days.</li>
</ul>

<h2>Children</h2>
<p>${app} is for people aged 14 and over. If you believe a younger child has an account, tell us and we will delete it.</p>

<h2>Security</h2>
<p>Passwords are stored as scrypt hashes, sign-in sessions as hashes of random tokens, and everything travels over HTTPS. No system is perfect; if something goes wrong that affects you, we will tell you.</p>

<h2>Changes</h2>
<p>If this policy changes in a way that matters, the app will tell you before it takes effect. The date at the top says when it last changed.</p>`;
}

function terms(config) {
  const app = esc(config.appName);
  return `<h1>Terms of use</h1>
<p class="muted">Last updated ${UPDATED}</p>
<p>These terms are the agreement between you and ${operator(config)} for using ${app}. By making an account you accept them. They are also the licence for the app itself.</p>

<h2>Your account</h2>
<p>You must be 14 or older. Keep your password to yourself; you are responsible for what happens on your account. One account per person.</p>

<h2>Run safely</h2>
<p>Running carries risk. Look where you are going, obey traffic rules, and stay off private property and anywhere you are not allowed to be — no plot of ground on a map is worth it. Do not use the app in a way that endangers you or anyone else. ${app} gives no medical or training advice.</p>

<h2>Play fair</h2>
<p>The map and the races only mean something if they are real. Do not fake runs: no spoofed GPS, no vehicles, no running someone else's phone. We may remove runs, ground or accounts that are not genuine.</p>

<h2>Community rules</h2>
<p>We do not tolerate objectionable content or abusive users. Do not post — as a runner name, crew name, tagline, notice, photo or plot name — anything that:</p>
<ul>
<li>harasses, threatens or bullies anyone, or is hateful toward any group;</li>
<li>is sexual, violent or graphic;</li>
<li>impersonates someone else, or shares anyone's private information;</li>
<li>is spam or advertising, or breaks the law.</li>
</ul>
<p>Every runner can report content and block other runners from inside the app. We review reports within 24 hours, remove content that breaks these rules, and suspend or remove accounts that break them, without notice where necessary.</p>

<h2>Your content</h2>
<p>What you post stays yours. You give us the right to store it and show it to other runners as the app does, for as long as it is on ${app}.</p>

<h2>Subscriptions</h2>
<p>Supporter and Pro are subscriptions sold through the App Store or Google Play and billed by them. They renew automatically until you cancel, which you do in your store account's subscription settings at least 24 hours before renewal. Refunds are handled by Apple or Google under their policies. The free Pro trial in the app takes no payment and simply ends. Nothing paid affects how ground is claimed or held.</p>

<h2>The service</h2>
<p>We work to keep ${app} running and your data safe, but provide it as it is, without guarantees that it will always be available or error-free. To the extent the law allows, we are not liable for indirect losses, and our total liability is limited to what you paid us in the twelve months before the claim. Nothing here limits rights you have by law that cannot be limited.</p>

<h2>Ending</h2>
<p>You can delete your account at any time. We may suspend or end accounts that break these terms.</p>

<h2>Changes and contact</h2>
<p>If these terms change in a way that matters, the app will tell you before they take effect. Questions: ${contact(config)}.</p>`;
}

function support(config) {
  const app = esc(config.appName);
  return `<h1>Support</h1>
<p>Write to ${contact(config)} — a person reads every message.</p>
<h2>Forgot your password</h2>
<p>On the sign-in screen, choose <b>Forgot password</b>. We email you a six-digit code; enter it in the app with your new password.</p>
<h2>Report someone or something</h2>
<p>Open the runner, crew or notice in the app and choose <b>Report</b>. You can also <b>Block</b> a runner, which ends a friendship and hides their runs and notices from you. Reports are reviewed within 24 hours.</p>
<h2>Subscriptions</h2>
<p>Cancel or change a subscription in your App Store or Google Play account settings. Restoring a purchase on a new phone: sign in to the same ${app} account.</p>
<h2>Your data</h2>
<p>On the You screen, the Account card's <b>Download your data</b> gives you everything we hold about you. To delete your account, use <b>Delete account</b> in the same card, or <a href="/delete-account">delete it on the web</a>.</p>`;
}

function deleteForm(config, message) {
  const app = esc(config.appName);
  return `<h1>Delete your ${app} account</h1>
<p>This deletes your account and everything in it, at once: your profile, every run, the ground you hold, your crew notices, friends and blocks. Ground your loops had taken from other runners goes back to them. If you captain a crew with other runners in it, the longest-standing of them becomes captain. It cannot be undone.</p>
<p>A subscription is billed by Apple or Google, so cancel it in your store account too — deleting the account does not stop the store charging.</p>
<p class="muted">You can also do this in the app: <b>Delete account</b>, in the Account card on the You screen. Prefer to ask? Write to ${contact(config)} from the address on the account.</p>
${message ? `<p class="note error">${esc(message)}</p>` : ''}
<form method="post" action="/delete-account">
  <label>Email<input type="email" name="email" autocomplete="username" required></label>
  <label>Password<input type="password" name="password" autocomplete="current-password" required></label>
  <label class="check"><input type="checkbox" name="confirm" value="yes" required><span>I understand this deletes my account and everything in it, permanently.</span></label>
  <button type="submit">Delete my account</button>
</form>`;
}

module.exports = function pageRoutes(router, app) {
  const { config, limiter } = app;

  router.get('/healthz', { auth: false }, async (ctx) => {
    await ctx.db.one('select 1 as ok');
    return { ok: true };
  });

  router.get('/', { auth: false }, async () => reply.html(page(config, config.appName,
    `<h1>${esc(config.appName)}</h1><p>The ${esc(config.appName)} service. Get the app from the App Store or Google Play.</p>
     <p><a href="/privacy">Privacy policy</a> · <a href="/terms">Terms of use</a> · <a href="/support">Support</a> · <a href="/delete-account">Delete an account</a></p>`)));

  router.get('/privacy', { auth: false }, async () => reply.html(page(config, 'Privacy policy', privacy(config))));
  router.get('/terms', { auth: false }, async () => reply.html(page(config, 'Terms of use', terms(config))));
  router.get('/support', { auth: false }, async () => reply.html(page(config, 'Support', support(config))));
  router.get('/delete-account', { auth: false }, async () => reply.html(page(config, 'Delete your account', deleteForm(config))));

  router.post('/delete-account', { auth: false, limit: 8 * 1024 }, async (ctx) => {
    const { body, db, ip } = ctx;
    const again = (message, status) => reply.html(page(config, 'Delete your account', deleteForm(config, message)), status || 400);
    if (!limiter.take('web-delete:' + ip, 10, 60 * 60 * 1000)) return again('Too many tries from here. Try again in an hour.', 429);
    if (body.confirm !== 'yes') return again('Tick the box to confirm you understand this is permanent.');
    const norm = v.emailNorm(body.email);
    if (!limiter.take('web-delete:' + norm, 5, 60 * 60 * 1000)) return again('Too many tries for that account. Try again in an hour.', 429);
    const user = norm ? await db.one('select * from users where email_norm = $1', [norm]) : null;
    const ok = user
      ? await auth.verifyPassword(String(body.password || ''), user.password_hash)
      : (await auth.hashPassword('not a user', config.scryptN), false);
    if (!ok) return again('That email and password do not match.', 401);
    await deleteAccount(db, user.id);
    return reply.html(page(config, 'Account deleted',
      `<h1>Your account is deleted</h1><p>Everything in it is gone. If you had a subscription, remember to cancel it in your App Store or Google Play account.</p>`));
  });
};

// The pages render from config alone, which is how the tests read them.
module.exports.render = { privacy, terms, support, deleteForm, page };
