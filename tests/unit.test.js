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

console.log('Polyomino validation');
test('correct count + connected → valid', () => assert.strictEqual(Polyomino.validate(cells([0, 0], [1, 0], [1, 1], [1, 2]), 4).valid, true));
test('correct count + disconnected → invalid', () => { const r = Polyomino.validate(cells([0, 0], [1, 0], [3, 3], [3, 4]), 4); assert.strictEqual(r.valid, false); assert.strictEqual(r.message, 'All pixels must be connected.'); });
test('too few cells → invalid "Use exactly N pixels."', () => { const r = Polyomino.validate(cells([0, 0], [1, 0]), 4); assert.strictEqual(r.valid, false); assert.strictEqual(r.message, 'Use exactly 4 pixels.'); });
test('too many cells → invalid', () => assert.strictEqual(Polyomino.validate(cells([0, 0], [1, 0], [2, 0], [3, 0], [4, 0]), 4).valid, false));
test('diagonal-only → invalid', () => assert.strictEqual(Polyomino.validate(cells([0, 0], [1, 1]), 2).valid, false));
test('diagonal chain of 4 → invalid', () => assert.strictEqual(Polyomino.validate(cells([0, 0], [1, 1], [2, 2], [3, 3]), 4).valid, false));
test('irregular connected (S/Z/T/L/plus/snake) → valid', () => {
  assert.ok(Polyomino.validate(cells([1, 0], [2, 0], [0, 1], [1, 1]), 4).valid);
  assert.ok(Polyomino.validate(cells([1, 0], [0, 1], [1, 1], [2, 1], [1, 2]), 5).valid);
  assert.ok(Polyomino.validate(cells([0, 0], [1, 0], [1, 1], [2, 1], [2, 2], [3, 2]), 6).valid);
  assert.ok(Polyomino.validate(cells([0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5]), 6).valid); // straight line
});
test('single cell is valid for n=1; empty invalid', () => { assert.ok(Polyomino.validate(cells([2, 2]), 1).valid); assert.ok(!Polyomino.validate([], 3).valid); });
test('stray cells identified', () => assert.strictEqual(Polyomino.stray(cells([0, 0], [1, 0], [2, 0], [5, 5])).length, 1));
test('normalize removes blank rows/cols', () => assert.deepStrictEqual(Polyomino.normalize(cells([3, 4], [4, 4], [4, 5])), cells([0, 0], [1, 0], [1, 1])));
test('rotate keeps size, connectivity, normalised', () => {
  let s = Polyomino.normalize(cells([0, 0], [1, 0], [1, 1], [1, 2]));
  for (let i = 0; i < 4; i++) { s = Polyomino.rotate(s); assert.strictEqual(s.length, 4); assert.ok(Polyomino.isConnected(s)); assert.strictEqual(Math.min(...s.map((c) => c.x)), 0); assert.strictEqual(Math.min(...s.map((c) => c.y)), 0); }
  assert.deepStrictEqual(s, Polyomino.normalize(cells([0, 0], [1, 0], [1, 1], [1, 2])));
});

console.log('Grid placement');
const shape = cells([0, 0], [1, 0], [1, 1]); // L-tromino
test('fully inside empty grid → valid', () => assert.ok(Grid.canPlace(Grid.create(8), shape, 2, 2).ok));
test('out of bounds left', () => { const r = Grid.canPlace(Grid.create(8), shape, -1, 2); assert.strictEqual(r.reason, 'out-of-bounds'); });
test('out of bounds right (partially)', () => assert.strictEqual(Grid.canPlace(Grid.create(8), shape, 7, 2).reason, 'out-of-bounds'));
test('out of bounds top', () => assert.strictEqual(Grid.canPlace(Grid.create(8), shape, 2, -1).reason, 'out-of-bounds'));
test('out of bounds bottom', () => assert.strictEqual(Grid.canPlace(Grid.create(8), shape, 2, 7).reason, 'out-of-bounds'));
test('completely outside → invalid', () => assert.ok(!Grid.canPlace(Grid.create(8), shape, 20, 20).ok));
test('grid edges exactly: top-left and bottom-right valid', () => { assert.ok(Grid.canPlace(Grid.create(8), shape, 0, 0).ok); assert.ok(Grid.canPlace(Grid.create(8), shape, 6, 6).ok); });
test('overlap → collision', () => { const g = Grid.create(8); Grid.put(g, shape, 2, 2, { clue: 0, block: 1 }); const r = Grid.canPlace(g, shape, 3, 2); assert.strictEqual(r.reason, 'collision'); assert.strictEqual(r.message, 'That space is already occupied.'); });
test('touching without overlap → valid', () => { const g = Grid.create(8); Grid.put(g, shape, 2, 2, { clue: 0, block: 1 }); assert.ok(Grid.canPlace(g, shape, 4, 2).ok); });
test('canPlace never mutates grid', () => { const g = Grid.create(8); Grid.canPlace(g, shape, 3, 3); assert.ok(g.every((r) => r.every((c) => c === null))); });
test('cellFromPoint uses rendered rect at any size', () => {
  for (const w of [180, 320, 520]) {
    const rect = { left: 40, top: 60, width: w, height: w };
    const cw = w / 8;
    for (let cx = 0; cx < 8; cx++) { const p = Grid.cellFromPoint(rect, 8, 40 + (cx + 0.5) * cw, 60 + 3.5 * cw); assert.strictEqual(p.x, cx); assert.strictEqual(p.y, 3); assert.ok(p.inside); }
    assert.ok(!Grid.cellFromPoint(rect, 8, 39, 100).inside);
    assert.ok(!Grid.cellFromPoint(rect, 8, 40 + w, 100).inside);
  }
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

console.log('Level data + solvability');
test('every level: rows are square, answer lengths == player cells', () => PC.LEVELS.forEach((l) => { assert.strictEqual(l.rows.length, l.gridSize); assert.strictEqual(l.totalPixels, l.playerCells, `L${l.id}`); }));
test('Medium matches spec (FLOWER 6, LEAF 4, BEE 3, STEM 4, SUN 3; 12x12)', () => {
  const m = PC.LEVELS.find((l) => l.id === 3);
  assert.strictEqual(m.gridSize, 12);
  assert.deepStrictEqual(m.clues.map((c) => [c.answer, c.answer.length]), [['FLOWER', 6], ['LEAF', 4], ['BEE', 3], ['STEM', 4], ['SUN', 3]]);
  assert.deepStrictEqual(m.clues.map((c) => c.clue), ['A colourful plant with petals', 'Green part on a stem', 'Buzzing garden visitor', 'Holds the flower upright', 'Gives warmth and light']);
});
test('grid sizes 8/10/12/15/20 and 3 clues in Beginner', () => { assert.deepStrictEqual(PC.LEVELS.map((l) => l.gridSize), [8, 10, 12, 15, 20]); assert.strictEqual(PC.LEVELS[0].clues.length, 3); });
test('difficulty scales (clues, pixels, longest word)', () => {
  for (let i = 1; i < PC.LEVELS.length; i++) assert.ok(PC.LEVELS[i].playerCells > PC.LEVELS[i - 1].playerCells || PC.LEVELS[i].id === 3);
});
PC.LEVELS.forEach((l) => test(`L${l.id} ${l.name} has at least one valid solution (constructive proof)`, () => { const r = solve(l); assert.ok(r.solution, r.error); }));

console.log('Game engine (all levels solved through the public Game API)');
function fakeStorage(fail) {
  const m = {};
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { if (fail) throw new Error('quota'); m[k] = v; }, _m: m };
}
function playSolution(levelId, opts = {}) {
  const lv = PC.LEVELS.find((l) => l.id === levelId);
  const sol = solve(lv).solution;
  assert.ok(Game.startLevel(levelId).ok);
  for (const piece of sol) {
    const r = Game.submitAnswer(piece.clue, lv.clues[piece.clue].answer);
    assert.strictEqual(r.status, 'correct');
    assert.strictEqual(r.n, lv.clues[piece.clue].answer.length);
    const minX = Math.min(...piece.cells.map((c) => c.x)), minY = Math.min(...piece.cells.map((c) => c.y));
    const rel = piece.cells.map((c) => ({ x: c.x - minX, y: c.y - minY }));
    rel.forEach((c) => Game.toggleBuilderCell(c.x, c.y));
    assert.ok(Game.confirmShape().ok);
    const p = Game.place(minX, minY);
    assert.ok(p.ok, `place failed ${p.reason}`);
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
  assert.strictEqual(Game.submitAnswer(1, 'DOOR').status, 'busy', 'must place current block first');
  assert.strictEqual(Game.state.solvedClues.length, 1);
  assert.strictEqual(Game.state.progress, undefined);
  assert.strictEqual(Game.progress().done, 0, 'progress only after placement');
  Game.exit();
});

test('builder: too few / too many / disconnected / diagonal rejected; state unchanged', () => {
  Game.startLevel(1); Game.submitAnswer(0, 'ROOF');
  [[0, 0], [1, 0]].forEach(([x, y]) => Game.toggleBuilderCell(x, y));
  let r = Game.confirmShape(); assert.ok(!r.ok); assert.strictEqual(r.message, 'Use exactly 4 pixels.');
  [[2, 0], [3, 0], [3, 1]].forEach(([x, y]) => Game.toggleBuilderCell(x, y));
  r = Game.confirmShape(); assert.ok(!r.ok); assert.strictEqual(r.message, 'Use exactly 4 pixels.');
  Game.resetBuilder(); assert.strictEqual(Game.active().builder.length, 0);
  [[0, 0], [1, 1], [2, 2], [3, 3]].forEach(([x, y]) => Game.toggleBuilderCell(x, y));
  r = Game.confirmShape(); assert.strictEqual(r.reason, 'disconnected'); assert.strictEqual(r.message, 'All pixels must be connected.');
  assert.strictEqual(Game.phase(), 'building');
  Game.resetBuilder();
  [[0, 0], [1, 0], [1, 1], [1, 2]].forEach(([x, y]) => Game.toggleBuilderCell(x, y));
  assert.ok(Game.confirmShape().ok); assert.strictEqual(Game.phase(), 'placing');
  Game.exit();
});

test('failed placement leaves grid/blocks/queue untouched (out-of-bounds & collision)', () => {
  Game.startLevel(1); Game.submitAnswer(0, 'ROOF');
  [[0, 0], [1, 0], [2, 0], [3, 0]].forEach(([x, y]) => Game.toggleBuilderCell(x, y)); Game.confirmShape();
  const snap = () => JSON.stringify([Game.state.grid, Game.state.placedBlocks, Game.state.queue.length, Game.state.earnedPixels]);
  const before = snap();
  for (const [x, y] of [[5, 0], [-1, 0], [0, 8], [0, -1], [99, 99]]) { const r = Game.place(x, y); assert.ok(!r.ok); assert.strictEqual(snap(), before); }
  assert.ok(Game.place(0, 0).ok);
  Game.submitAnswer(1, 'DOOR');
  [[0, 0], [1, 0], [2, 0], [3, 0]].forEach(([x, y]) => Game.toggleBuilderCell(x, y)); Game.confirmShape();
  const b2 = snap(); const r = Game.place(2, 0); assert.strictEqual(r.reason, 'collision'); assert.strictEqual(snap(), b2);
  assert.ok(Game.place(4, 0).ok, 'touching without overlap is fine');
  Game.exit();
});

test('undo returns block to tray; restart resets; timer never duplicates', () => {
  Game.startLevel(1); assert.strictEqual(Game.liveIntervals, 1);
  Game.submitAnswer(0, 'ROOF');
  [[0, 0], [1, 0], [2, 0], [3, 0]].forEach(([x, y]) => Game.toggleBuilderCell(x, y)); Game.confirmShape(); Game.place(0, 0);
  assert.strictEqual(Game.progress().done, 1);
  assert.ok(Game.undo().ok);
  assert.strictEqual(Game.progress().done, 0); assert.strictEqual(Game.phase(), 'placing'); assert.strictEqual(Game.state.undos, 1);
  assert.ok(Game.state.grid.every((r) => r.every((c) => c === null)));
  assert.ok(Game.place(0, 4).ok); // re-place elsewhere
  assert.ok(!Game.undo().ok === false);
  Game.restart(); Game.restart(); Game.restart();
  assert.strictEqual(Game.liveIntervals, 1, 'exactly one interval after repeated restarts');
  assert.strictEqual(Game.state.solvedClues.length, 0); assert.strictEqual(Game.state.undos, 0); assert.strictEqual(Game.progress().done, 0);
  assert.strictEqual(Game.undo().ok, false);
  Game.exit(); assert.strictEqual(Game.liveIntervals, 0);
});

test('undo while another block is pending keeps both (queue)', () => {
  Game.startLevel(1);
  Game.submitAnswer(0, 'ROOF'); [[0, 0], [1, 0], [2, 0], [3, 0]].forEach(([x, y]) => Game.toggleBuilderCell(x, y)); Game.confirmShape(); Game.place(0, 0);
  Game.submitAnswer(1, 'DOOR'); Game.toggleBuilderCell(0, 0);
  Game.undo();
  assert.strictEqual(Game.state.queue.length, 2); assert.strictEqual(Game.phase(), 'placing'); assert.strictEqual(Game.active().clue, 0);
  assert.ok(Game.place(0, 0).ok); assert.strictEqual(Game.phase(), 'building'); assert.strictEqual(Game.active().clue, 1);
  Game.exit();
});

test('rotate + reshape', () => {
  Game.startLevel(1); Game.submitAnswer(0, 'ROOF');
  [[0, 0], [1, 0], [2, 0], [3, 0]].forEach(([x, y]) => Game.toggleBuilderCell(x, y)); Game.confirmShape();
  Game.rotate(); assert.deepStrictEqual(Game.active().shape, cells([0, 0], [0, 1], [0, 2], [0, 3]));
  Game.reshape(); assert.strictEqual(Game.phase(), 'building'); assert.strictEqual(Game.active().builder.length, 4);
  Game.exit();
});

test('hint reveals letters, costs score, capped at len-1; free target flash in other phases', () => {
  Game.startLevel(3);
  let r = Game.hint(); assert.ok(r.ok && !r.free); assert.strictEqual(Game.state.hintsUsed, 1);
  Game.hint(); Game.hint(); Game.hint(); Game.hint(); assert.strictEqual(Game.state.hintReveals[0], 5);
  r = Game.hint(); assert.ok(!r.ok); assert.strictEqual(Game.state.hintsUsed, 5);
  Game.submitAnswer(0, 'FLOWER'); r = Game.hint(); assert.ok(r.free); assert.strictEqual(Game.state.hintsUsed, 5);
  Game.exit();
});

test('mismatching picture is not "complete" and Undo can recover', () => {
  Game.startLevel(3); // place every block as a straight line in the wrong spot
  const lv = Game.state.currentLevel;
  const place = (i, sx, sy) => { const c = lv.clues[i]; Game.submitAnswer(i, c.answer); for (let x = 0; x < c.answer.length; x++) Game.toggleBuilderCell(x, 0); Game.confirmShape(); return Game.place(sx, sy); };
  assert.ok(place(0, 0, 0).ok); assert.ok(place(1, 0, 2).ok); assert.ok(place(2, 0, 4).ok); assert.ok(place(3, 0, 6).ok);
  const last = place(4, 0, 8);
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
