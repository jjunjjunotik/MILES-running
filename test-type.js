// The floor under the type. A screen full of 10 and 11px labels is legible on
// a desktop browser at 100% and unreadable on the phone it was drawn for, and
// nothing else in the suite would notice — contrast passes at any size, and a
// control can be perfectly hittable with an illegible label on it.
//   node test-type.js
// Needs Playwright, which the app itself does not: `npm i playwright`, or run
// with NODE_PATH pointing at an install that has it.
//
// The floor is 11px and it applies to text a person reads. It is deliberately
// below the 12px the design uses, so that a considered exception does not fail
// the run while an accident — a hard-coded 8px badge, a class that lost its
// font-size — does.
//
// The captain's crew screens are held to 12px, the design's own smallest size,
// with no exceptions: they were rebuilt because their type was too small to
// read, and this is what keeps them from drifting back.
const { chromium } = require('playwright');
const path = require('path');

const FLOOR = 11;
const CREW_FLOOR = 12;

const measure = (floor) => `(() => {
  const root = document.querySelector('.sheet-scrim:not([hidden])')
    || document.querySelector('.screen[data-active="true"]');
  const out = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walk.nextNode())) {
    const text = n.textContent.trim();
    if (!text) continue;
    const el = n.parentElement;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const size = parseFloat(cs.fontSize);
    if (size + 0.01 < ${floor}) {
      out.push({ size: Math.round(size * 10) / 10, cls: el.className || el.tagName, text: text.slice(0, 30) });
    }
  }
  return out;
})()`;

// A captain's crew with a roster to manage, a mission running and a notice up:
// the state the crew screens are busiest in, and the one they were cramped in.
// Returns the crew's id, founding it the first time it is asked for.
const CAPTAIN = `(() => {
  const { State, Pro, Crew } = MILES;
  if (!Crew.mine(State.data)) {
    Pro.startTrial(State.data);
    const r = State.crewAction((st) => Crew.create(st, {
      name: 'Han River Pacers', tagline: 'Early loops, long talks, no one left behind.',
      days: ['Tue', 'Thu', 'Sat'], time: '06:30', spot: 'Yeouido Park gate 2', openJoin: false,
    }));
    r.crew.requests.slice(0, 2).forEach((q) => State.crewAction((st) => Crew.approve(st, r.crew.id, q.id)));
    State.crewAction((st) => Crew.setMission(st, r.crew.id, Crew.missionOptions(Crew.mine(State.data))[0].key));
    State.crewAction((st) => Crew.postNotice(st, r.crew.id, 'Saturday long run moves to 7:00 — meet at gate 2.'));
  }
  return Crew.mine(State.data).id;
})()`;

const STOPS = [
  ['home', `MILES.UI.go('home')`],
  ['crew', `MILES.UI.go('crew')`],
  ['territory', `MILES.UI.go('territory')`],
  ['quests', `MILES.UI.go('quests')`],
  ['profile', `MILES.UI.go('profile')`],
  ['feed', `MILES.UI.go('feed')`],
  ['soloSheet', `MILES.UI.openSheet('#soloSheet')`],
  ['duoSheet', `MILES.UI.openRaceLobby()`],
  ['proSheet', `MILES.UI.openPro()`],
  ['crewCreate', `MILES.Pro.startTrial(MILES.State.data); MILES.UI.openCreateCrew()`, CREW_FLOOR],
  ['crewCaptain', `${CAPTAIN}; MILES.UI.go('crew')`, CREW_FLOOR],
  ['crewSheet', `MILES.UI.openCrewSheet(${CAPTAIN})`, CREW_FLOOR],
  ['crewMission', `MILES.UI.openMissionPicker(${CAPTAIN})`, CREW_FLOOR],
  ['crewMember', `(() => { const id = ${CAPTAIN}; MILES.UI.openCrewSheet(id); MILES.UI.manageMember(id, MILES.Crew.mine(MILES.State.data).members.find((m) => m.id !== 'me').id); })()`, CREW_FLOOR],
  ['crewEdit', `(() => { const id = ${CAPTAIN}; MILES.UI.openCrewSheet(id); MILES.UI.editCrew(id); })()`, CREW_FLOOR],
  ['crewHandOver', `(() => { const id = ${CAPTAIN}; MILES.UI.openCrewSheet(id); MILES.UI.chooseSuccessor(id); })()`, CREW_FLOOR],
];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await page.goto('file://' + path.resolve(__dirname, 'index.html'));
  await page.waitForTimeout(1000);

  let bad = 0, smallest = Infinity, checked = 0;
  for (const [name, open, floor = FLOOR] of STOPS) {
    await page.evaluate(`document.querySelectorAll('.sheet-scrim').forEach(s => s.hidden = true)`);
    await page.evaluate(open);
    await page.waitForTimeout(450);
    const rows = await page.evaluate(measure(floor));
    for (const r of rows) {
      bad++;
      smallest = Math.min(smallest, r.size);
      console.log(`  TOO SMALL ${name.padEnd(12)} ${r.size}px (floor ${floor})  .${r.cls}  "${r.text}"`);
    }
    checked++;
  }

  await browser.close();
  console.log(bad === 0
    ? `NOTHING RENDERS BELOW ${FLOOR}px, NOR BELOW ${CREW_FLOOR}px ON A CAPTAIN'S CREW SCREEN (${checked} screens and sheets)`
    : `${bad} runs of text below their floor, smallest ${smallest}px`);
  process.exit(bad === 0 ? 0 : 1);
})();
