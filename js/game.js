/* game.js — central game state + rules. No DOM access: ui.js renders whatever state says.
 *
 * Interaction model: solving a clue earns N pixels and opens a "drawing" phase where the
 * player paints/erases directly on the main grid (click, or click-and-drag). Exactly N
 * connected cells must be drawn, then Confirm commits them to the grid permanently.
 */
(function () {
  const PC = (globalThis.PC = globalThis.PC || {});
  const { Grid, Polyomino, Crossword, Scoring, Storage } = PC;

  const Game = {
    listeners: [],
    timerHandle: null,
    startedAt: 0,
    liveIntervals: 0, // for tests: must never exceed 1

    state: {
      currentLevel: null,   // level object
      currentClue: 0,       // index of the clue the player is working on
      solvedClues: [],      // clue indices answered correctly
      placedBlocks: [],     // [{id, clue, cells:[{x,y}] (absolute)}]
      grid: [],
      earnedPixels: 0,
      queue: [],            // pending rewards: [{clue, n, cells:[{x,y}] (absolute, being drawn)}]
      hintReveals: {},      // clue -> number of revealed letters
      hintsUsed: 0,
      invalidAttempts: 0,   // wrong answers
      undos: 0,
      elapsedTime: 0,       // seconds (frozen when the level ends)
      score: 0,
      stars: 0,
      breakdown: null,
      completed: false,
      saveEnabled: true,
      blockCounter: 0,
      message: { text: '', type: 'info' }
    },

    on(fn) { Game.listeners.push(fn); },
    emit(type, data) { Game.listeners.forEach((fn) => fn(type, data || {})); },
    setMessage(text, type) { Game.state.message = { text, type: type || 'info' }; },

    /* ---------- timer (exactly one interval at a time) ---------- */
    startTimer() {
      Game.stopTimer(true);
      Game.startedAt = Date.now();
      Game.state.elapsedTime = 0;
      Game.timerHandle = setInterval(() => {
        Game.state.elapsedTime = (Date.now() - Game.startedAt) / 1000;
        Game.emit('tick');
      }, 250);
      Game.liveIntervals++;
    },

    stopTimer(silent) {
      if (Game.timerHandle) {
        clearInterval(Game.timerHandle);
        Game.timerHandle = null;
        Game.liveIntervals--;
        if (!silent) Game.state.elapsedTime = (Date.now() - Game.startedAt) / 1000;
      }
    },

    isTimerRunning() { return Game.timerHandle !== null; },

    /* ---------- lifecycle ---------- */
    levelById(id) { return PC.LEVELS.find((l) => l.id === id); },

    startLevel(id) {
      const level = Game.levelById(id);
      if (!level) return { ok: false };
      // Locked levels opened in presenter mode never touch saved progression.
      const saveEnabled = Storage.isUnlocked(id);
      Game.resetState(level, saveEnabled);
      Game.startTimer();
      Game.emit('levelStarted');
      Game.emit('change');
      return { ok: true };
    },

    resetState(level, saveEnabled) {
      const s = Game.state;
      s.currentLevel = level;
      s.currentClue = 0;
      s.solvedClues = [];
      s.placedBlocks = [];
      s.grid = Grid.fromLevel(level);
      s.earnedPixels = 0;
      s.queue = [];
      s.hintReveals = {};
      s.hintsUsed = 0;
      s.invalidAttempts = 0;
      s.undos = 0;
      s.elapsedTime = 0;
      s.score = 0;
      s.stars = 0;
      s.breakdown = null;
      s.completed = false;
      s.saveEnabled = saveEnabled;
      s.blockCounter = 0;
      Game.setMessage(level.guidance === 'full' ? 'Solve the clue to earn pixels.' : 'Pick a clue and type your answer.', 'info');
    },

    restart() {
      const s = Game.state;
      if (!s.currentLevel) return { ok: false };
      Game.stopTimer(true);
      Game.resetState(s.currentLevel, s.saveEnabled);
      Game.startTimer();
      Game.emit('levelStarted');
      Game.emit('change');
      return { ok: true };
    },

    exit() {
      Game.stopTimer();
      Game.state.currentLevel = null;
      Game.emit('exit');
    },

    /* ---------- derived ---------- */
    phase() {
      const s = Game.state;
      if (s.completed) return 'complete';
      return s.queue.length ? 'drawing' : 'solving';
    },
    active() { return Game.state.queue[0] || null; },
    clueStatus(i) {
      const s = Game.state;
      if (s.placedBlocks.some((b) => b.clue === i)) return 'completed';
      if (s.solvedClues.includes(i)) return 'correct';
      return 'unsolved';
    },
    progress() {
      const s = Game.state;
      const total = s.currentLevel ? s.currentLevel.clues.length : 0;
      const done = s.placedBlocks.length;
      return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
    },

    setActiveClue(i) {
      const s = Game.state;
      if (s.currentLevel && i >= 0 && i < s.currentLevel.clues.length) { s.currentClue = i; Game.emit('change'); }
    },

    /** What a cell on the main grid currently means for the player: used by the UI to pick
     *  a cursor/paint-or-erase mode and to decide what a click should do. */
    cellInfo(x, y) {
      const s = Game.state;
      if (!Grid.inBounds(s.grid, x, y)) return { kind: 'outside' };
      const item = Game.active();
      if (item && item.cells.some((c) => c.x === x && c.y === y)) return { kind: 'own' };
      if (s.grid[y][x] !== null) return { kind: 'occupied' };
      return { kind: 'empty' };
    },

    /* ---------- clues ---------- */
    submitAnswer(i, text) {
      const s = Game.state;
      const clue = s.currentLevel.clues[i];
      if (!clue || s.completed) return { status: 'invalid' };
      if (s.solvedClues.includes(i)) {
        Game.setMessage('You already solved that clue.', 'info');
        Game.emit('change');
        return { status: 'duplicate', message: 'You already solved that clue.' };
      }
      const verdict = Crossword.check(clue, text);
      if (verdict === 'empty') return { status: 'empty' };
      if (Game.phase() !== 'solving') {
        const msg = 'Finish your current shape before solving another clue!';
        Game.setMessage(msg, 'warn');
        Game.emit('change');
        return { status: 'busy', message: msg };
      }
      if (verdict === 'incorrect') {
        s.invalidAttempts++;
        Game.setMessage('Not quite — try again!', 'error');
        Game.emit('wrong', { clue: i });
        Game.emit('change');
        return { status: 'incorrect', message: 'Not quite — try again!' };
      }
      const n = clue.answer.length;
      s.solvedClues.push(i);
      s.earnedPixels += n;
      s.queue.push({ clue: i, n, cells: [] });
      s.currentClue = i;
      Game.setMessage(`Correct! You earned ${n} pixels. Draw a connected shape on the grid.`, 'success');
      Game.emit('correct', { clue: i, n });
      Game.emit('change');
      return { status: 'correct', n, message: `Correct! You earned ${n} pixels.` };
    },

    /* ---------- direct drawing on the main grid ---------- */
    drawStatusMessage(item) {
      const c = item.cells.length;
      if (c === item.n) return Polyomino.isConnected(item.cells) ? 'Looks good — press Confirm Shape.' : 'All pixels must be connected.';
      if (c === 0) return `Draw ${item.n} connected pixels on the grid.`;
      return `${item.n - c} more pixel${item.n - c > 1 ? 's' : ''} to go.`;
    },

    /** Add one cell to the shape being drawn. No-op if already drawn. Rejects foreign-occupied
     *  cells and rejects once the pixel budget (N pixels) is already spent. */
    paintCell(x, y) {
      if (Game.phase() !== 'drawing') return { ok: false };
      const s = Game.state, item = Game.active();
      if (!Grid.inBounds(s.grid, x, y)) return { ok: false };
      if (item.cells.some((c) => c.x === x && c.y === y)) return { ok: true, noop: true };
      if (s.grid[y][x] !== null) {
        Game.setMessage('That space is already occupied.', 'error');
        Game.emit('cellBlocked', { x, y });
        Game.emit('change');
        return { ok: false, reason: 'occupied', message: 'That space is already occupied.' };
      }
      if (item.cells.length >= item.n) {
        const word = s.currentLevel.clues[item.clue].answer;
        const msg = `All ${item.n} pixels for ${word} have been placed.`;
        Game.setMessage(msg, 'warn');
        Game.emit('budgetExceeded', { x, y });
        Game.emit('change');
        return { ok: false, reason: 'budget', message: msg };
      }
      item.cells.push({ x, y });
      Game.setMessage(Game.drawStatusMessage(item), 'info');
      Game.emit('change');
      return { ok: true, count: item.cells.length };
    },

    /** Remove one cell from the shape being drawn. No-op if it isn't currently drawn. */
    eraseCell(x, y) {
      if (Game.phase() !== 'drawing') return { ok: false };
      const item = Game.active();
      const idx = item.cells.findIndex((c) => c.x === x && c.y === y);
      if (idx < 0) return { ok: true, noop: true };
      item.cells.splice(idx, 1);
      Game.setMessage(Game.drawStatusMessage(item), 'info');
      Game.emit('change');
      return { ok: true, count: item.cells.length };
    },

    /** Plain click/tap on a cell (no drag): toggle it. Used to decide a drag's paint/erase mode too. */
    toggleCell(x, y) {
      const info = Game.cellInfo(x, y);
      if (info.kind === 'own') return Game.eraseCell(x, y);
      return Game.paintCell(x, y);
    },

    clearDrawing() {
      if (Game.phase() !== 'drawing') return { ok: false };
      const item = Game.active();
      item.cells = [];
      Game.setMessage(`Draw ${item.n} connected pixels on the grid.`, 'info');
      Game.emit('change');
      return { ok: true };
    },

    /** Lock in the current drawing: valid only at exactly N connected cells. On success the
     *  cells become a permanent placed block and the next queued clue (if any) becomes active. */
    confirmShape() {
      if (Game.phase() !== 'drawing') return { ok: false };
      const s = Game.state, item = Game.active();
      const v = Polyomino.validate(item.cells, item.n);
      if (!v.valid) {
        Game.setMessage(v.message, 'error');
        Game.emit('shapeInvalid', v);
        Game.emit('change');
        return { ok: false, reason: v.reason, message: v.message, stray: v.stray };
      }
      const id = ++s.blockCounter;
      const cells = item.cells.map((c) => ({ x: c.x, y: c.y }));
      Grid.put(s.grid, cells, { clue: item.clue, block: id });
      s.placedBlocks.push({ id, clue: item.clue, cells });
      s.queue.shift();

      const cmp = Grid.compare(s.grid, s.currentLevel.target);
      const offTarget = cells.filter((c) => !s.currentLevel.target[c.y][c.x]).length;
      const allPlaced = s.placedBlocks.length === s.currentLevel.clues.length;

      if (cmp.match && allPlaced && !s.queue.length) {
        Game.setMessage('Shape placed — the picture is complete!', 'success');
        Game.emit('placed', { id, offTarget });
        Game.completeLevel();
        return { ok: true, complete: true, offTarget };
      }
      if (allPlaced) {
        Game.setMessage('All shapes are placed but the picture doesn\'t match yet. Use Undo or Restart to rearrange.', 'warn');
      } else if (offTarget > 0) {
        Game.setMessage(`Placed — but ${offTarget} pixel${offTarget > 1 ? 's are' : ' is'} outside the picture. Undo if that wasn't intended.`, 'warn');
      } else {
        Game.setMessage(s.queue.length ? 'Nice! Now draw your next shape.' : 'Placed! Pick the next clue.', 'success');
      }
      Game.emit('placed', { id, offTarget });
      Game.emit('change');
      return { ok: true, complete: false, offTarget };
    },

    /** Undo last confirmed shape: its cells return to the grid as an editable drawing-in-progress. */
    undo() {
      const s = Game.state;
      if (s.completed) return { ok: false };
      const last = s.placedBlocks.pop();
      if (!last) { Game.setMessage('Nothing to undo yet.', 'info'); Game.emit('change'); return { ok: false, message: 'Nothing to undo yet.' }; }
      Grid.remove(s.grid, last.cells);
      const clueLen = s.currentLevel.clues[last.clue].answer.length;
      s.queue.unshift({ clue: last.clue, n: clueLen, cells: last.cells.map((c) => ({ x: c.x, y: c.y })) });
      s.undos++;
      Game.setMessage('Last shape picked up — redraw it somewhere else.', 'info');
      Game.emit('undone');
      Game.emit('change');
      return { ok: true };
    },

    /* ---------- hint ---------- */
    hint() {
      const s = Game.state;
      if (s.completed) return { ok: false };
      if (Game.phase() === 'solving') {
        const len = s.currentLevel.clues.length;
        let i = s.currentClue;
        if (Game.clueStatus(i) !== 'unsolved') {
          i = -1;
          for (let k = 0; k < len; k++) if (Game.clueStatus(k) === 'unsolved') { i = k; break; }
        }
        if (i >= 0) {
          const answer = s.currentLevel.clues[i].answer;
          const shown = s.hintReveals[i] || 0;
          if (shown >= Crossword.maxReveal(answer)) {
            Game.setMessage('That clue is down to its last letter — you can do it!', 'info');
            Game.emit('change');
            return { ok: false, message: 'no more letters' };
          }
          s.hintReveals[i] = shown + 1;
          s.currentClue = i;
          s.hintsUsed++;
          Game.setMessage(`Hint used: letter ${shown + 1} revealed (−${Scoring.HINT_COST} points).`, 'info');
          Game.emit('hint', { clue: i });
          Game.emit('change');
          return { ok: true, clue: i, revealed: shown + 1, free: false };
        }
      }
      // While drawing (or if nothing to reveal) show where pixels are still needed. Free.
      Game.setMessage('Highlighting the spots that still need pixels.', 'info');
      Game.emit('flashTarget');
      Game.emit('change');
      return { ok: true, free: true };
    },

    /* ---------- completion ---------- */
    completeLevel() {
      const s = Game.state;
      Game.stopTimer();                 // 1. stop the clock first
      s.completed = true;
      const res = Scoring.compute({ seconds: s.elapsedTime, hints: s.hintsUsed, wrong: s.invalidAttempts, undos: s.undos }, s.currentLevel);
      s.score = res.score;              // 2. score
      s.stars = res.stars;              // 3. stars
      s.breakdown = res.breakdown;
      if (s.saveEnabled) {              // 4. save (guarded — a storage failure can't crash)
        Storage.recordCompletion(s.currentLevel.id, s.score, s.stars, Math.floor(s.elapsedTime), PC.LEVELS.length);
      }
      Game.emit('complete');            // 5. show the completion screen
      Game.emit('change');
    }
  };

  PC.Game = Game;
})();
