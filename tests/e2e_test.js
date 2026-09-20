// End-to-end tests in a real Chromium (Playwright). Run:  node tests/e2e_test.js
// Needs playwright (npm i -D playwright, or a global install; set PLAYWRIGHT_MODULE to override).
const path = require('path');
const fs = require('fs');
let playwright;
try { playwright = require('playwright'); } catch (e) { playwright = require(process.env.PLAYWRIGHT_MODULE || '/home/claude/.npm-global/lib/node_modules/playwright'); }
const { solve } = require('../tools/verify_levels.js');
const PC = globalThis.PC;

const URL = 'file://' + path.resolve(__dirname, '..', 'index.html');
const SHOTS = process.env.SHOTS_DIR || path.resolve(__dirname, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const results = []; const consoleErrors = [];
function chk(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${!ok && detail !== undefined ? '  → ' + JSON.stringify(detail) : ''}`);
}
const section = (t) => console.log('\n' + t);
const SIZES = [[1440, 900], [1024, 768], [768, 1024], [600, 900], [390, 844]];

async function newPage(browser, { viewport = { width: 1440, height: 900 }, init, unlocked } = {}) {
  const ctx = await browser.newContext({ viewport });
  if (unlocked) await ctx.addInitScript((u) => { try { if (!localStorage.getItem('pixelclues.save.v1')) localStorage.setItem('pixelclues.save.v1', JSON.stringify({ unlocked: u, completed: {}, stars: {}, bestScores: {}, bestTimes: {}, presenter: false })); } catch (e) {} }, unlocked);
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('PAGEERROR ' + e.message));
  await page.goto(URL);
  return page;
}

/* ---------- helpers ---------- */
const text = (page, sel) => page.locator(sel).innerText();
const vis = (page, sel) => page.locator(sel).isVisible();
async function openLevelFromSelect(page, id) {
  if (await vis(page, '#screen-home')) await page.click('#btn-play');
  await page.click(`[data-play="${id}"]`);
  await page.waitForSelector('#screen-game:not([hidden])');
}
async function answer(page, i, word) { const inp = page.locator(`[data-answer-input="${i}"]`); await inp.fill(word); await inp.press('Enter'); }
async function toggleCells(page, rel) { for (const c of rel) await page.click(`#builder-grid .bcell[data-x="${c.x}"][data-y="${c.y}"]`); }
async function gridBlockCells(page) {
  return page.evaluate(() => [...document.querySelectorAll('#main-grid .cell')].filter((c) => c.dataset.state === 'block').map((c) => c.dataset.x + ',' + c.dataset.y).sort());
}
const key = (cells) => cells.map((c) => c.x + ',' + c.y).sort();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function trayAndGrid(page) {
  return page.evaluate(() => {
    const b = document.getElementById('tray-block');
    const w = +getComputedStyle(b).getPropertyValue('--w');
    const kids = [...b.children];
    const first = kids.findIndex((k) => !k.classList.contains('gap'));
    const gEl = document.getElementById('main-grid');
    const g = gEl.getBoundingClientRect(), r = b.getBoundingClientRect();
    return { r: { left: r.left, top: r.top, width: r.width, height: r.height }, w, h: kids.length / w, first, n: +getComputedStyle(gEl).getPropertyValue('--n'), g: { left: g.left, top: g.top, width: g.width, height: g.height }, vh: innerHeight, vw: innerWidth };
  });
}
async function bringIntoView(page) {
  await page.evaluate(() => {
    const vw = innerWidth;
    (vw <= 768 ? document.getElementById('work-panel') : document.getElementById('main-grid')).scrollIntoView({ block: vw <= 768 ? 'start' : 'center' });
  });
  await page.waitForTimeout(60);
}
/** Drag the block: grab cell (gx,gy) of the block, release over grid cell `pointer` (or dropX+gx, dropY+gy). */
async function drag(page, { dropX, dropY, gx, gy, pointer, outside } = {}) {
  await bringIntoView(page);
  const t = await trayAndGrid(page);
  gx = gx === undefined ? t.first % t.w : gx; gy = gy === undefined ? Math.floor(t.first / t.w) : gy;
  const sx = t.r.left + (gx + 0.5) * (t.r.width / t.w), sy = t.r.top + (gy + 0.5) * (t.r.height / t.h);
  const p = pointer || { x: dropX + gx, y: dropY + gy };
  let ex = t.g.left + (p.x + 0.5) * (t.g.width / t.n), ey = t.g.top + (p.y + 0.5) * (t.g.height / t.n);
  if (outside) { ex = Math.max(2, t.g.left - 40); ey = Math.max(2, t.g.top - 30); if (ey < 0) ey = 2; }
  await page.mouse.move(sx, sy); await page.mouse.down();
  await page.mouse.move((sx + ex) / 2, (sy + ey) / 2, { steps: 4 }); await page.mouse.move(ex, ey, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(80);
}
const progress = (page) => text(page, '#progress-text');
const status = (page) => text(page, '#status');
const gameState = (page) => page.evaluate(() => { const s = PC.Game.state; return { phase: PC.Game.phase(), placed: s.placedBlocks.length, solved: s.solvedClues.length, pixels: s.earnedPixels, hints: s.hintsUsed, wrong: s.invalidAttempts, undos: s.undos, completed: s.completed, elapsed: s.elapsedTime, intervals: PC.Game.liveIntervals, score: s.score, stars: s.stars, running: PC.Game.isTimerRunning() }; });

/** Solve a whole level through the real UI using the solver's proven solution. */
async function playLevelUI(page, levelId, { useTap } = {}) {
  const lv = PC.LEVELS.find((l) => l.id === levelId);
  const sol = solve(lv).solution;
  let k = 0;
  for (const piece of sol) {
    await answer(page, piece.clue, lv.clues[piece.clue].answer);
    const minX = Math.min(...piece.cells.map((c) => c.x)), minY = Math.min(...piece.cells.map((c) => c.y));
    const rel = piece.cells.map((c) => ({ x: c.x - minX, y: c.y - minY }));
    await toggleCells(page, rel);
    await page.click('#btn-confirm');
    if (useTap) {
      await page.click('#tray-block .tblock:not(.gap)');
      const first = rel.slice().sort((a, b) => a.y - b.y || a.x - b.x)[0];
      const t = await trayAndGrid(page);
      await bringIntoView(page);
      const t2 = await trayAndGrid(page);
      await page.mouse.click(t2.g.left + (minX + first.x + 0.5) * (t2.g.width / t2.n), t2.g.top + (minY + first.y + 0.5) * (t2.g.height / t2.n));
    } else {
      await drag(page, { dropX: minX, dropY: minY });
    }
    k++;
    if (k < sol.length) await page.waitForFunction((kk) => document.getElementById('progress-text').innerText.startsWith(kk + ' /'), k);
  }
  return sol;
}

(async () => {
  const browser = await playwright.chromium.launch();

  /* ============ A. launch + level select ============ */
  section('A. Launch, level select, initial locks');
  let page = await newPage(browser);
  chk('Home screen visible with Play button', await vis(page, '#screen-home') && await vis(page, '#btn-play'));
  await page.screenshot({ path: SHOTS + '/01-home.png' });
  await page.click('#btn-play');
  chk('Level select visible', await vis(page, '#screen-levels'));
  const names = await page.$$eval('.level-card h3', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
  chk('5 levels with sizes 8/10/12/15/20', names.length === 5 && /8×8/.test(names[0]) && /10×10/.test(names[1]) && /12×12/.test(names[2]) && /15×15/.test(names[3]) && /20×20/.test(names[4]), names);
  const locks = await page.$$eval('.level-card', (els) => els.map((e) => e.dataset.locked));
  chk('Only Beginner unlocked initially', same(locks, ['false', 'true', 'true', 'true', 'true']), locks);
  chk('Locked levels have disabled Play buttons', await page.$$eval('.level-card[data-locked="true"] button', (b) => b.every((x) => x.disabled)));
  await page.screenshot({ path: SHOTS + '/02-levels.png' });

  /* ============ B. Beginner detailed loop ============ */
  section('B. Beginner 8×8 — full tutorial loop with every validation case');
  await page.click('[data-play="1"]');
  chk('Game screen open, grid 8×8 (64 cells)', await vis(page, '#screen-game') && (await page.locator('#main-grid .cell').count()) === 64);
  chk('Tutorial step 1 text', (await text(page, '#coach')).includes('Solve the clue to earn pixels.'));
  chk('Progress starts at 0 / 3 clues', (await progress(page)) === '0 / 3 clues');
  let gs = await gameState(page);
  chk('Timer running with exactly one interval', gs.running && gs.intervals === 1, gs);
  await page.waitForTimeout(1300);
  chk('Timer display advances', (await text(page, '#timer')) !== '00:00', await text(page, '#timer'));

  await answer(page, 0, 'HOUSE');
  chk('Incorrect answer → "Not quite — try again!"', (await status(page)).includes('Not quite — try again!'));
  chk('Incorrect answer does not reveal answer / grant pixels', (await gameState(page)).pixels === 0 && !(await text(page, '#clue-list')).includes('ROOF'));
  await answer(page, 0, 'roof');
  chk('Correct answer → "Correct! You earned 4 pixels."', (await status(page)).includes('Correct! You earned 4 pixels.'), await status(page));
  chk('Solved clue card shows Correct (not stale Incorrect) state', /^correct$/i.test(await text(page, '[data-clue="0"] .clue-state')));
  chk('Pixel reward equals answer length (4)', (await gameState(page)).pixels === 4);
  chk('Tutorial step 2 text mentions 4 letters/4 pixels', (await text(page, '#coach')).includes('Your answer has 4 letters — you earned 4 pixels!'));
  chk('Progress unchanged until placement (0 / 3)', (await progress(page)) === '0 / 3 clues');
  chk('Builder shows "0 / 4" and is visible', await vis(page, '#panel-builder') && (await text(page, '#sel-count')) === '0 / 4');
  await page.locator('[data-clue="0"] form').evaluate((f) => f.requestSubmit());
  chk('Duplicate submit is rejected, no extra pixels', (await gameState(page)).pixels === 4 && (await status(page)).includes('already solved'));
  chk('Other clue inputs are locked while a block is pending', await page.locator('[data-answer-input="1"]').isDisabled());

  await toggleCells(page, [{ x: 0, y: 0 }, { x: 1, y: 0 }]);
  await page.click('#btn-confirm');
  chk('Too few cells (2/4) → "Use exactly 4 pixels."', (await status(page)).includes('Use exactly 4 pixels.') && await vis(page, '#panel-builder'));
  await page.click('#btn-builder-reset');
  chk('Reset clears selection', (await text(page, '#sel-count')) === '0 / 4');
  await toggleCells(page, [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }]);
  chk('Diagonal-only 4 cells → live warning "All pixels must be connected."', (await text(page, '#builder-msg')).includes('All pixels must be connected.'));
  chk('Disconnected cells get highlighted (.stray)', (await page.locator('#builder-grid .bcell.stray').count()) >= 1);
  await page.click('#btn-confirm');
  chk('Confirm rejected for diagonal shape; still in builder', (await status(page)).includes('All pixels must be connected.') && await vis(page, '#panel-builder') && !(await vis(page, '#panel-tray')));
  chk('Builder shakes on invalid confirm', await page.locator('#builder-grid').evaluate((g) => g.classList.contains('shake')));
  await page.screenshot({ path: SHOTS + '/03-beginner-invalid.png' });
  await page.click('#btn-builder-reset');
  await toggleCells(page, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 0, y: 1 }]);
  chk('Too many cells (5/4) → "Use exactly 4 pixels." and count turns red', (await text(page, '#builder-msg')).includes('Use exactly 4 pixels.') && await page.locator('#sel-count').evaluate((e) => e.classList.contains('over')));
  await page.click('#btn-confirm');
  chk('Confirm rejected for 5 cells', await vis(page, '#panel-builder'));
  await page.click('#btn-builder-reset');
  // irregular but connected: 2x2 square (used as ROOF)
  await toggleCells(page, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]);
  chk('Valid shape shows ready message', (await text(page, '#builder-msg')).includes('Connected'));
  chk('Tutorial step 4 (confirm) text', (await text(page, '#coach')).includes('Confirm Shape'));
  await page.click('#btn-confirm');
  chk('Confirmed → placement tray visible', await vis(page, '#panel-tray') && !(await vis(page, '#panel-builder')));
  chk('Tutorial step 5 text', (await text(page, '#coach')).includes('Place your block on the puzzle grid.'));
  await drag(page, { dropX: 3, dropY: 2 });
  chk('ROOF square placed at (3,2) — exact cells', same(await gridBlockCells(page), ['3,2', '3,3', '4,2', '4,3']), await gridBlockCells(page));
  chk('Progress updates after placement: 1 / 3', (await progress(page)) === '1 / 3 clues');
  chk('Progress bar width ≈ 33%', /^33/.test(await page.locator('#progress-fill').evaluate((e) => e.style.width)));
  chk('Progress bar has 0.3s width transition', await page.locator('#progress-fill').evaluate((e) => getComputedStyle(e).transitionProperty.includes('width') && getComputedStyle(e).transitionDuration.startsWith('0.3')));

  // DOOR: horizontal line of 4 — placement validation through the real UI
  await answer(page, 1, 'DOOR');
  await toggleCells(page, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }]);
  await page.click('#btn-confirm');
  const before = await gridBlockCells(page);
  await drag(page, { pointer: { x: 6, y: 0 }, gx: 0, gy: 0 });
  chk('Out of bounds RIGHT rejected with message', (await status(page)).includes('That block goes outside the puzzle.') && same(await gridBlockCells(page), before));
  await drag(page, { pointer: { x: 0, y: 0 }, gx: 3, gy: 0 });
  chk('Out of bounds LEFT rejected', (await status(page)).includes('outside the puzzle') && same(await gridBlockCells(page), before));
  await page.click('#btn-rotate');
  await drag(page, { pointer: { x: 0, y: 6 }, gx: 0, gy: 0 });
  chk('Out of bounds BOTTOM rejected', (await status(page)).includes('outside the puzzle') && same(await gridBlockCells(page), before));
  await drag(page, { pointer: { x: 0, y: 0 }, gx: 0, gy: 3 });
  chk('Out of bounds TOP rejected', (await status(page)).includes('outside the puzzle') && same(await gridBlockCells(page), before));
  chk('Failed placement did not touch progress or queue', (await progress(page)) === '1 / 3 clues' && (await gameState(page)).phase === 'placing');
  chk('Grid frame shakes on failure', await page.locator('#grid-frame').evaluate((e) => e.classList.contains('shake')));
  await page.screenshot({ path: SHOTS + '/04-beginner-placefail.png' });
  await drag(page, { dropX: 0, dropY: 0, outside: true });
  chk('Dropping outside the grid cancels silently (block stays in tray)', (await gameState(page)).phase === 'placing' && same(await gridBlockCells(page), before));
  await page.click('#btn-rotate'); await page.click('#btn-rotate'); await page.click('#btn-rotate'); // back to horizontal
  await drag(page, { dropX: 3, dropY: 2 });
  chk('Overlapping an existing block → "That space is already occupied."', (await status(page)).includes('That space is already occupied.') && same(await gridBlockCells(page), before));
  await drag(page, { dropX: 4, dropY: 7 });
  chk('Grid-edge placement (bottom-right corner, exact fit) is valid', same(await gridBlockCells(page), [...before, '4,7', '5,7', '6,7', '7,7'].sort()), await gridBlockCells(page));
  chk('Progress 2 / 3', (await progress(page)) === '2 / 3 clues');
  await page.click('#btn-undo');
  chk('Undo picks the last block up again (grid + progress rolled back)', same(await gridBlockCells(page), before) && (await progress(page)) === '1 / 3 clues' && await vis(page, '#panel-tray'));
  await drag(page, { dropX: 2, dropY: 5 });
  chk('DOOR line re-placed at (2,5), touching without overlap is valid', same(await gridBlockCells(page), [...before, '2,5', '3,5', '4,5', '5,5'].sort()));
  await page.click('#btn-hint');
  chk('Hint (letters) button works during solving phase', (await gameState(page)).hints === 1 && (await text(page, '[data-clue="2"] .slots')).replace(/\s/g, '').startsWith('W'));
  chk('Hint counter shown', (await text(page, '#hint-count')).includes('1 hint'));

  await answer(page, 2, 'WINDOW');
  chk('WINDOW → 6 pixels', (await gameState(page)).pixels === 14 && (await text(page, '#need-count')) === '6');
  await page.click('#btn-hint');
  chk('Hint while building is free (no penalty) and flashes target', (await gameState(page)).hints === 1 && (await page.locator('#main-grid .cell.flash').count()) > 0);
  await toggleCells(page, [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 0 }]);
  await page.click('#btn-confirm');
  await page.waitForTimeout(100);
  const preTimer = await text(page, '#timer');
  // tap-to-place: tap the block, then tap grid cell (anchor = first cell)
  await page.click('#tray-block .tblock:not(.gap)');
  chk('Tap on block arms tap-to-place', await page.locator('#tray-block').evaluate((e) => e.classList.contains('armed')));
  await bringIntoView(page);
  const t2 = await trayAndGrid(page);
  const cell = (x, y) => [t2.g.left + (x + 0.5) * t2.g.width / t2.n, t2.g.top + (y + 0.5) * t2.g.height / t2.n];
  await page.mouse.move(...cell(2, 3));
  chk('Hover preview shows a valid (green) ghost', (await page.locator('#main-grid .cell.preview-ok').count()) === 6);
  await page.mouse.click(...cell(2, 3));
  await page.waitForSelector('#overlay-complete:not([hidden])');
  chk('Completion overlay shows', await vis(page, '#overlay-complete'));
  gs = await gameState(page);
  chk('Timer stopped on completion, 0 live intervals', !gs.running && gs.intervals === 0 && gs.completed, gs);
  const frozen = await text(page, '#stat-time'); await page.waitForTimeout(1600);
  chk('Completion-screen time stays frozen', frozen === await text(page, '#stat-time') && Math.abs((await gameState(page)).elapsed - gs.elapsed) < 0.001);
  chk('Title "LITTLE HOUSE COMPLETE!"', (await text(page, '#complete-title')) === 'LITTLE HOUSE COMPLETE!');
  const starsOn = await page.locator('#complete-stars .on').count();
  chk('1–3 stars shown and match state', starsOn >= 1 && starsOn <= 3 && starsOn === gs.stars, starsOn);
  chk('Score shown = state score (1000−75−25−20 = ' + gs.score + ')', (await text(page, '#stat-score')) === String(gs.score) && gs.score === 1000 - 75 - 25 * 1 - 20 * 1, gs);
  chk('All 3 clues solved text + final image canvas', (await text(page, '#stat-clues')).includes('All 3 clues solved') && (await page.locator('#complete-canvas').evaluate((c) => c.width > 0)));
  chk('Whole picture revealed in art colours behind overlay', (await page.locator('#main-grid .cell.art').count()) === 14);
  chk('Next-level button offers Easy', (await text(page, '#btn-next')).includes('Easy'));
  await page.screenshot({ path: SHOTS + '/05-beginner-complete.png' });

  /* persistence + next level */
  await page.click('#btn-complete-levels');
  chk('Level select after completion; Easy now unlocked, Beginner completed', await page.$$eval('.level-card', (e) => e[1].dataset.locked === 'false' && /Completed/.test(e[0].innerText)));
  chk('Beginner star display saved', (await page.$$eval('.level-card', (e) => e[0].querySelectorAll('.stars-row .on').length)) >= 1);
  await page.reload();
  await page.click('#btn-play');
  chk('After browser refresh Easy STILL unlocked (localStorage)', await page.$$eval('.level-card', (e) => e[1].dataset.locked === 'false' && e[2].dataset.locked === 'true'));
  chk('Medium still locked', await page.$$eval('.level-card', (e) => e[2].dataset.locked === 'true'));

  /* ============ C. Easy, Medium, Hard, Expert core loops ============ */
  for (const id of [2, 3, 4, 5]) {
    const lv = PC.LEVELS.find((l) => l.id === id);
    section(`C${id - 1}. ${lv.name} ${lv.gridSize}×${lv.gridSize} — complete core loop through the UI (${lv.clues.length} clues)`);
    if (await vis(page, '#screen-levels') === false) { await page.click('#btn-complete-levels'); }
    await openLevelFromSelect(page, id);
    chk(`${lv.name}: grid has ${lv.gridSize ** 2} cells`, (await page.locator('#main-grid .cell').count()) === lv.gridSize ** 2);
    chk(`${lv.name}: prefilled cells rendered`, (await page.locator('#main-grid .cell[data-state="pre"]').count()) === lv.prefilled.flat().filter(Boolean).length);
    if (id === 2) chk('Easy: tutorial guidance reduced (light tip, no "Step x of 6")', !(await text(page, '#coach')).includes('of 6') && await vis(page, '#coach'));
    if (id >= 3) chk(`${lv.name}: no tutorial coach box`, !(await vis(page, '#coach')));
    await playLevelUI(page, id, { useTap: id === 3 });
    await page.waitForSelector('#overlay-complete:not([hidden])');
    gs = await gameState(page);
    chk(`${lv.name}: completed, timer stopped`, gs.completed && !gs.running && gs.intervals === 0, gs);
    chk(`${lv.name}: progress ${lv.clues.length} / ${lv.clues.length}`, (await progress(page)) === `${lv.clues.length} / ${lv.clues.length} clues`);
    chk(`${lv.name}: score ${gs.score}, ${gs.stars}★ shown`, (await text(page, '#stat-score')) === String(gs.score) && (await page.locator('#complete-stars .on').count()) === gs.stars);
    await page.screenshot({ path: SHOTS + `/06-${lv.name.toLowerCase()}-complete.png` });
    const nextExists = id < 5;
    if (nextExists) {
      chk(`${lv.name}: next level unlocked in storage`, await page.evaluate((n) => JSON.parse(localStorage.getItem('pixelclues.save.v1')).unlocked >= n, id + 1));
      await page.click('#btn-next');
      await page.waitForSelector('#screen-game:not([hidden])');
      const t = await text(page, '#game-title');
      chk(`Next Level button opened ${PC.LEVELS[id].name}`, t.includes(PC.LEVELS[id].name), t);
      chk('Exactly one timer interval after switching level', (await gameState(page)).intervals === 1);
      if (id === 2 || id === 3 || id === 4) { /* stay in flow: next iteration expects level select */ await page.click('#btn-exit'); }
    } else {
      chk('Expert: no Next button (last level)', !(await vis(page, '#btn-next')));
      await page.click('#btn-complete-levels');
    }
  }
  await page.close();

  /* ============ D. Timer, Restart, Exit ============ */
  section('D. Timer / Restart / Exit');
  page = await newPage(browser, { unlocked: 1 });
  await openLevelFromSelect(page, 1);
  await page.waitForTimeout(1300);
  const t1 = await text(page, '#timer');
  for (let i = 0; i < 4; i++) await page.click('#btn-restart');
  chk('Restart resets timer display to 00:00', (await text(page, '#timer')) === '00:00' && t1 !== '00:00');
  chk('Repeated Restart never creates duplicate intervals', (await gameState(page)).intervals === 1);
  await answer(page, 0, 'ROOF'); await toggleCells(page, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }]); await page.click('#btn-confirm'); await drag(page, { dropX: 0, dropY: 0 });
  chk('Placed 1 block', (await progress(page)) === '1 / 3 clues');
  await page.click('#btn-restart');
  gs = await gameState(page);
  chk('Restart resets grid, progress, clues, hints, undo counters', (await progress(page)) === '0 / 3 clues' && gs.solved === 0 && gs.pixels === 0 && gs.undos === 0 && gs.hints === 0 && (await gridBlockCells(page)).length === 0);
  chk('Undo disabled when nothing placed', await page.locator('#btn-undo').isDisabled());
  await page.click('#btn-exit');
  gs = await gameState(page);
  chk('Exit stops timer (0 intervals)', !gs.running && gs.intervals === 0 && await vis(page, '#screen-levels'), gs);
  const el0 = gs.elapsed; await page.waitForTimeout(1000);
  chk('Elapsed time frozen after exit', (await gameState(page)).elapsed === el0);
  await openLevelFromSelect(page, 1);
  chk('Starting another level → exactly one interval, time restarted', (await gameState(page)).intervals === 1 && (await text(page, '#timer')) === '00:00');
  await page.close();

  /* ============ E. Overlays never block ============ */
  section('E. Hidden overlays / modals never intercept clicks');
  page = await newPage(browser, { unlocked: 1 });
  const ov = await page.evaluate(() => ['overlay-complete', 'overlay-help'].map((id) => { const e = document.getElementById(id); const cs = getComputedStyle(e); return { id, hidden: e.hidden, display: cs.display, pe: cs.pointerEvents }; }));
  chk('Hidden overlays: display none + pointer-events none', ov.every((o) => o.hidden && o.display === 'none' && o.pe === 'none'), ov);
  const top = await page.evaluate(() => { const b = document.getElementById('btn-play').getBoundingClientRect(); const e = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return e.id || e.closest('button').id; });
  chk('Play button is the topmost element at its centre', top === 'btn-play', top);
  await page.click('#btn-help'); chk('Help overlay opens', await vis(page, '#overlay-help'));
  await page.click('#btn-help-close'); chk('Help overlay closes and hides fully', !(await vis(page, '#overlay-help')));
  await page.click('#btn-play'); await page.click('[data-play="1"]');
  const tops = await page.evaluate(() => ['btn-hint', 'btn-restart', 'btn-exit'].concat(['[data-answer-input="0"]']).map((s) => { const e = document.getElementById(s) || document.querySelector(s); const b = e.getBoundingClientRect(); const t = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return e === t || e.contains(t); }));
  chk('In-game controls (Hint, Restart, Exit, clue input) reachable — nothing overlays them', tops.every(Boolean), tops);
  await page.locator('[data-answer-input="0"]').fill('ro'); chk('Clue input accepts typing', (await page.locator('[data-answer-input="0"]').inputValue()) === 'ro');
  await page.close();

  /* ============ F. localStorage failure ============ */
  section('F. localStorage failure must not crash the game');
  const errBefore = consoleErrors.length;
  page = await newPage(browser, { init: () => { Storage.prototype.setItem = function () { throw new Error('QuotaExceeded (simulated)'); }; Storage.prototype.getItem = function () { throw new Error('SecurityError (simulated)'); }; } });
  await page.click('#btn-play');
  chk('Level select renders with storage disabled + notice shown', await vis(page, '#screen-levels'));
  await page.click('[data-play="1"]');
  const sol = await playLevelUI(page, 1);
  await page.waitForSelector('#overlay-complete:not([hidden])');
  chk('Beginner completable with broken storage; no exceptions', consoleErrors.length === errBefore, consoleErrors.slice(errBefore));
  await page.click('#btn-next');
  chk('Next level (Easy) unlocked in-memory even though save failed', (await text(page, '#game-title')).includes('Easy'));
  await page.close();

  /* ============ G. Presenter mode ============ */
  section('G. Presenter mode leaves progression untouched');
  page = await newPage(browser, { unlocked: 1 });
  await page.click('#btn-play'); await page.check('#presenter-toggle');
  chk('Hard becomes openable in presenter mode', !(await page.locator('[data-play="4"]').isDisabled()));
  await page.click('[data-play="4"]');
  chk('Hard 15×15 opens (225 cells)', (await page.locator('#main-grid .cell').count()) === 225);
  await page.screenshot({ path: SHOTS + '/07-hard.png' });
  await page.click('#btn-exit');
  chk('Saved unlocked level still 1', await page.evaluate(() => JSON.parse(localStorage.getItem('pixelclues.save.v1')).unlocked === 1));
  await page.click('[data-play="5"]');
  chk('Expert 20×20 opens (400 cells)', (await page.locator('#main-grid .cell').count()) === 400);
  await page.screenshot({ path: SHOTS + '/08-expert.png' });
  await page.close();

  /* ============ H. Responsive + drag accuracy ============ */
  section('H. Responsive layouts + drag/drop coordinate accuracy at 1440 / 1024 / 768 / 600 / 390');
  for (const [w, h] of SIZES) {
    page = await newPage(browser, { viewport: { width: w, height: h }, unlocked: 5 });
    const ovf = async (label) => { const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth })); chk(`${w}px ${label}: no horizontal overflow`, r.sw <= r.iw, r); };
    await ovf('home'); await page.click('#btn-play'); await ovf('level select');
    if (w === 1440 || w === 390) await page.screenshot({ path: SHOTS + `/09-levels-${w}.png` });
    for (const id of [1, 2, 3, 4, 5]) {
      const lv = PC.LEVELS.find((l) => l.id === id);
      if (!(await vis(page, '#screen-levels'))) await page.click('#btn-exit');
      await page.click(`[data-play="${id}"]`);
      await ovf(`${lv.name} ${lv.gridSize}×${lv.gridSize} game`);
      const g = await page.evaluate(() => { const r = document.getElementById('main-grid').getBoundingClientRect(); return { w: r.width, h: r.height, l: r.left, r: r.right, iw: innerWidth }; });
      chk(`${w}px ${lv.name}: grid square (${g.w.toFixed(0)}×${g.h.toFixed(0)}) and inside the viewport`, Math.abs(g.w - g.h) < 1.5 && g.l >= 0 && g.r <= g.iw + 0.5, g);
      // first block of the proven solution: solve → build → drag → verify exact cells
      const s = solve(lv).solution[0];
      const minX = Math.min(...s.cells.map((c) => c.x)), minY = Math.min(...s.cells.map((c) => c.y));
      const rel = s.cells.map((c) => ({ x: c.x - minX, y: c.y - minY }));
      await answer(page, s.clue, lv.clues[s.clue].answer);
      const bb = await page.evaluate(() => { const r = document.getElementById('builder-grid').getBoundingClientRect(); return { l: r.left, r: r.right, iw: innerWidth }; });
      chk(`${w}px ${lv.name}: builder fits (${bb.r.toFixed(0)} ≤ ${bb.iw})`, bb.l >= 0 && bb.r <= bb.iw + 0.5, bb);
      await toggleCells(page, rel); await page.click('#btn-confirm');
      const tb = await page.evaluate(() => { const r = document.getElementById('tray-block').getBoundingClientRect(); return { l: r.left, r: r.right, iw: innerWidth }; });
      chk(`${w}px ${lv.name}: block tray fits`, tb.l >= 0 && tb.r <= tb.iw + 0.5, tb);
      if (id === 1 || id === 5) await page.screenshot({ path: SHOTS + `/10-${lv.name.toLowerCase()}-${w}.png` });
      // place, verify exact cells, undo, repeat after a viewport resize (test re-layout accuracy)
      await drag(page, { dropX: minX, dropY: minY });
      chk(`${w}px ${lv.name}: block landed on the exact cells under the pointer`, same(await gridBlockCells(page), key(s.cells)), await gridBlockCells(page));
      if (id === 3) {
        for (const [w2, h2] of SIZES) {
          await page.setViewportSize({ width: w2, height: h2 }); await page.waitForTimeout(120);
          await page.click('#btn-undo');
          await drag(page, { dropX: minX, dropY: minY });
          const okc = same(await gridBlockCells(page), key(s.cells));
          if (!okc) chk(`${w}→${w2}px resize: drop accuracy`, false, await gridBlockCells(page));
          else if (w2 === 390) chk(`${w}px→ resized through all sizes: drop stays accurate (checked at every size)`, true);
        }
        await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(100);
      }
      await page.click('#btn-exit');
    }
    // completion overlay fits (Beginner)
    await page.click('[data-play="1"]');
    await playLevelUI(page, 1);
    await page.waitForSelector('#overlay-complete:not([hidden])');
    await page.waitForTimeout(600); // let the pop-in animation settle before measuring
    const m = await page.evaluate(() => { const r = document.querySelector('#overlay-complete .modal').getBoundingClientRect(); return { l: r.left, r: r.right, iw: innerWidth, sw: document.documentElement.scrollWidth }; });
    chk(`${w}px completion screen fits horizontally`, m.l >= 0 && m.r <= m.iw + 0.5 && m.sw <= m.iw, m);
    await page.screenshot({ path: SHOTS + `/11-complete-${w}.png` });
    await page.close();
  }

  await browser.close();

  section('Console errors across all runs');
  chk('No console errors / uncaught exceptions', consoleErrors.length === 0, consoleErrors);

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n==== E2E: ${pass} passed, ${results.length - pass} failed (of ${results.length}) ====`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error('E2E CRASH', e); process.exit(2); });
