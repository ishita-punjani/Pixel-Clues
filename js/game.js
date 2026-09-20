/* game.js — central game state + rules. No DOM access: ui.js renders whatever state says. */
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
      placedBlocks: [],     // [{clue, cells(rel), dx, dy, id}]
      grid: [],
      earnedPixels: 0,
      currentShape: [],     // confirmed relative cells of the block waiting to be placed
      queue: [],            // pending rewards: [{clue, n, builder:[{x,y}], shape:null|[{x,y}]}]
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
      message: { text: '', type: 'info' },
      wrongMsg: {}          // clue -> last wrong message flag
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
      s.currentShape = [];
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
      if (!s.queue.length) return 'solving';
      return s.queue[0].shape ? 'placing' : 'building';
    },
    active() { return Game.state.queue[0] || null; },
    builderSize(n) { return Math.max(4, n); },
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
        const msg = 'Place your current block first!';
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
      s.queue.push({ clue: i, n, builder: [], shape: null });
      s.currentClue = i;
      Game.setMessage(`Correct! You earned ${n} pixels.`, 'success');
      Game.emit('correct', { clue: i, n });
      Game.emit('change');
      return { status: 'correct', n, message: `Correct! You earned ${n} pixels.` };
    },

    /* ---------- builder ---------- */
    toggleBuilderCell(x, y) {
      if (Game.phase() !== 'building') return { ok: false };
      const item = Game.active();
      const size = Game.builderSize(item.n);
      if (x < 0 || y < 0 || x >= size || y >= size) return { ok: false };
      const idx = item.builder.findIndex((c) => c.x === x && c.y === y);
      if (idx >= 0) item.builder.splice(idx, 1); else item.builder.push({ x, y });
      Game.setMessage(Game.builderStatusMessage(item), 'info');
      Game.emit('change');
      return { ok: true, count: item.builder.length };
    },

    builderStatusMessage(item) {
      const c = item.builder.length;
      if (c === item.n) {
        return Polyomino.isConnected(item.builder) ? 'Looks good — press Confirm Shape.' : 'All pixels must be connected.';
      }
      if (c > item.n) return `Use exactly ${item.n} pixels.`;
      return `Create any connected shape using all ${item.n} pixels.`;
    },

    resetBuilder() {
      if (Game.phase() !== 'building') return { ok: false };
      Game.active().builder = [];
      Game.setMessage(`Create any connected shape using all ${Game.active().n} pixels.`, 'info');
      Game.emit('change');
      return { ok: true };
    },

    confirmShape() {
      if (Game.phase() !== 'building') return { ok: false };
      const item = Game.active();
      const v = Polyomino.validate(item.builder, item.n);
      if (!v.valid) {
        Game.setMessage(v.message, 'error');
        Game.emit('shapeInvalid', v);
        Game.emit('change');
        return { ok: false, reason: v.reason, message: v.message, stray: v.stray };
      }
      item.shape = Polyomino.normalize(item.builder);
      Game.state.currentShape = item.shape;
      Game.setMessage('Shape locked in! Drag the block onto the puzzle grid.', 'success');
      Game.emit('shapeConfirmed');
      Game.emit('change');
      return { ok: true, shape: item.shape };
    },

    /** Go back from the placement tray to the builder (keeps the current orientation). */
    reshape() {
      if (Game.phase() !== 'placing') return { ok: false };
      const item = Game.active();
      item.builder = item.shape.map((c) => ({ x: c.x, y: c.y }));
      item.shape = null;
      Game.state.currentShape = [];
      Game.setMessage(`Adjust your ${item.n} pixels, then confirm again.`, 'info');
      Game.emit('change');
      return { ok: true };
    },

    rotate() {
      if (Game.phase() !== 'placing') return { ok: false };
      const item = Game.active();
      item.shape = Polyomino.rotate(item.shape);
      Game.state.currentShape = item.shape;
      Game.emit('change');
      return { ok: true };
    },

    /* ---------- placement ---------- */
    place(dropX, dropY) {
      if (Game.phase() !== 'placing') return { ok: false, reason: 'no-block', message: 'Build and confirm a shape first.' };
      const s = Game.state;
      const item = Game.active();
      const check = Grid.canPlace(s.grid, item.shape, dropX, dropY);
      if (!check.ok) {
        // Failure never modifies grid / blocks / queue.
        Game.setMessage(check.message, 'error');
        Game.emit('placeFailed', check);
        Game.emit('change');
        return check;
      }
      const id = ++s.blockCounter;
      Grid.put(s.grid, item.shape, dropX, dropY, { clue: item.clue, block: id });
      s.placedBlocks.push({ id, clue: item.clue, cells: item.shape.map((c) => ({ x: c.x, y: c.y })), dx: dropX, dy: dropY });
      s.queue.shift();
      s.currentShape = s.queue[0] && s.queue[0].shape ? s.queue[0].shape : [];

      const cmp = Grid.compare(s.grid, s.currentLevel.target);
      const offTarget = Grid.absolute(item.shape, dropX, dropY).filter((c) => !s.currentLevel.target[c.y][c.x]).length;
      const allPlaced = s.placedBlocks.length === s.currentLevel.clues.length;

      if (cmp.match && allPlaced && !s.queue.length) {
        Game.setMessage('Block placed — the picture is complete!', 'success');
        Game.emit('placed', { id, offTarget });
        Game.completeLevel();
        return { ok: true, reason: null, message: '', complete: true, offTarget };
      }
      if (allPlaced) {
        Game.setMessage('All blocks are placed but the picture doesn\'t match yet. Use Undo or Restart to rearrange.', 'warn');
      } else if (offTarget > 0) {
        Game.setMessage(`Placed — but ${offTarget} pixel${offTarget > 1 ? 's are' : ' is'} outside the picture. Undo if that wasn't intended.`, 'warn');
      } else {
        Game.setMessage(s.queue.length ? 'Placed! Now place your next block.' : 'Placed! Pick the next clue.', 'success');
      }
      Game.emit('placed', { id, offTarget });
      Game.emit('change');
      return { ok: true, reason: null, message: '', complete: false, offTarget };
    },

    /** Undo last placement: the block returns to the tray (front of the queue) with its shape. */
    undo() {
      const s = Game.state;
      if (s.completed) return { ok: false };
      const last = s.placedBlocks.pop();
      if (!last) { Game.setMessage('Nothing to undo yet.', 'info'); Game.emit('change'); return { ok: false, message: 'Nothing to undo yet.' }; }
      Grid.remove(s.grid, last.cells, last.dx, last.dy);
      const clueLen = s.currentLevel.clues[last.clue].answer.length;
      s.queue.unshift({ clue: last.clue, n: clueLen, builder: last.cells.map((c) => ({ x: c.x, y: c.y })), shape: last.cells.map((c) => ({ x: c.x, y: c.y })) });
      s.currentShape = s.queue[0].shape;
      s.undos++;
      Game.setMessage('Last block picked up — place it somewhere else.', 'info');
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
      // While building/placing (or if nothing to reveal) show where pixels are still needed. Free.
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
