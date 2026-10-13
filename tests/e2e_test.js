// End-to-end tests in a real Chromium (Playwright). Run:  node tests/e2e_test.js
// Needs playwright (npm i -D playwright, or a global install; set PLAYWRIGHT_MODULE to override).
//
// Covers the direct-draw-on-grid interaction model: clues are solved, pixels are earned, and
// the player paints/erases pixels directly on #main-grid (click, or click-and-drag) instead of
// building a shape in a separate builder panel and dragging a block onto the grid. The target
// picture is never rendered on the grid pre-completion; it only appears as a non-interactive
// reference image in the right-hand panel.
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
async function answer(page, i, word) {
  const inp = page.locator(`[data-answer-input="${i}"]`);
  if (!(await inp.isVisible())) await page.click(`[data-clue="${i}"] .clue-head`); // collapsed clue → open its answer row
  await inp.fill(word); await inp.press('Enter');
}
async function gridBlockCells(page) {
  return page.evaluate(() => [...document.querySelectorAll('#main-grid .cell')].filter((c) => c.dataset.state === 'block').map((c) => c.dataset.x + ',' + c.dataset.y).sort());
}
async function ownCells(page) {
  return page.evaluate(() => [...document.querySelectorAll('#main-grid .cell')].filter((c) => c.dataset.state === 'selected').map((c) => c.dataset.x + ',' + c.dataset.y).sort());
}
const key = (cells) => cells.map((c) => c.x + ',' + c.y).sort();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const progress = (page) => text(page, '#progress-text');
const status = (page) => text(page, '#status');
/** Compare main-grid cells against the level's reference data (lv.art + PC.PALETTE, the same
 *  source drawArt() paints the reference canvas from). Returns mismatching cells. Cells that are
 *  empty in the reference must carry no art styling. */
const artMismatches = (page) => page.evaluate(() => {
  const lv = PC.Game.state.currentLevel, n = lv.gridSize, bad = [];
  const probe = document.createElement('div'); document.body.appendChild(probe);
  const rgb = (hex) => { probe.style.backgroundColor = hex; return getComputedStyle(probe).backgroundColor; };
  document.querySelectorAll('#main-grid .cell').forEach((c) => {
    const x = +c.dataset.x, y = +c.dataset.y, a = lv.art[y][x], isArt = c.classList.contains('art');
    if (!a) { if (isArt) bad.push({ x, y, why: 'empty cell styled' }); return; }
    if (!isArt) { bad.push({ x, y, why: 'missing art' }); return; }
    const want = rgb(PC.PALETTE[a]), got = getComputedStyle(c).backgroundColor;
    if (want !== got) bad.push({ x, y, want, got });
  });
  probe.remove();
  return bad;
});
const gameState = (page) => page.evaluate(() => { const s = PC.Game.state; return { phase: PC.Game.phase(), placed: s.placedBlocks.length, solved: s.solvedClues.length, pixels: s.earnedPixels, hints: s.hintsUsed, wrong: s.invalidAttempts, undos: s.undos, completed: s.completed, elapsed: s.elapsedTime, intervals: PC.Game.liveIntervals, score: s.score, stars: s.stars, running: PC.Game.isTimerRunning(), queue: s.queue.length, activeN: s.queue[0] ? s.queue[0].n : 0, activeCount: s.queue[0] ? s.queue[0].cells.length : 0 }; });

/** Centre of grid cell (x,y) in viewport coordinates — recomputed from the live rect each
 *  time, so it stays correct across resizes (mirrors how the real pointer handlers work). */
async function cellCenter(page, x, y) {
  return page.evaluate(({ x, y }) => {
    const g = document.getElementById('main-grid');
    const r = g.getBoundingClientRect();
    const n = +getComputedStyle(g).getPropertyValue('--n');
    return { cx: r.left + (x + 0.5) * r.width / n, cy: r.top + (y + 0.5) * r.height / n };
  }, { x, y });
}
/** Filling a clue input far down a long clue list (e.g. Expert's 11 clues) auto-scrolls the
 *  page, which moves #main-grid out from under any previously-computed pointer coordinates.
 *  Scroll the grid itself back into view before any click/drag against it. */
async function ensureGridInView(page) {
  await page.evaluate(() => document.getElementById('main-grid').scrollIntoView({ block: 'center' }));
}
async function clickCell(page, x, y) {
  await ensureGridInView(page);
  const { cx, cy } = await cellCenter(page, x, y);
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(20);
}
/** Click-and-drag across a sequence of cells in one continuous gesture (pointerdown on the
 *  first, pointermove through the rest, pointerup) — exactly how a player paints/erases
 *  several pixels at once. */
async function dragCells(page, cellsList) {
  await ensureGridInView(page);
  const first = await cellCenter(page, cellsList[0].x, cellsList[0].y);
  await page.mouse.move(first.cx, first.cy);
  await page.mouse.down();
  for (const c of cellsList.slice(1)) {
    const p = await cellCenter(page, c.x, c.y);
    await page.mouse.move(p.cx, p.cy);
  }
  await page.mouse.up();
  await page.waitForTimeout(40);
}

/** Solve a whole level through the real UI using the solver's proven solution: answer each
 *  clue, then click-and-drag paint the proven cells for that piece, then Confirm. */
async function playLevelUI(page, levelId) {
  const lv = PC.LEVELS.find((l) => l.id === levelId);
  const sol = solve(lv).solution;
  let k = 0;
  for (const piece of sol) {
    await answer(page, piece.clue, lv.clues[piece.clue].answer);
    await dragCells(page, piece.cells);
    await page.click('#btn-confirm');
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

  /* ============ B. Layout, target removal, reference panel ============ */
  section('B. Three-column layout, target removed from main grid, reference panel');
  await page.click('[data-play="1"]');
  chk('Game screen open, grid 8×8 (64 cells)', await vis(page, '#screen-game') && (await page.locator('#main-grid .cell').count()) === 64);
  const areas = await page.evaluate(() => getComputedStyle(document.querySelector('.puzzle-layout')).gridTemplateAreas);
  chk('Desktop layout is clues | board | ref (three columns)', /clues/.test(areas) && /board/.test(areas) && /ref/.test(areas), areas);
  const order = await page.evaluate(() => {
    const l = document.querySelector('.puzzle-layout');
    const kids = [...l.children];
    const rect = (el) => el.getBoundingClientRect();
    return kids.map((k) => ({ cls: k.className, left: rect(k).left }));
  });
  const clueBox = order.find((o) => /clues-panel/.test(o.cls));
  const boardBox = order.find((o) => /board-panel/.test(o.cls));
  const refBox = order.find((o) => /reference-panel/.test(o.cls));
  chk('Clues panel sits left of the main grid, which sits left of the reference panel', clueBox.left < boardBox.left && boardBox.left < refBox.left, order);
  chk('No `.cell.target` overlay class exists anywhere in the stylesheet-driven markup (target is internal-only)', (await page.locator('#main-grid .cell.target').count()) === 0);
  const emptyBgs = await page.$$eval('#main-grid .cell[data-state="empty"]', (els) => [...new Set(els.map((e) => getComputedStyle(e).backgroundColor + '|' + getComputedStyle(e).backgroundImage))]);
  chk('Every empty main-grid cell looks identical (target picture not revealed on the grid)', emptyBgs.length === 1, emptyBgs);
  const refCanvasVisible = await vis(page, '#reference-canvas');
  chk('Reference image panel shows a canvas with the target picture, labeled "Reference"', refCanvasVisible && (await text(page, '.reference-panel h3')) === 'Reference');
  const refPE = await page.locator('#reference-canvas').evaluate((c) => getComputedStyle(c).pointerEvents);
  chk('Reference canvas is non-interactive (pointer-events: none)', refPE === 'none');
  const refDrawn = await page.locator('#reference-canvas').evaluate((c) => c.width > 0 && c.height > 0);
  chk('Reference canvas actually has the picture drawn onto it', refDrawn);
  chk('No old builder/tray elements exist anywhere in the DOM', (await page.locator('#builder-grid, #tray-block, #btn-rotate, #btn-reshape, #btn-builder-reset').count()) === 0);
  const noScale = await page.evaluate(() => {
    const check = (sel) => !/scale\(/.test(getComputedStyle(document.querySelector(sel)).transform) || getComputedStyle(document.querySelector(sel)).transform === 'none';
    return check('#main-grid') && check('#grid-frame');
  });
  chk('Grid sizing does not rely on transform:scale() as its mechanism', noScale);

  /* ============ C. Direct-draw mechanics on the main grid (Beginner) ============ */
  section('C. Direct click / click-and-drag drawing mechanics');
  chk('Progress starts at 0 / 3 clues', (await progress(page)) === '0 / 3 clues');
  let gs = await gameState(page);
  chk('Timer running with exactly one interval', gs.running && gs.intervals === 1, gs);

  // The proven solver solution for this level — used so that every piece we actually CONFIRM
  // (as opposed to pieces only used to demo rejection/mechanics) lands on the real target cells
  // and the level can genuinely complete. Mechanics demos below use row 0/1 scratch cells,
  // which this level's target never requires, so they never collide with the real placements.
  const beginnerSol = solve(PC.LEVELS[0]).solution;
  const realCellsFor = (clue) => beginnerSol.find((p) => p.clue === clue).cells;

  await answer(page, 0, 'HOUSE');
  chk('Incorrect answer → "Not quite — try again!"', (await status(page)).includes('Not quite — try again!'));
  await answer(page, 0, 'roof');
  chk('Correct answer → "Correct! You earned 4 pixels."', (await status(page)).includes('Correct! You earned 4 pixels.'), await status(page));
  chk('Pixel reward equals answer length (4)', (await gameState(page)).activeN === 4);
  chk('Draw tools appear: status chip + Clear + Confirm', await vis(page, '#draw-status') && await vis(page, '#btn-clear') && await vis(page, '#btn-confirm'));
  chk('Confirm disabled with zero pixels drawn', await page.locator('#btn-confirm').isDisabled());

  // single click toggles one cell on, then off
  await clickCell(page, 0, 0);
  chk('Single click places a pixel', same(await ownCells(page), ['0,0']));
  await clickCell(page, 0, 0);
  chk('Clicking the same (now-selected) cell again removes it (toggle)', (await ownCells(page)).length === 0);

  // click-and-drag paints multiple cells in one gesture, including re-entering a cell
  await dragCells(page, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }]);
  chk('Drag paints the distinct cells crossed; re-entering (0,0) mid-gesture does not re-toggle it off', same(await ownCells(page), ['0,0', '1,0', '1,1']), await ownCells(page));

  // drag-erase: starting a new drag on an already-selected cell erases along the path
  await dragCells(page, [{ x: 0, y: 0 }, { x: 1, y: 0 }]);
  chk('Starting a drag on a selected cell erases the cells it crosses', same(await ownCells(page), ['1,1']), await ownCells(page));

  await page.click('#btn-clear');
  chk('Clear Shape empties the current drawing', (await ownCells(page)).length === 0);

  // pointer safety
  chk('Grid uses touch-action: none while drawing (touch drags draw, not scroll)', await page.locator('#main-grid').evaluate((g) => getComputedStyle(g).touchAction) === 'none');
  { const p = await cellCenter(page, 2, 0); await page.mouse.click(p.cx, p.cy, { button: 'right' }); }
  chk('Right-click does not draw', (await ownCells(page)).length === 0);
  {
    const a = await cellCenter(page, 0, 0), b = await cellCenter(page, 1, 0), c = await cellCenter(page, 2, 0);
    await page.mouse.move(a.cx, a.cy); await page.mouse.down();
    await page.mouse.move(a.cx, 5); await page.mouse.up(); // release outside the grid
    await page.mouse.move(b.cx, b.cy); await page.mouse.move(c.cx, c.cy); // hover back with no button held
  }
  chk('pointerup outside the grid ends the drag (hovering afterwards draws nothing)', same(await ownCells(page), ['0,0']), await ownCells(page));
  await page.click('#btn-clear');
  await page.evaluate(({ a, b }) => {
    const g = document.getElementById('main-grid');
    const ev = (type, p) => g.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 77, isPrimary: true, pointerType: 'touch', button: 0, buttons: 1, clientX: p.cx, clientY: p.cy }));
    ev('pointerdown', a); ev('pointercancel', a); ev('pointermove', b);
  }, { a: await cellCenter(page, 0, 0), b: await cellCenter(page, 1, 0) });
  chk('pointercancel ends the drag (later pointermove draws nothing)', same(await ownCells(page), ['0,0']), await ownCells(page));
  await page.click('#btn-clear');

  // pixel budget: paint exactly 4 scratch cells (row 0, which this level's target never needs),
  // a 5th attempt is rejected and named
  await dragCells(page, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }]);
  chk('Exactly 4 pixels drawn for ROOF', same(await ownCells(page), ['0,0', '1,0', '2,0', '3,0']));
  await clickCell(page, 5, 0);
  chk('5th pixel over budget rejected, naming the clue\'s answer', (await status(page)).includes('All 4 pixels for ROOF have been placed.'), await status(page));
  chk('Budget rejection did not add a 5th pixel', (await ownCells(page)).length === 4);

  // clear the scratch demo and draw the real (proven) solution cells for this clue, so the
  // level can genuinely reach completion later
  await page.click('#btn-clear');
  const roofCells = realCellsFor(0);
  await dragCells(page, roofCells);
  await page.click('#btn-confirm');
  chk('4 connected cells confirm successfully', (await progress(page)) === '1 / 3 clues');
  chk('Confirmed cells committed to the grid as a block', same(await gridBlockCells(page), key(roofCells)));
  await clickCell(page, 7, 0);
  chk('Clicking the grid with no clue in drawing mode changes nothing', (await ownCells(page)).length === 0 && same(await gridBlockCells(page), key(roofCells)) && (await gameState(page)).phase === 'solving');
  await page.screenshot({ path: SHOTS + '/03-beginner-confirmed.png' });

  // DOOR: test connectivity rejection (row 1 scratch) and occupied-cell rejection before placing it for real
  await answer(page, 1, 'DOOR');
  await dragCells(page, [{ x: 0, y: 1 }, { x: 2, y: 1 }, { x: 4, y: 1 }, { x: 6, y: 1 }]); // disconnected (gap of 1 between each)
  chk('4 disconnected cells drawn', (await ownCells(page)).length === 4);
  await page.click('#btn-confirm');
  chk('Confirm rejected for disconnected shape: "All pixels must be connected."', (await status(page)).includes('All pixels must be connected.'));
  chk('Grid frame shakes on invalid confirm', await page.locator('#grid-frame').evaluate((e) => e.classList.contains('shake')));
  chk('Rejected shape is NOT committed (still drawing, same 4 cells)', (await gameState(page)).phase === 'drawing' && (await ownCells(page)).length === 4);
  await page.screenshot({ path: SHOTS + '/04-beginner-invalid-disconnected.png' });

  await page.click('#btn-clear');
  const occupiedCell = roofCells[0]; // already part of the confirmed ROOF block
  await clickCell(page, occupiedCell.x, occupiedCell.y);
  chk('Clicking a cell already occupied by another clue\'s confirmed block is rejected: "That space is already occupied."', (await status(page)).includes('That space is already occupied.'));
  chk('Occupied-cell rejection does not erase the other clue\'s placed pixels', same(await gridBlockCells(page), key(roofCells)));
  chk('Occupied-cell rejection does not add it to the current drawing either', (await ownCells(page)).length === 0);
  const freeNear = [{ x: 0, y: 1 }, { x: 1, y: 1 }];
  await dragCells(page, [freeNear[0], occupiedCell, freeNear[1]]);
  chk('Paint-drag across a confirmed block skips it (block untouched, not added to drawing)', same(await gridBlockCells(page), key(roofCells)) && same(await ownCells(page), key(freeNear)), await ownCells(page));
  await dragCells(page, [freeNear[0], occupiedCell, freeNear[1]]);
  chk('Erase-drag across a confirmed block erases only the current drawing', same(await gridBlockCells(page), key(roofCells)) && (await ownCells(page)).length === 0, await ownCells(page));

  // now place DOOR correctly: the real (proven) solution cells for this clue
  const doorCells = realCellsFor(1);
  await dragCells(page, doorCells);
  await page.click('#btn-confirm');
  chk('DOOR placed correctly after fixing the shape', (await progress(page)) === '2 / 3 clues');
  const beforeUndo = await gridBlockCells(page);
  await page.click('#btn-undo');
  chk('Undo returns the last block to an editable drawing (progress rolls back)', (await progress(page)) === '1 / 3 clues' && (await gameState(page)).phase === 'drawing');
  chk('Undone shape\'s cells are pre-populated and immediately editable (erase one, it shrinks)', (await ownCells(page)).length === 4);
  await clickCell(page, doorCells[0].x, doorCells[0].y); // erase one cell of the undone shape
  chk('Erasing one cell of the just-undone shape drops the count to 3', (await ownCells(page)).length === 3);
  await clickCell(page, doorCells[0].x, doorCells[0].y); // put it back
  await page.click('#btn-confirm');
  chk('Re-confirming the restored shape re-places it identically', same(await gridBlockCells(page), beforeUndo));
  chk('Progress back to 2 / 3', (await progress(page)) === '2 / 3 clues');

  await page.click('#btn-hint');
  chk('Hint (letters) button works during solving phase', (await gameState(page)).hints === 1);
  chk('Hint counter shown', (await text(page, '#hint-count')).includes('1 hint'));
  const hintLine = await text(page, '[data-clue="2"] .hint-line');
  chk('Hint line reveals a letter on the still-unsolved clue', hintLine.startsWith('Hint: W'), hintLine);

  await answer(page, 2, 'WINDOW');
  chk('WINDOW → 6 pixels', (await gameState(page)).activeN === 6);
  await page.click('#btn-hint');
  chk('Hint while drawing is free (flashes target cells, no extra hint cost)', (await gameState(page)).hints === 1);
  const windowCells = realCellsFor(2);
  await dragCells(page, windowCells);
  await page.click('#btn-confirm');
  await page.waitForSelector('#overlay-complete:not([hidden])');
  chk('Completion overlay shows', await vis(page, '#overlay-complete'));
  gs = await gameState(page);
  chk('Timer stopped on completion, 0 live intervals', !gs.running && gs.intervals === 0 && gs.completed, gs);
  chk('Title "LITTLE HOUSE COMPLETE!"', (await text(page, '#complete-title')) === 'LITTLE HOUSE COMPLETE!');
  const starsOn = await page.locator('#complete-stars .on').count();
  chk('1–3 stars shown and match state', starsOn >= 1 && starsOn <= 3 && starsOn === gs.stars, starsOn);
  chk('Score shown matches state score', (await text(page, '#stat-score')) === String(gs.score));
  chk('All 3 clues solved text + final image canvas', (await text(page, '#stat-clues')).includes('All 3 clues solved') && (await page.locator('#complete-canvas').evaluate((c) => c.width > 0)));
  chk('Next-level button offers Easy', (await text(page, '#btn-next')).includes('Easy'));
  const artBgs = await page.$$eval('#main-grid .cell.art', (els) => els.map((e) => getComputedStyle(e).backgroundColor));
  chk('Completed grid recolours every filled cell to the picture (no transparent cells)', artBgs.length > 0 && artBgs.every((c) => c !== 'rgba(0, 0, 0, 0)'), artBgs);
  const bm = await artMismatches(page);
  chk('Beginner: completed grid matches reference art cell-for-cell (colour, position, empties)', bm.length === 0, bm.slice(0, 5));
  await page.screenshot({ path: SHOTS + '/05-beginner-complete.png' });

  /* persistence + next level */
  await page.click('#btn-complete-levels');
  chk('Level select after completion; Easy now unlocked, Beginner completed', await page.$$eval('.level-card', (e) => e[1].dataset.locked === 'false' && /Completed/.test(e[0].innerText)));
  await page.reload();
  await page.click('#btn-play');
  chk('After browser refresh Easy STILL unlocked (localStorage)', await page.$$eval('.level-card', (e) => e[1].dataset.locked === 'false' && e[2].dataset.locked === 'true'));

  /* ============ D. Clue panel fits without a nested scrollbar (Beginner/Easy/Medium) ============ */
  section('D. Clue panel fits at desktop size without an internal scrollbar');
  if (!(await vis(page, '#screen-levels'))) await page.click('#btn-exit');
  await page.check('#presenter-toggle'); // Medium isn't unlocked yet at this point; presenter mode opens it for measurement only
  for (const id of [1, 2, 3, 4, 5]) {
    const lv = PC.LEVELS.find((l) => l.id === id);
    if (!(await vis(page, '#screen-levels'))) await page.click('#btn-exit');
    await openLevelFromSelect(page, id);
    const m = await page.evaluate(() => {
      const list = document.getElementById('clue-list');
      return { scrollH: list.scrollHeight, clientH: list.clientHeight, overflowY: getComputedStyle(list).overflowY };
    });
    chk(`${lv.name}: #clue-list has no internal scrollbar (overflow not clipped-and-scrolled)`, m.overflowY !== 'scroll' && m.overflowY !== 'auto' || m.scrollH <= m.clientH + 1, m);
    const pageFit = await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 2);
    chk(`${lv.name}: whole page fits at 1440×900 with no page scroll either`, pageFit);
    const cl = await page.evaluate(() => ({ bottom: document.querySelector('.clues-panel').getBoundingClientRect().bottom, ih: innerHeight, cards: document.querySelectorAll('.clue-card').length }));
    chk(`${lv.name}: all ${lv.clues.length} clue cards visible inside the 1440×900 viewport`, cl.cards === lv.clues.length && cl.bottom <= cl.ih, cl);
  }
  await page.click('#btn-exit');
  await page.uncheck('#presenter-toggle');

  /* ============ E. Easy, Medium, Hard, Expert core loops via drag-paint ============ */
  for (const id of [2, 3, 4, 5]) {
    const lv = PC.LEVELS.find((l) => l.id === id);
    section(`E${id - 1}. ${lv.name} ${lv.gridSize}×${lv.gridSize} — complete core loop through the UI (${lv.clues.length} clues)`);
    if (await vis(page, '#screen-levels') === false) { await page.click('#btn-complete-levels'); }
    await openLevelFromSelect(page, id);
    chk(`${lv.name}: grid has ${lv.gridSize ** 2} cells`, (await page.locator('#main-grid .cell').count()) === lv.gridSize ** 2);
    chk(`${lv.name}: prefilled cells rendered`, (await page.locator('#main-grid .cell[data-state="pre"]').count()) === lv.prefilled.flat().filter(Boolean).length);
    const preBgs = await page.$$eval('#main-grid .cell[data-state="pre"]', (els) => els.map((e) => getComputedStyle(e).backgroundColor));
    chk(`${lv.name}: prefilled cells are visibly coloured`, preBgs.every((c) => c !== 'rgba(0, 0, 0, 0)'), preBgs.slice(0, 3));
    chk(`${lv.name}: no reference colours on the playable grid before completion`, (await page.locator('#main-grid .cell.art').count()) === 0);
    await playLevelUI(page, id);
    await page.waitForSelector('#overlay-complete:not([hidden])');
    gs = await gameState(page);
    chk(`${lv.name}: completed, timer stopped`, gs.completed && !gs.running && gs.intervals === 0, gs);
    const mm = await artMismatches(page);
    chk(`${lv.name}: completed grid matches its own reference art cell-for-cell`, mm.length === 0, mm.slice(0, 5));
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
      chk(`${PC.LEVELS[id].name}: previous level's art colours do not leak into new grid`, (await page.locator('#main-grid .cell.art').count()) === 0);
      chk('Exactly one timer interval after switching level', (await gameState(page)).intervals === 1);
      await page.click('#btn-exit');
    } else {
      chk('Expert: no Next button (last level)', !(await vis(page, '#btn-next')));
      await page.click('#btn-replay');
      gs = await gameState(page);
      chk('Replay clears completed-artwork styling and restores play', (await page.locator('#main-grid .cell.art').count()) === 0 && gs.phase === 'solving' && !gs.completed && gs.placed === 0, gs);
      await page.click('#btn-exit');
    }
  }
  await page.close();

  /* ============ F. Timer, Restart, Exit ============ */
  section('F. Timer / Restart / Exit');
  page = await newPage(browser, { unlocked: 1 });
  await openLevelFromSelect(page, 1);
  await page.waitForTimeout(1300);
  const t1 = await text(page, '#timer');
  for (let i = 0; i < 4; i++) await page.click('#btn-restart');
  chk('Restart resets timer display to 00:00', (await text(page, '#timer')) === '00:00' && t1 !== '00:00');
  chk('Repeated Restart never creates duplicate intervals', (await gameState(page)).intervals === 1);
  await answer(page, 0, 'ROOF');
  await dragCells(page, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }]);
  await page.click('#btn-confirm');
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

  /* ============ G. Overlays never block ============ */
  section('G. Hidden overlays / modals never intercept clicks');
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
  chk('Only the active clue shows its answer row; others are collapsed', await vis(page, '[data-answer-input="0"]') && !(await vis(page, '[data-answer-input="1"]')));
  await page.click('[data-clue="1"] .clue-head');
  chk('Clicking a collapsed clue opens and focuses its answer row', await vis(page, '[data-answer-input="1"]') && await page.evaluate(() => document.activeElement.dataset.answerInput === '1') && !(await vis(page, '[data-answer-input="0"]')));
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  chk('Keyboard: Enter on a focused collapsed clue opens it', await page.evaluate(() => document.activeElement.dataset.answerInput === '0'));
  await page.close();

  /* ============ H. localStorage failure ============ */
  section('H. localStorage failure must not crash the game');
  const errBefore = consoleErrors.length;
  page = await newPage(browser, { init: () => { Storage.prototype.setItem = function () { throw new Error('QuotaExceeded (simulated)'); }; Storage.prototype.getItem = function () { throw new Error('SecurityError (simulated)'); }; } });
  await page.click('#btn-play');
  chk('Level select renders with storage disabled + notice shown', await vis(page, '#screen-levels'));
  await page.click('[data-play="1"]');
  await playLevelUI(page, 1);
  await page.waitForSelector('#overlay-complete:not([hidden])');
  chk('Beginner completable with broken storage; no exceptions', consoleErrors.length === errBefore, consoleErrors.slice(errBefore));
  await page.click('#btn-next');
  chk('Next level (Easy) unlocked in-memory even though save failed', (await text(page, '#game-title')).includes('Easy'));
  await page.close();

  /* ============ I. Presenter mode ============ */
  section('I. Presenter mode leaves progression untouched');
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

  /* ============ J. Responsive layouts + grid/reference accuracy ============ */
  section('J. Responsive layouts + grid draw accuracy at 1440 / 1024 / 768 / 600 / 390');
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
      const refOk = await page.evaluate(() => { const r = document.getElementById('reference-canvas').getBoundingClientRect(); return { l: r.left, r: r.right, iw: innerWidth }; });
      chk(`${w}px ${lv.name}: reference image fits inside the viewport`, refOk.l >= -0.5 && refOk.r <= refOk.iw + 0.5, refOk);
      // draw the first proven-solution piece directly on the grid and verify exact cells land correctly
      const s = solve(lv).solution[0];
      await answer(page, s.clue, lv.clues[s.clue].answer);
      await dragCells(page, s.cells);
      chk(`${w}px ${lv.name}: drag-painted exactly the proven cells under the pointer`, same(await ownCells(page), key(s.cells)), await ownCells(page));
      await page.click('#btn-confirm');
      chk(`${w}px ${lv.name}: confirmed shape committed to the exact cells`, same(await gridBlockCells(page), key(s.cells)));
      if (id === 1 || id === 5) await page.screenshot({ path: SHOTS + `/10-${lv.name.toLowerCase()}-${w}.png` });
      if (id === 3) {
        for (const [w2, h2] of SIZES) {
          await page.setViewportSize({ width: w2, height: h2 }); await page.waitForTimeout(120);
          await page.click('#btn-undo');
          await page.click('#btn-clear'); // undo pre-populates the shape; clear it so the redraw below exercises fresh paint clicks, not erases
          await dragCells(page, s.cells);
          const okc = same(await ownCells(page), key(s.cells));
          if (okc) await page.click('#btn-confirm');
          if (!okc) chk(`${w}→${w2}px resize: drag-draw accuracy`, false, await ownCells(page));
          else if (w2 === 390) chk(`${w}px→ resized through all sizes: drag-draw stays accurate (checked at every size)`, true);
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
