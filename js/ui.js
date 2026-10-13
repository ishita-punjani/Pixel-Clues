/* ui.js — all DOM rendering and input handling. Reads state from PC.Game; never owns game rules. */
(function () {
  const PC = globalThis.PC;
  const { Game, Grid, Polyomino, Crossword, Scoring, Storage, PALETTE } = PC;

  const BLOCK_COLORS = ['#f28fb1', '#ffd23f', '#79c46e', '#4f9be0', '#ff9440', '#b48be0', '#5fd0c0', '#e2554f', '#c9a227', '#8fb3ff', '#ff7eb6'];
  const $ = (id) => document.getElementById(id);

  const ui = {
    screen: 'home',
    cells: [],            // main-grid cell elements, index y*n+x
    clueEls: [],
    refLevelId: null,      // which level's art is currently drawn on the reference canvas
    drag: null,            // {mode:'paint'|'erase', visited:Set<string>, pid}
    flash: new Set(),
    badFlash: new Set(),
    lastPhase: null,
    lastMsg: '',
    completeToken: 0,
    resetArmed: false
  };

  /* ================= screens ================= */
  function showScreen(name) {
    ui.screen = name;
    ['home', 'levels', 'game'].forEach((s) => { $('screen-' + s).hidden = s !== name; });
    window.scrollTo(0, 0);
  }

  /* ================= pixel art canvases ================= */
  function drawArt(canvas, level) {
    const n = level.gridSize;
    const k = Math.max(4, Math.floor(240 / n));
    canvas.width = canvas.height = n * k;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'rgba(0,0,0,.2)';
    ctx.lineWidth = Math.max(1, k / 10);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const a = level.art[y][x];
      if (!a) continue;
      ctx.fillStyle = PALETTE[a];
      ctx.fillRect(x * k, y * k, k, k);
      ctx.strokeRect(x * k + .5, y * k + .5, k - 1, k - 1);
    }
  }

  /* ================= level select ================= */
  function renderLevels() {
    const box = $('levels-grid');
    box.innerHTML = '';
    const d = Storage.data;
    $('presenter-toggle').checked = !!d.presenter;
    $('storage-note').hidden = Storage.persistent;
    PC.LEVELS.forEach((lv) => {
      const unlocked = Storage.isUnlocked(lv.id);
      const canOpen = unlocked || d.presenter;
      const card = document.createElement('article');
      card.className = 'level-card' + (unlocked ? '' : ' locked');
      card.dataset.level = lv.id;
      card.dataset.locked = unlocked ? 'false' : 'true';

      const canvas = document.createElement('canvas');
      canvas.setAttribute('aria-hidden', 'true');
      drawArt(canvas, lv);
      card.appendChild(canvas);

      const h = document.createElement('h3');
      h.innerHTML = `<span>${lv.name}</span><span class="chip">${lv.gridSize}×${lv.gridSize}</span>`;
      card.appendChild(h);

      const meta = document.createElement('div');
      meta.className = 'meta';
      const status = d.completed[lv.id] ? '<span class="chip green">Completed</span>' : (unlocked ? '<span class="chip pink">Unlocked</span>' : '<span class="chip">Locked</span>');
      meta.innerHTML = `<span class="chip">${lv.clues.length} clues</span>${status}`;
      card.appendChild(meta);

      const blurb = document.createElement('p');
      blurb.className = 'muted small';
      blurb.textContent = `${lv.title} — ${lv.blurb}`;
      card.appendChild(blurb);

      const stars = document.createElement('div');
      stars.className = 'stars-row';
      stars.setAttribute('aria-label', (d.stars[lv.id] || 0) + ' of 3 stars');
      stars.innerHTML = [1, 2, 3].map((i) => `<span class="${i <= (d.stars[lv.id] || 0) ? 'on' : ''}">★</span>`).join('');
      card.appendChild(stars);

      if (!unlocked) {
        const badge = document.createElement('span');
        badge.className = 'lock-badge';
        badge.textContent = '🔒 Locked';
        card.appendChild(badge);
      }

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn ' + (canOpen ? 'btn-primary' : '');
      btn.dataset.play = lv.id;
      btn.disabled = !canOpen;
      btn.textContent = !canOpen ? 'Locked' : (unlocked ? (d.completed[lv.id] ? 'Play again' : 'Play') : 'Open (presenter)');
      btn.addEventListener('click', () => openLevel(lv.id));
      card.appendChild(btn);
      box.appendChild(card);
    });
  }

  function openLevel(id) {
    if (!(Storage.isUnlocked(id) || Storage.data.presenter)) return;
    Game.startLevel(id);
  }

  /* ================= game screen build ================= */
  function buildGame() {
    const s = Game.state, lv = s.currentLevel, n = lv.gridSize;
    $('game-title').textContent = `${lv.name} — ${lv.title}`;
    $('game-size').textContent = `${n}×${n}`;
    ui.drag = null; ui.flash.clear(); ui.badFlash.clear();
    ui.lastPhase = null; ui.lastMsg = '';
    ui.completeToken++;
    $('overlay-complete').hidden = true;

    // main grid — playable cells only; the target/reference art is never rendered here.
    const grid = $('main-grid');
    grid.innerHTML = '';
    grid.style.setProperty('--n', n);
    grid.setAttribute('aria-rowcount', n);
    ui.cells = [];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const c = document.createElement('div');
      c.className = 'cell';
      c.dataset.x = x; c.dataset.y = y;
      grid.appendChild(c);
      ui.cells.push(c);
    }

    // reference image (right column) — visual guidance only, drawn once per level.
    if (ui.refLevelId !== lv.id) { drawArt($('reference-canvas'), lv); ui.refLevelId = lv.id; }

    // clues
    const list = $('clue-list');
    list.innerHTML = '';
    ui.clueEls = [];
    lv.clues.forEach((cl, i) => {
      const li = document.createElement('li');
      li.className = 'clue-card';
      li.dataset.clue = i;
      li.innerHTML = `
        <div class="clue-head">
          <span class="clue-num">${i + 1}</span>
          <p class="clue-text"></p>
          <span class="clue-state">Unsolved</span>
        </div>
        <form class="clue-form" autocomplete="off">
          <input type="text" aria-label="Answer for clue ${i + 1}" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="24" data-answer-input="${i}">
          <button class="btn btn-primary" type="submit">Check</button>
        </form>
        <p class="hint-line muted small" aria-hidden="true" hidden></p>`;
      li.querySelector('.clue-text').append(document.createTextNode(cl.clue + ' '), Object.assign(document.createElement('span'), { className: 'muted clue-suffix', textContent: `(${cl.answer.length})` }));
      const input = li.querySelector('input');
      input.addEventListener('focus', () => { if (Game.state.currentClue !== i) Game.setActiveClue(i); });
      // Collapsed unsolved clue: click (or Enter/Space) on its header opens its answer row.
      const head = li.querySelector('.clue-head');
      const openClue = () => { if (Game.clueStatus(i) !== 'unsolved') return; Game.setActiveClue(i); input.focus(); };
      head.addEventListener('click', openClue);
      head.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openClue(); } });
      li.querySelector('form').addEventListener('submit', (e) => {
        e.preventDefault();
        const r = Game.submitAnswer(i, input.value);
        if (r.status === 'correct') { li.classList.add('pop-correct'); setTimeout(() => li.classList.remove('pop-correct'), 600); }
        if (r.status === 'incorrect') input.select();
      });
      list.appendChild(li);
      ui.clueEls.push(li);
    });
  }

  /* ================= rendering ================= */
  function renderAll() {
    if (!Game.state.currentLevel) return;
    renderStatus(); renderCoach(); renderProgress(); renderClues(); renderMainGrid(); renderDrawTools(); renderButtons();
    const phase = Game.phase();
    if (phase !== ui.lastPhase) {
      if (phase === 'drawing' && window.innerWidth <= 768 && ui.screen === 'game') {
        $('main-grid').scrollIntoView({ block: 'center', behavior: 'auto' });
      }
      ui.lastPhase = phase;
    }
  }

  function renderStatus() {
    const m = Game.state.message;
    const el = $('status');
    el.className = 'status ' + m.type;
    el.textContent = m.text || ' ';
    if (m.text !== ui.lastMsg) { ui.lastMsg = m.text; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
  }

  function coachInfo() {
    const s = Game.state, lv = s.currentLevel, phase = Game.phase(), item = Game.active();
    if (lv.guidance === 'minimal' || phase === 'complete') return null;
    if (lv.guidance === 'light') {
      const t = phase === 'solving' ? 'Pick a clue and type your answer.' : `Draw ${item.n} connected pixels on the grid — click, or click and drag.`;
      return { step: null, text: t };
    }
    if (phase === 'solving') {
      return s.placedBlocks.length === 0 && s.solvedClues.length === 0
        ? { step: 1, text: 'Solve the clue to earn pixels.' }
        : { step: 6, text: 'Keep going — solve the next clue and build the final image.' };
    }
    // drawing
    const c = item.cells.length;
    if (c === 0) return { step: 2, text: `Your answer has ${item.n} letters — you earned ${item.n} pixels! Look at the reference, then click (or click-and-drag) on the grid to draw a connected shape.` };
    if (c === item.n && Polyomino.isConnected(item.cells)) return { step: 4, text: 'Nice shape! Press Confirm Shape to lock it in.' };
    return { step: 3, text: `Pixels must touch along an edge (corners don't count). Use all ${item.n}.` };
  }

  function renderCoach() {
    const info = coachInfo();
    $('coach').hidden = !info;
    if (!info) return;
    $('coach-step').textContent = info.step ? `Step ${info.step} of 6` : 'Tip';
    $('coach-text').textContent = info.text;
  }

  function renderProgress() {
    const p = Game.progress();
    $('progress-text').textContent = `${p.done} / ${p.total} clues`;
    $('progress-fill').style.width = p.pct + '%';
    $('progress-bar').setAttribute('aria-valuenow', p.pct);
    const h = Game.state.hintsUsed;
    $('hint-count').textContent = h ? `· ${h} hint${h > 1 ? 's' : ''} used` : '';
  }

  function renderClues() {
    const s = Game.state, lv = s.currentLevel, phase = Game.phase();
    // Only one unsolved clue shows its answer row at a time (the current one, else the first
    // unsolved) so every clue of the biggest level fits in the column without scrolling.
    const open = Game.clueStatus(s.currentClue) === 'unsolved' ? s.currentClue : lv.clues.findIndex((_, k) => Game.clueStatus(k) === 'unsolved');
    lv.clues.forEach((cl, i) => {
      const li = ui.clueEls[i];
      const st = Game.clueStatus(i);
      const collapsed = st === 'unsolved' && i !== open;
      li.classList.toggle('active', i === open);
      li.classList.toggle('collapsed', collapsed);
      li.querySelector('.clue-head').tabIndex = collapsed ? 0 : -1;
      li.classList.toggle('correct', st === 'correct');
      li.classList.toggle('completed', st === 'completed');
      li.dataset.status = st;
      if (st !== 'unsolved') li.classList.remove('wrong');
      li.querySelector('.clue-state').textContent = li.classList.contains('wrong') ? 'Incorrect' : (st === 'unsolved' ? 'Unsolved' : (st === 'correct' ? 'Correct' : 'Completed'));

      // Once solved, the card collapses to just its header row — the answer replaces the
      // "(N)" letter-count suffix and the input/check form disappears, so solved clues (the
      // common case after a few minutes of play) take minimal vertical space.
      const form = li.querySelector('.clue-form'), suffix = li.querySelector('.clue-suffix'), hintLine = li.querySelector('.hint-line');
      form.hidden = st !== 'unsolved' || collapsed;
      suffix.textContent = st !== 'unsolved' ? `→ ${cl.answer}` : `(${cl.answer.length})`;

      const revealed = s.hintReveals[i] || 0;
      if (st === 'unsolved' && revealed > 0) {
        hintLine.hidden = false;
        hintLine.textContent = 'Hint: ' + Crossword.pattern(cl.answer, revealed).join(' ');
      } else {
        hintLine.hidden = true;
      }

      const input = li.querySelector('input'), btn = li.querySelector('button');
      const locked = st !== 'unsolved' || phase !== 'solving';
      input.disabled = locked; btn.disabled = locked;
      input.title = st === 'unsolved' && phase !== 'solving' ? 'Finish your current shape first' : '';
    });
  }

  function renderMainGrid() {
    const s = Game.state, lv = s.currentLevel, n = lv.gridSize;
    const item = Game.active();
    const own = new Set(item ? item.cells.map((c) => c.x + ',' + c.y) : []);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const idx = y * n + x, cell = ui.cells[idx];
      const g = s.grid[y][x];
      const isOwn = own.has(x + ',' + y);
      let cls = 'cell';
      if (isOwn) {
        cls += ' selected';
        cell.style.setProperty('--fill', BLOCK_COLORS[item.clue % BLOCK_COLORS.length]);
      } else if (g) {
        cls += g.pre ? ' pre' : ' filled';
        if (!g.pre) {
          if (!lv.target[y][x]) cls += ' off';
          cell.style.setProperty('--fill', BLOCK_COLORS[g.clue % BLOCK_COLORS.length]);
        } else {
          cell.style.setProperty('--fill', PALETTE[lv.art[y][x]] || '');
        }
      }
      // Art colours are applied only once the level is complete (grid === target by then).
      // Same lv.art + PALETTE data drawArt() uses for the reference; --d staggers a short
      // diagonal reveal (max ~200ms delay) that finishes before the completion overlay.
      if (s.completed && (g || isOwn)) {
        cls += ' art';
        cell.style.setProperty('--art', PALETTE[lv.art[y][x]] || '');
        cell.style.setProperty('--d', Math.round(((x + y) / Math.max(1, 2 * n - 2)) * 200) + 'ms');
      }
      if (ui.flash.has(idx)) cls += ' flash';
      if (ui.badFlash.has(idx)) cls += ' bad-flash';
      cell.dataset.state = isOwn ? 'selected' : (g ? (g.pre ? 'pre' : 'block') : 'empty');
      if (cell.className !== cls) cell.className = cls;
    }
    $('main-grid').classList.toggle('drawing', Game.phase() === 'drawing');
  }

  function renderDrawTools() {
    const phase = Game.phase(), item = Game.active();
    const drawing = phase === 'drawing';
    $('btn-clear').hidden = !drawing;
    $('btn-confirm').hidden = !drawing;
    $('draw-status').hidden = !drawing;
    if (drawing) {
      const c = item.cells.length;
      const word = Game.state.currentLevel.clues[item.clue].answer;
      $('draw-status').textContent = `${word} — ${c} / ${item.n} pixels`;
      $('btn-confirm').disabled = c === 0;
      const q = Game.state.queue.length - 1;
      $('btn-confirm').title = q > 0 ? `Confirm, then ${q} more shape${q > 1 ? 's' : ''} to draw` : 'Confirm this shape';
    }
  }

  function renderButtons() {
    const s = Game.state;
    $('btn-undo').disabled = s.completed || s.placedBlocks.length === 0;
    $('btn-hint').disabled = s.completed;
  }

  function updateTimer() {
    $('timer').textContent = Scoring.formatTime(Game.state.elapsedTime);
  }

  /* ================= draw directly on the main grid: click, or click-and-drag paint/erase ================= */
  function gridRect() { return $('main-grid').getBoundingClientRect(); }

  function cellAt(clientX, clientY) {
    const s = Game.state, n = s.currentLevel.gridSize;
    const pt = Grid.cellFromPoint(gridRect(), n, clientX, clientY);
    return pt.inside ? { x: pt.x, y: pt.y } : null;
  }

  /** Apply the current drag's paint/erase mode to one cell, skipping cells already
   *  visited during this gesture so re-entering a cell doesn't repeatedly toggle it. */
  function applyDragCell(x, y) {
    const visitedDuringDrag = ui.drag.visited;
    const key = x + ',' + y;
    if (visitedDuringDrag.has(key)) return;
    visitedDuringDrag.add(key);
    if (ui.drag.mode === 'paint') Game.paintCell(x, y); else Game.eraseCell(x, y);
  }

  function initGridDrawing() {
    const grid = $('main-grid');
    grid.addEventListener('pointerdown', (e) => {
      if (Game.phase() !== 'drawing' || e.button > 0 || !e.isPrimary) return;
      const cell = cellAt(e.clientX, e.clientY);
      if (!cell) return;
      const info = Game.cellInfo(cell.x, cell.y);
      if (info.kind === 'occupied') { Game.paintCell(cell.x, cell.y); return; } // feedback only, no drag
      ui.drag = { mode: info.kind === 'own' ? 'erase' : 'paint', visited: new Set(), pid: e.pointerId };
      try { grid.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      applyDragCell(cell.x, cell.y);
      e.preventDefault();
    });
    grid.addEventListener('pointermove', (e) => {
      if (!ui.drag || ui.drag.pid !== e.pointerId) return;
      const cell = cellAt(e.clientX, e.clientY);
      if (cell) applyDragCell(cell.x, cell.y);
    });
    const endDrag = (e) => {
      if (!ui.drag || ui.drag.pid !== e.pointerId) return;
      try { grid.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      ui.drag = null; // reset the visited set for the next gesture
    };
    grid.addEventListener('pointerup', endDrag);
    grid.addEventListener('pointercancel', endDrag);
    grid.addEventListener('lostpointercapture', endDrag);
  }

  /* ================= completion ================= */
  function confetti(box) {
    const colors = ['#f28fb1', '#ffd23f', '#79c46e', '#4f9be0', '#1f5c45'];
    for (let i = 0; i < 36; i++) {
      const c = document.createElement('span');
      c.className = 'confetti';
      c.style.left = Math.random() * 100 + '%';
      c.style.background = colors[i % colors.length];
      c.style.animationDelay = Math.random() * 0.4 + 's';
      box.appendChild(c);
      setTimeout(() => c.remove(), 2200);
    }
  }

  function showComplete() {
    const s = Game.state, lv = s.currentLevel;
    const token = ++ui.completeToken;
    setTimeout(() => {
      if (token !== ui.completeToken || !Game.state.completed) return; // restarted / exited meanwhile
      $('complete-title').textContent = `${lv.title.toUpperCase()} COMPLETE!`;
      $('complete-sub').textContent = `${lv.name} · ${lv.gridSize}×${lv.gridSize}`;
      $('complete-stars').innerHTML = [1, 2, 3].map((i) => `<span class="${i <= s.stars ? 'on' : ''}">★</span>`).join('');
      $('complete-stars').setAttribute('aria-label', `${s.stars} of 3 stars`);
      drawArt($('complete-canvas'), lv);
      $('stat-clues').textContent = `All ${lv.clues.length} clues solved`;
      $('stat-time').textContent = Scoring.formatTime(s.elapsedTime);
      $('stat-score').textContent = s.score;
      const b = s.breakdown;
      $('stat-breakdown').textContent = `Score = ${b.base} − hints ${b.hints} − wrong answers ${b.wrong} − undos ${b.undos} − overtime ${b.overtime} (par ${Scoring.formatTime(b.parTime)}). ★★★ ≥ ${Scoring.THREE_STAR}, ★★ ≥ ${Scoring.TWO_STAR}.${s.saveEnabled ? '' : ' (Presenter mode — not saved.)'}`;
      const next = PC.LEVELS.find((l) => l.id === lv.id + 1);
      const nextBtn = $('btn-next');
      const canNext = next && (Storage.isUnlocked(next.id) || Storage.data.presenter);
      nextBtn.hidden = !canNext;
      if (canNext) nextBtn.textContent = `Next: ${next.name}`;
      $('overlay-complete').hidden = false;
      (canNext ? nextBtn : $('btn-replay')).focus();
      confetti($('overlay-complete').querySelector('.modal'));
    }, 650);
  }

  /* ================= wiring ================= */
  function init() {
    Storage.load();

    drawArt($('home-canvas'), PC.LEVELS[2]);
    $('btn-play').addEventListener('click', () => { renderLevels(); showScreen('levels'); });
    $('btn-help').addEventListener('click', openHelp);
    $('btn-help-close').addEventListener('click', closeHelp);
    $('btn-levels-home').addEventListener('click', () => showScreen('home'));
    $('presenter-toggle').addEventListener('change', (e) => { Storage.setPresenter(e.target.checked); renderLevels(); });
    $('btn-reset-progress').addEventListener('click', (e) => {
      if (!ui.resetArmed) { ui.resetArmed = true; e.target.textContent = 'Click again to confirm'; setTimeout(() => { ui.resetArmed = false; e.target.textContent = 'Reset progress'; }, 3000); return; }
      ui.resetArmed = false; e.target.textContent = 'Reset progress';
      Storage.reset(); renderLevels();
    });

    $('btn-exit').addEventListener('click', () => Game.exit());
    $('btn-restart').addEventListener('click', () => Game.restart());
    $('btn-undo').addEventListener('click', () => Game.undo());
    $('btn-hint').addEventListener('click', () => Game.hint());
    $('btn-clear').addEventListener('click', () => Game.clearDrawing());
    $('btn-confirm').addEventListener('click', () => Game.confirmShape());

    $('btn-replay').addEventListener('click', () => { $('overlay-complete').hidden = true; Game.restart(); });
    $('btn-complete-levels').addEventListener('click', () => { $('overlay-complete').hidden = true; Game.exit(); });
    $('btn-next').addEventListener('click', () => {
      const next = Game.state.currentLevel.id + 1;
      $('overlay-complete').hidden = true;
      openLevel(next);
    });

    initGridDrawing();

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('overlay-help').hidden) closeHelp();
    });

    Game.on((type, data) => {
      switch (type) {
        case 'levelStarted': buildGame(); showScreen('game'); updateTimer(); break;
        case 'change': renderAll(); break;
        case 'tick': updateTimer(); break;
        case 'exit': renderLevels(); showScreen('levels'); break;
        case 'wrong': {
          const li = ui.clueEls[data.clue];
          li.classList.add('wrong');
          li.querySelector('.clue-state').textContent = 'Incorrect';
          setTimeout(() => { li.classList.remove('wrong'); renderClues(); }, 900);
          break;
        }
        case 'shapeInvalid': {
          const n = Game.state.currentLevel.gridSize;
          ui.badFlash.clear();
          (data.stray || []).forEach((c) => ui.badFlash.add(c.y * n + c.x));
          const f = $('grid-frame');
          f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake');
          renderMainGrid();
          setTimeout(() => { f.classList.remove('shake'); ui.badFlash.clear(); if (Game.state.currentLevel) renderMainGrid(); }, 600);
          break;
        }
        case 'cellBlocked':
        case 'budgetExceeded': {
          const n = Game.state.currentLevel.gridSize;
          const idx = data.y * n + data.x;
          ui.badFlash.add(idx);
          renderMainGrid();
          setTimeout(() => { ui.badFlash.delete(idx); if (Game.state.currentLevel) renderMainGrid(); }, 500);
          break;
        }
        case 'flashTarget': {
          const s = Game.state, n = s.currentLevel.gridSize;
          ui.flash.clear();
          for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (s.currentLevel.target[y][x] && !s.grid[y][x]) ui.flash.add(y * n + x);
          renderMainGrid();
          setTimeout(() => { ui.flash.clear(); if (Game.state.currentLevel) renderMainGrid(); }, 1600);
          break;
        }
        case 'complete': showComplete(); break;
        default: break;
      }
    });

    showScreen('home');
  }

  function openHelp() { $('overlay-help').hidden = false; $('btn-help-close').focus(); }
  function closeHelp() { $('overlay-help').hidden = true; }

  PC.UI = { init, showScreen, renderLevels, BLOCK_COLORS };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
