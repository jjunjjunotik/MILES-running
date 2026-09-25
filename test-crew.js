// The captain's crew screen, which was nine things in one card with type too
// small to read. What it is now: one job per block, in the order a crew is
// lived; the thing waiting on the captain first in the manage sheet; nothing
// shown twice; and the small pieces that used to come apart kept together.
//   node test-crew.js
// Needs Playwright, which the app itself does not: `npm i playwright`, or run
// with NODE_PATH pointing at an install that has it.
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errors = [];
  let bad = 0;
  const ok = (label, cond, extra) => {
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${!cond && extra !== undefined ? '  → ' + extra : ''}`);
    if (!cond) bad++;
  };
  const fresh = async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
    await page.goto('file://' + path.resolve(__dirname, 'index.html'));
    await page.waitForTimeout(800);
    return page;
  };

  // --- 1. The captain's screen: one job per block --------------------------
  let page = await fresh();
  await page.evaluate(() => MILES.UI.go('crew'));
  await page.waitForTimeout(300);
  ok('"+ Start" is offered while you have no crew',
    await page.evaluate(() => !document.querySelector('#createCrewBtn').hidden));

  await page.evaluate(() => {
    const { State, Pro, Crew } = MILES;
    Pro.startTrial(State.data);
    const r = State.crewAction((st) => Crew.create(st, {
      name: 'Han River Pacers', tagline: 'Early loops, long talks, no one left behind.',
      days: ['Tue', 'Thu', 'Sat'], time: '06:30', spot: 'Yeouido Park gate 2', openJoin: false,
    }));
    r.crew.requests.slice(0, 2).map((q) => q.id)
      .forEach((id) => State.crewAction((st) => Crew.approve(st, r.crew.id, id)));
    State.crewAction((st) => Crew.setMission(st, r.crew.id, Crew.missionOptions(Crew.mine(State.data))[0].key));
    State.crewAction((st) => Crew.postNotice(st, r.crew.id, 'Saturday long run moves to 7:00 — meet at gate 2.'));
    MILES.UI.go('crew');
  });
  await page.waitForTimeout(400);

  const screen = await page.evaluate(() => {
    const host = document.querySelector('#myCrew');
    const blocks = [...host.children];
    return {
      first: blocks[0] ? blocks[0].className : '',
      titles: blocks.slice(1).map((b) => {
        const t = b.querySelector(':scope > .section-head .section-title');
        return t ? t.textContent.trim() : '(untitled ' + b.className + ')';
      }),
      gaps: blocks.slice(1).map((b, i) => Math.round(b.getBoundingClientRect().top - blocks[i].getBoundingClientRect().bottom)),
      nested: host.querySelectorAll('.card .card').length,
      start: document.querySelector('#createCrewBtn').hidden,
      role: (host.querySelector('.crew-hero .role-tag') || {}).textContent,
      manage: [...host.querySelectorAll('.crew-hero button')].map((b) => b.textContent.trim()),
    };
  });
  ok('the crew itself comes first', /\bcrew-hero\b/.test(screen.first), screen.first);
  ok('then one titled block per job, in the order a week is lived',
    JSON.stringify(screen.titles) === JSON.stringify(['This week', 'The crew', 'Notice board', 'Crew territory']),
    JSON.stringify(screen.titles));
  ok('every block stands clear of the one above it', screen.gaps.every((g) => g >= 24), JSON.stringify(screen.gaps));
  ok('no card sits inside another card', screen.nested === 0, screen.nested);
  ok('"+ Start" is gone once you are in a crew — it could only say "leave first"', screen.start === true);
  ok('the captain is told they are the captain', screen.role === 'Captain', screen.role);
  ok('the way into the crew says how many are waiting',
    screen.manage.length === 1 && screen.manage[0] === 'Manage crew · 1 waiting', JSON.stringify(screen.manage));

  // --- 2. The manage sheet: what is waiting first, nothing twice -----------
  await page.evaluate(() => MILES.UI.openCrewSheet(MILES.Crew.mine(MILES.State.data).id));
  await page.waitForTimeout(400);
  const sheet = await page.evaluate(() => {
    const body = document.querySelector('#crewSheetBody');
    return {
      sub: (body.querySelector('.sheet-sub') || {}).textContent,
      sections: [...body.querySelectorAll('.sheet-section-title')].map((t) => t.textContent.trim()),
      repeats: body.querySelectorAll('.mission, .kpis, .crew-meet').length,
      metas: [...body.querySelectorAll('.person-meta')].map((m) => m.textContent.trim()),
      labels: [...body.querySelectorAll('.request .icon-btn')].map((b) => b.getAttribute('aria-label')),
      actions: [...body.querySelectorAll('.sheet-actions button')].map((b) => b.textContent.trim()),
    };
  });
  ok('the head says your part in it, the tier and the headcount',
    /^Captain · Tier \d+ \w+ · 3 runners$/.test(sheet.sub), sheet.sub);
  ok('join requests come first, because they are what is waiting',
    JSON.stringify(sheet.sections) === JSON.stringify(['Join requests · 1', 'Notice board · 1', 'Members · 3']),
    JSON.stringify(sheet.sections));
  ok('the mission, numbers and schedule are not repeated from the screen behind',
    sheet.repeats === 0, sheet.repeats);
  ok('no line of detail starts or ends on a dangling "·"',
    sheet.metas.length > 0 && sheet.metas.every((m) => !/^·|·$/.test(m)), JSON.stringify(sheet.metas));
  ok('approve and decline name who they are for',
    sheet.labels.length === 2 && /^Approve \S/.test(sheet.labels[0]) && /^Decline \S/.test(sheet.labels[1]),
    JSON.stringify(sheet.labels));
  ok('the captain\'s own actions close the sheet',
    JSON.stringify(sheet.actions) === JSON.stringify(['Edit crew', 'Disband']), JSON.stringify(sheet.actions));

  // --- 3. The forms: a label belongs to the field under it -----------------
  const form = await page.evaluate(() => {
    const id = MILES.Crew.mine(MILES.State.data).id;
    MILES.UI.openCrewSheet(id);
    MILES.UI.editCrew(id);
    const body = document.querySelector('#crewSheetBody');
    const fields = [...body.querySelectorAll('.form-field')];
    return {
      loose: [...body.querySelectorAll('.field-label')].filter((l) => !l.parentElement.classList.contains('form-field')).length,
      spacing: fields.map((f, i) => ({
        own: Math.round(f.children[1].getBoundingClientRect().top - f.children[0].getBoundingClientRect().bottom),
        above: i ? Math.round(f.getBoundingClientRect().top - fields[i - 1].getBoundingClientRect().bottom) : null,
      })),
    };
  });
  ok('no label is left loose in the form', form.loose === 0, form.loose);
  ok('every label sits closer to its own field than to the one above',
    form.spacing.length >= 6 && form.spacing.every((f) => f.above === null || f.own < f.above),
    JSON.stringify(form.spacing));

  // --- 4. The mission picker: name and reward on a line, the ask under it --
  const picker = await page.evaluate(() => {
    MILES.UI.openMissionPicker(MILES.Crew.mine(MILES.State.data).id);
    return [...document.querySelectorAll('#crewSheetBody .mission-option')].map((o) => {
      const name = o.querySelector('.mission-option-name').getBoundingClientRect();
      const xp = o.querySelector('.mission-xp').getBoundingClientRect();
      const note = o.querySelector('.mission-note').getBoundingClientRect();
      return { sameLine: Math.abs(name.top - xp.top) < 6, below: note.top >= name.bottom - 1 };
    });
  });
  ok('three missions to pick from', picker.length === 3, picker.length);
  ok('each shows its name and reward on one line and the ask across the card under them',
    picker.every((o) => o.sameLine && o.below), JSON.stringify(picker));

  // --- 5. A toast is one run of text ----------------------------------------
  const toast = await page.evaluate(() => {
    document.querySelectorAll('#toasts > *').forEach((t) => t.remove());
    MILES.UI.toast('Mission cleared — <b>Han River Pacers</b> +280 crew XP', 'reward');
    const t = document.querySelector('#toasts .toast:last-child');
    return { kids: t.children.length, text: t.firstElementChild && t.firstElementChild.classList.contains('toast-text') };
  });
  ok('a toast with a name in it reads as one line of text, not a row of columns',
    toast.kids === 1 && toast.text, JSON.stringify(toast));
  await page.close();

  // --- 6. A member reads the board and the roster, not the same card twice --
  page = await fresh();
  const member = await page.evaluate(() => {
    const { State, Crew } = MILES;
    const open = Crew.nearby(State.data).find((c) => c.openJoin);
    State.crewAction((st) => Crew.join(st, open.id));
    MILES.UI.go('crew');
    MILES.UI.openCrewSheet(open.id);
    const body = document.querySelector('#crewSheetBody');
    return {
      sub: (body.querySelector('.sheet-sub') || {}).textContent,
      sections: [...body.querySelectorAll('.sheet-section-title')].map((t) => t.textContent.replace(/ · \d+$/, '')),
      repeats: body.querySelectorAll('.mission, .kpis, .crew-meet').length,
      actions: [...body.querySelectorAll('.sheet-actions button')].map((b) => b.textContent.trim()),
    };
  });
  ok('a member is told they are a member', /^Member · /.test(member.sub), member.sub);
  ok('a member sees the board and the roster, and no requests',
    JSON.stringify(member.sections) === JSON.stringify(['Notice board', 'Members']), JSON.stringify(member.sections));
  ok('nor the mission, numbers or schedule a second time', member.repeats === 0, member.repeats);
  ok('and can leave', JSON.stringify(member.actions) === JSON.stringify(['Leave crew']), JSON.stringify(member.actions));
  await page.close();

  // --- 7. Looking in from outside: the crew's whole profile, counted right --
  page = await fresh();
  const outside = await page.evaluate(() => {
    const { State, Crew } = MILES;
    const crew = Crew.nearby(State.data)[0];
    const read = (n) => {
      crew.missionsDone = n;
      MILES.UI.openCrewSheet(crew.id);
      const body = document.querySelector('#crewSheetBody');
      const kpis = [...body.querySelectorAll('.sheet-kpis .stat-label')].map((l) => l.textContent);
      return { note: (body.querySelector('.sheet-note') || {}).textContent, label: kpis[kpis.length - 1], shown: body.querySelectorAll('.kpis, .crew-meet').length };
    };
    return { one: read(1), two: read(2) };
  });
  ok('an outsider gets the numbers and the schedule', outside.one.shown === 2, outside.one.shown);
  ok('one mission is "1 mission cleared"', / 1 mission cleared\.$/.test(outside.one.note) && outside.one.label === 'Mission',
    JSON.stringify(outside.one));
  ok('two are "2 missions cleared"', / 2 missions cleared\.$/.test(outside.two.note) && outside.two.label === 'Missions',
    JSON.stringify(outside.two));
  await page.close();

  await browser.close();
  errors.forEach((e) => console.log(e));
  const failed = bad + errors.length;
  console.log(failed === 0 ? 'THE CREW SCREEN HOLDS TOGETHER' : `${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})();
