// Pure-logic unit tests. Run: node tests/unit.test.js
const assert = require('assert');
require('../js/levels.js'); require('../js/grid.js'); require('../js/polyomino.js'); require('../js/crossword.js');
require('../js/scoring.js'); require('../js/storage.js'); require('../js/game.js');
const { solve } = require('../tools/verify_levels.js');
const PC = globalThis.PC;
const { Polyomino, Grid, Crossword, Scoring, Storage, Game } = PC;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n     ' + e.message); }
}
const cells = (...pairs) => pairs.map(([x, y]) => ({ x, y }));

console.log('Polyomino validation (used directly on the main grid\'s absolute coordinates now)');
test('correct count + connected → valid', () => assert.strictEqual(Polyomino.validate(cells([0, 0], [1, 0], [1, 1], [1, 2]), 4).valid, true));
test('correct count + disconnected → invalid', () => { const r = Polyomino.validate(cells([0, 0], [1, 0], [3, 3], [3, 4]), 4); assert.strictEqual(r.valid, false); assert.strictEqual(r.message, 'All pixels must be connected.'); });
test('too few cells → invalid "Use exactly N pixels."', () => { const r = Polyomino.validate(cells([0, 0], [1, 0]), 4); assert.strictEqual(r.valid, false); assert.strictEqual(r.message, 'Use exactly 4 pixels.'); });
test('too many cells → invalid', () => assert.strictEqual(Polyomino.validate(cells([0, 0], [1, 0], [2, 0], [3, 0], [4, 0]), 4).valid, false));
test('diagonal-only → invalid', () => assert.strictEqual(Polyomino.validate(cells([0, 0], [1, 1]), 2).valid, false));
test('diagonal chain of 4 → invalid', () => assert.strictEqual(Polyomino.validate(cells([0, 0], [1, 1], [2, 2], [3, 3]), 4).valid, false));
test('irregular connected (S/Z/T/L/plus/snake) → valid, anywhere on the grid', () => {
  assert.ok(Polyomino.validate(cells([11, 5], [12, 5], [10, 6], [11, 6]), 4).valid);
  assert.ok(Polyomino.validate(cells([1, 0], [0, 1], [1, 1], [2, 1], [1, 2]), 5).valid);
  assert.ok(Polyomino.validate(cells([0, 0], [1, 0], [1, 1], [2, 1], [2, 2], [3, 2]), 6).valid);
  assert.ok(Polyomino.validate(cells([4, 4], [4, 5], [4, 6], [4, 7], [4, 8], [4, 9]), 6).valid); // straight line
});
test('single cell is valid for n=1; empty invalid', () => { assert.ok(Polyomino.validate(cells([2, 2]), 1).valid); assert.ok(!Polyomino.validate([], 3).valid); });
test('stray cells identified (used to highlight the disconnected pixels on the grid)', () => assert.strictEqual(Polyomino.stray(cells([0, 0], [1, 0], [2, 0], [5, 5])).length, 1));

console.log('Grid occupancy (direct-draw placement model)');
test('cells start free; put() occupies them, remove() frees them', () => {
  const g = Grid.create(8);
  assert.ok(Grid.isFree(g, 2, 2) && !Grid.isOccupied(g, 2, 2));
  Grid.put(g, cells([2, 2], [3, 2]), { clue: 0, block: 1 });
  assert.ok(Grid.isOccupied(g, 2, 2) && Grid.isOccupied(g, 3, 2) && Grid.isFree(g, 4, 2));
  Grid.remove(g, cells([2, 2], [3, 2]));
  assert.ok(Grid.isFree(g, 2, 2) && Grid.isFree(g, 3, 2));
});
test('inBounds / isFree / isOccupied reject out-of-range coordinates', () => {
  const g = Grid.create(8);
  assert.ok(!Grid.inBounds(g, -1, 0) && !Grid.inBounds(g, 8, 0) && !Grid.inBounds(g, 0, 8));
  assert.ok(!Grid.isFree(g, -1, 0) && !Grid.isOccupied(g, -1, 0));
});
test('fromLevel pre-occupies the level\'s prefilled cells only', () => {
  const lv = PC.LEVELS.find((l) => l.id === 4); // Hard has a prefilled stone/grass base
  const g = Grid.fromLevel(lv);
  let pre = 0, free = 0;
  for (let y = 0; y < lv.gridSize; y++) for (let x = 0; x < lv.gridSize; x++) {
    if (lv.prefilled[y][x]) { assert.ok(Grid.isOccupied(g, x, y)); pre++; } else { assert.ok(Grid.isFree(g, x, y)); free++; }
  }
  assert.ok(pre > 0 && free > 0);
});
test('cellFromPoint uses rendered rect at any size (resize-safe)', () => {
  for (const w of [180, 320, 520]) {
    const rect = { left: 40, top: 60, width: w, height: w };
    const cw = w / 8;
    for (let cx = 0; cx < 8; cx++) { const p = Grid.cellFromPoint(rect, 8, 40 + (cx + 0.5) * cw, 60 + 3.5 * cw); assert.strictEqual(p.x, cx); assert.strictEqual(p.y, 3); assert.ok(p.inside); }
    assert.ok(!Grid.cellFromPoint(rect, 8, 39, 100).inside);
    assert.ok(!Grid.cellFromPoint(rect, 8, 40 + w, 100).inside);
  }
});
test('target/occupancy comparison (final-puzzle validation stays internal, never rendered)', () => {
  // target[y][x]: row y=0 requires x=1; row y=1 requires x=1. So only (1,0) and (1,1) are required.
  const target = [[0, 1], [0, 1]];
  const g = Grid.create(2);
  assert.ok(!Grid.compare(g, target).match);
  Grid.put(g, cells([1, 0], [0, 1], [1, 1]), { clue: 0, block: 1 });
  assert.strictEqual(Grid.compare(g, target).extra.length, 1); // (0,1) not required
  Grid.remove(g, cells([0, 1]));
  assert.ok(Grid.compare(g, target).match);
});

console.log('Crossword');
test('answer check is case/space insensitive', () => assert.strictEqual(Crossword.check({ answer: 'FLOWER' }, ' flow er '), 'correct'));
test('wrong / empty', () => { assert.strictEqual(Crossword.check({ answer: 'FLOWER' }, 'rose'), 'incorrect'); assert.strictEqual(Crossword.check({ answer: 'FLOWER' }, '  '), 'empty'); });
test('hint pattern', () => assert.deepStrictEqual(Crossword.pattern('BEE', 1), ['B', '_', '_']));

console.log('Scoring');
test('fast clean run = 3 stars, 1000', () => { const r = Scoring.compute({ seconds: 30, hints: 0, wrong: 0, undos: 0 }, { parTime: 120 }); assert.strictEqual(r.score, 1000); assert.strictEqual(r.stars, 3); });
test('penalties applied', () => { const r = Scoring.compute({ seconds: 130, hints: 2, wrong: 3, undos: 1 }, { parTime: 120 }); assert.strictEqual(r.score, 1000 - 150 - 75 - 20 - 20); assert.strictEqual(r.stars, 2); });
test('star thresholds', () => { assert.strictEqual(Scoring.stars(850), 3); assert.strictEqual(Scoring.stars(849), 2); assert.strictEqual(Scoring.stars(600), 2); assert.strictEqual(Scoring.stars(599), 1); assert.strictEqual(Scoring.stars(100), 1); });
test('score floors at 100; max 3 stars', () => { assert.strictEqual(Scoring.compute({ seconds: 99999, hints: 50, wrong: 50, undos: 50 }, { parTime: 10 }).score, 100); });
test('formatTime', () => { assert.strictEqual(Scoring.formatTime(161), '02:41'); assert.strictEqual(Scoring.formatTime(0), '00:00'); });

console.log('Level data + solvability (target matrix is unchanged internally)');
test('every level: rows are square, answer lengths == player cells', () => PC.LEVELS.forEach((l) => { assert.strictEqual(l.rows.length, l.gridSize); assert.strictEqual(l.totalPixels, l.playerCells, `L${l.id}`); }));
test('Medium matches spec (FLOWER 6, LEAF 4, BEE 3, STEM 4, SUN 3; 12x12)', () => {
  const m = PC.LEVELS.find((l) => l.id === 3);
  assert.strictEqual(m.gridSize, 12);
  assert.deepStrictEqual(m.clues.map((c) => [c.answer, c.answer.length]), [['FLOWER', 6], ['LEAF', 4], ['BEE', 3], ['STEM', 4], ['SUN', 3]]);
  assert.deepStrictEqual(m.clues.map((c) => c.clue), ['A colourful plant with petals', 'Green part on a stem', 'Buzzing garden visitor', 'Holds the flower upright', 'Gives warmth and light']);
});
test('grid sizes 8/10/12/15/20 and 3 clues in Beginner', () => { assert.deepStrictEqual(PC.LEVELS.map((l) => l.gridSize), [8, 10, 12, 15, 20]); assert.strictEqual(PC.LEVELS[0].clues.length, 3); });
PC.LEVELS.forEach((l) => test(`L${l.id} ${l.name} has at least one valid solution (constructive proof)`, () => { const r = solve(l); assert.ok(r.solution, r.error); }));

console.log('Game engine — direct drawing on the main grid (all levels solved through the public Game API)');
function fakeStorage(fail) {
  const m = {};
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { if (fail) throw new Error('quota'); m[k] = v; }, _m: m };
}
/** Paint a clue's proven-solution cells directly at their absolute grid position and confirm — this
 *  is exactly what a player does by clicking/dragging on the main grid in the new interaction model. */
function drawAndConfirm(piece) {
  piece.cells.forEach((c) => Game.paintCell(c.x, c.y));
  return Game.confirmShape();
}
function playSolution(levelId) {
  const lv = PC.LEVELS.find((l) => l.id === levelId);
  const sol = solve(lv).solution;
  assert.ok(Game.startLevel(levelId).ok);
  for (const piece of sol) {
    const r = Game.submitAnswer(piece.clue, lv.clues[piece.clue].answer);
    assert.strictEqual(r.status, 'correct');
    assert.strictEqual(r.n, lv.clues[piece.clue].answer.length);
    const c = drawAndConfirm(piece);
    assert.ok(c.ok, `confirm failed ${c.reason}`);
  }
  return lv;
}
PC.LEVELS.forEach((l) => test(`L${l.id} ${l.name}: full solve → complete, timer stopped, saved, next unlocked`, () => {
  globalThis.localStorage = fakeStorage(false); Storage.reset(); Storage.data.unlocked = 5; Storage.save();
  Storage.data.unlocked = l.id; // level itself unlocked
  const lv = playSolution(l.id);
  const s = Game.state;
  assert.ok(s.completed);
  assert.strictEqual(Game.isTimerRunning(), false);
  assert.strictEqual(Game.liveIntervals, 0);
  assert.ok(s.score >= 100 && s.stars >= 1 && s.stars <= 3);
  assert.strictEqual(Game.progress().pct, 100);
  assert.ok(Storage.data.completed[l.id]);
  assert.strictEqual(Storage.data.unlocked, Math.min(5, l.id + 1));
  const t = s.elapsedTime; assert.strictEqual(s.elapsedTime, t);
  Game.exit();
}));

test('answers: wrong / empty / duplicate / pixel count / busy', () => {
  globalThis.localStorage = fakeStorage(false); Storage.reset();
  Game.startLevel(1);
  const wrong = Game.submitAnswer(0, 'HOUSE');
  assert.strictEqual(wrong.status, 'incorrect'); assert.strictEqual(wrong.message, 'Not quite — try again!');
  assert.ok(!JSON.stringify(wrong).includes('ROOF'));
  assert.strictEqual(Game.state.earnedPixels, 0);
  assert.strictEqual(Game.submitAnswer(0, '').status, 'empty');
  assert.strictEqual(Game.submitAnswer(0, 'roof').status, 'correct');
  assert.strictEqual(Game.state.earnedPixels, 4);
  assert.strictEqual(Game.submitAnswer(0, 'ROOF').status, 'duplicate');
  assert.strictEqual(Game.state.earnedPixels, 4, 'duplicate must not grant pixels again');
  assert.strictEqual(Game.submitAnswer(1, 'DOOR').status, 'busy', 'must finish the current shape first');
  assert.strictEqual(Game.state.solvedClues.length, 1);
  assert.strictEqual(Game.progress().done, 0, 'progress only after a shape is confirmed');
  Game.exit();
});

test('direct drawing: click toggles a single cell; click-and-drag paints/erases multiple', () => {
  Game.startLevel(1); Game.submitAnswer(0, 'ROOF'); // 4 pixels
  assert.strictEqual(Game.cellInfo(2, 2).kind, 'empty');
  Game.toggleCell(2, 2); // single click = toggle
  assert.strictEqual(Game.cellInfo(2, 2).kind, 'own');
  Game.toggleCell(2, 2); // click again removes it
  assert.strictEqual(Game.cellInfo(2, 2).kind, 'empty');
  [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 3 }].forEach((c) => Game.paintCell(c.x, c.y));
  assert.strictEqual(Game.active().cells.length, 4);
  Game.exit();
});

test('pixel budget (exactly N pixels per clue): extra paint attempts are rejected with the clue\'s answer named', () => {
  Game.startLevel(1); Game.submitAnswer(0, 'ROOF');
  [[0, 0], [1, 0], [2, 0], [3, 0]].forEach(([x, y]) => Game.paintCell(x, y));
  assert.strictEqual(Game.active().cells.length, 4);
  const r = Game.paintCell(4, 0);
  assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'budget');
  assert.strictEqual(r.message, 'All 4 pixels for ROOF have been placed.');
  assert.strictEqual(Game.active().cells.length, 4, 'rejected pixel must not be added');
  Game.exit();
});

test('painting the same cell twice (e.g. a drag crossing it again) is a no-op, not a second pixel', () => {
  Game.startLevel(1); Game.submitAnswer(0, 'ROOF');
  Game.paintCell(1, 1); Game.paintCell(1, 1); Game.paintCell(1, 1);
  assert.strictEqual(Game.active().cells.length, 1);
  Game.eraseCell(5, 5); // erasing a cell that was never painted is also a safe no-op
  assert.strictEqual(Game.active().cells.length, 1);
  Game.exit();
});

test('clicking/painting a cell already occupied by another clue\'s confirmed shape is rejected and never erases it', () => {
  Game.startLevel(1); Game.submitAnswer(0, 'ROOF');
  [[0, 0], [1, 0], [2, 0], [3, 0]].forEach(([x, y]) => Game.paintCell(x, y)); Game.confirmShape();
  Game.submitAnswer(1, 'DOOR');
  const r = Game.paintCell(0, 0); // belongs to the already-placed ROOF shape
  assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'occupied'); assert.strictEqual(r.message, 'That space is already occupied.');
  assert.ok(Grid.isOccupied(Game.state.grid, 0, 0), 'the other clue\'s cell must remain occupied');
  Game.exit();
});

test('drawing: too few / too many / disconnected / diagonal rejected; state unchanged', () => {
  Game.startLevel(1); Game.submitAnswer(0, 'ROOF');
  [[0, 0], [1, 0]].forEach(([x, y]) => Game.paintCell(x, y));
  let r = Game.confirmShape(); assert.ok(!r.ok); assert.strictEqual(r.message, 'Use exactly 4 pixels.');
  Game.clearDrawing(); assert.strictEqual(Game.active().cells.length, 0);
  [[0, 0], [1, 1], [2, 2], [3, 3]].forEach(([x, y]) => Game.paintCell(x, y));
  r = Game.confirmShape(); assert.strictEqual(r.reason, 'disconnected'); assert.strictEqual(r.message, 'All pixels must be connected.');
  assert.strictEqual(Game.phase(), 'drawing');
  Game.clearDrawing();
  [[0, 0], [1, 0], [1, 1], [1, 2]].forEach(([x, y]) => Game.paintCell(x, y));
  assert.ok(Game.confirmShape().ok);
  Game.exit();
});

test('confirming too many (5 for a 4-pixel clue) is unreachable because the 5th paint is already rejected by the budget', () => {
  Game.startLevel(1); Game.submitAnswer(0, 'ROOF');
  [[0, 0], [1, 0], [2, 0], [3, 0], [0, 1]].forEach(([x, y]) => Game.paintCell(x, y));
  assert.strictEqual(Game.active().cells.length, 4, 'the budget stopped the 5th pixel from ever being added');
  assert.ok(Game.confirmShape().ok);
  Game.exit();
});

test('undo returns the shape to an editable drawing-in-progress; restart resets; timer never duplicates', () => {
  Game.startLevel(1); assert.strictEqual(Game.liveIntervals, 1);
  Game.submitAnswer(0, 'ROOF');
  [[0, 0], [1, 0], [2, 0], [3, 0]].forEach(([x, y]) => Game.paintCell(x, y)); Game.confirmShape();
  assert.strictEqual(Game.progress().done, 1);
  assert.ok(Game.undo().ok);
  assert.strictEqual(Game.progress().done, 0); assert.strictEqual(Game.phase(), 'drawing'); assert.strictEqual(Game.state.undos, 1);
  assert.strictEqual(Game.active().cells.length, 4, 'the undone shape comes back exactly as it was, ready to redraw');
  assert.ok(Game.state.grid.every((r) => r.every((c) => c === null)));
  Game.clearDrawing();
  [[0, 4], [1, 4], [2, 4], [3, 4]].forEach(([x, y]) => Game.paintCell(x, y));
  assert.ok(Game.confirmShape().ok); // re-drawn elsewhere
  Game.restart(); Game.restart(); Game.restart();
  assert.strictEqual(Game.liveIntervals, 1, 'exactly one interval after repeated restarts');
  assert.strictEqual(Game.state.solvedClues.length, 0); assert.strictEqual(Game.state.undos, 0); assert.strictEqual(Game.progress().done, 0);
  assert.strictEqual(Game.undo().ok, false);
  Game.exit(); assert.strictEqual(Game.liveIntervals, 0);
});

test('undo while another clue is pending keeps both in the queue', () => {
  Game.startLevel(1);
  Game.submitAnswer(0, 'ROOF'); [[0, 0], [1, 0], [2, 0], [3, 0]].forEach(([x, y]) => Game.paintCell(x, y)); Game.confirmShape();
  Game.submitAnswer(1, 'DOOR'); Game.paintCell(4, 4);
  Game.undo();
  assert.strictEqual(Game.state.queue.length, 2); assert.strictEqual(Game.phase(), 'drawing'); assert.strictEqual(Game.active().clue, 0);
  [[0, 0], [1, 0], [2, 0], [3, 0]].forEach(([x, y]) => Game.paintCell(x, y));
  assert.ok(Game.confirmShape().ok); assert.strictEqual(Game.phase(), 'drawing'); assert.strictEqual(Game.active().clue, 1);
  assert.strictEqual(Game.active().cells.length, 1, 'the second clue\'s in-progress pixel was preserved');
  Game.exit();
});

test('hint reveals letters, costs score, capped at len-1; free target flash while drawing', () => {
  Game.startLevel(3);
  let r = Game.hint(); assert.ok(r.ok && !r.free); assert.strictEqual(Game.state.hintsUsed, 1);
  Game.hint(); Game.hint(); Game.hint(); Game.hint(); assert.strictEqual(Game.state.hintReveals[0], 5);
  r = Game.hint(); assert.ok(!r.ok); assert.strictEqual(Game.state.hintsUsed, 5);
  Game.submitAnswer(0, 'FLOWER'); r = Game.hint(); assert.ok(r.free); assert.strictEqual(Game.state.hintsUsed, 5);
  Game.exit();
});

test('mismatching picture is not "complete" and Undo can recover', () => {
  Game.startLevel(3); // draw every shape as a straight line in the wrong spot
  const lv = Game.state.currentLevel;
  const place = (i, sx, sy) => { const c = lv.clues[i]; Game.submitAnswer(i, c.answer); for (let x = 0; x < c.answer.length; x++) Game.paintCell(sx + x, sy); return Game.confirmShape(); };
  assert.ok(place(0, 0, 0).ok); assert.ok(place(1, 0, 1).ok); assert.ok(place(2, 0, 2).ok); assert.ok(place(3, 0, 3).ok);
  const last = place(4, 0, 4);
  assert.ok(last.ok && !last.complete); assert.ok(!Game.state.completed);
  assert.strictEqual(Game.progress().done, 5);
  assert.ok(Game.undo().ok); assert.ok(!Game.state.completed);
  Game.exit();
});

test('localStorage failure cannot crash the game and progress still works in memory', () => {
  globalThis.localStorage = fakeStorage(true); Storage.reset(); Storage.data.unlocked = 1;
  assert.doesNotThrow(() => playSolution(1));
  assert.ok(Game.state.completed); assert.strictEqual(Storage.persistent, false);
  assert.strictEqual(Storage.data.unlocked, 2);
  Game.exit();
});
test('localStorage persistence round-trip', () => {
  const ls = fakeStorage(false); globalThis.localStorage = ls; Storage.reset(); Storage.recordCompletion(1, 900, 3, 40, 5);
  Storage.data = null; Storage.load();
  assert.strictEqual(Storage.data.unlocked, 2); assert.strictEqual(Storage.data.stars[1], 3); assert.ok(Storage.isUnlocked(2)); assert.ok(!Storage.isUnlocked(3));
  globalThis.localStorage = { getItem() { return '{bad json'; }, setItem() {} };
  assert.doesNotThrow(() => Storage.load()); assert.strictEqual(Storage.data.unlocked, 1);
});
test('locked level opened in presenter mode does not change saved progress', () => {
  globalThis.localStorage = fakeStorage(false); Storage.reset();
  playSolution(3); // level 3 is locked (unlocked=1)
  assert.ok(Game.state.completed); assert.strictEqual(Game.state.saveEnabled, false);
  assert.strictEqual(Storage.data.unlocked, 1); assert.ok(!Storage.data.completed[3]);
  Game.exit();
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
