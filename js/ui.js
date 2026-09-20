/* ui.js — all DOM rendering and input handling. Reads state from PC.Game; never owns game rules. */
(function () {
  const PC = globalThis.PC;
  const { Game, Grid, Polyomino, Crossword, Scoring, Storage, PALETTE } = PC;

  const BLOCK_COLORS = ['#f28fb1', '#ffd23f', '#79c46e', '#4f9be0', '#ff9440', '#b48be0', '#5fd0c0', '#e2554f', '#c9a227', '#8fb3ff', '#ff7eb6'];
  const $ = (id) => document.getElementById(id);

  const ui = {
    screen: 'home',
    cells: [],            // main-grid cell elements, index y*n+x
    gridN: 0,
    clueEls: [],
    builderItem: null,
    trayShape: null,
    armed: false,
    drag: null,
    preview: new Map(),   // idx -> 'ok' | 'bad'
    popBlock: null,
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
  function drawArt(canvas, level, opts) {
    const n = level.gridSize;
    const k = Math.max(4, Math.floor(240 / n));
    canvas.width = canvas.height = n * k;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const a = level.art[y][x];
      if (!a) continue;
      ctx.fillStyle = PALETTE[a];
      ctx.fillRect(x * k, y * k, k, k);
      ctx.strokeStyle = 'rgba(0,0,0,.2)';
      ctx.lineWidth = Math.max(1, k / 10);
      ctx.strokeRect(x * k + .5, y * k + .5, k - 1, k - 1);
    }
    canvas.dataset.drawn = level.id;
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
    ui.armed = false; ui.drag = null; ui.builderItem = null; ui.trayShape = null;
    ui.preview.clear(); ui.flash.clear(); ui.badFlash.clear(); ui.popBlock = null;
    ui.lastPhase = null; ui.lastMsg = '';
    ui.completeToken++;
    $('overlay-complete').hidden = true;
    removeGhost();

    // main grid
    const grid = $('main-grid');
    grid.innerHTML = '';
    grid.style.setProperty('--n', n);
    grid.setAttribute('aria-rowcount', n);
    ui.cells = []; ui.gridN = n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const c = document.createElement('div');
      c.className = 'cell';
      c.dataset.x = x; c.dataset.y = y;
      const a = lv.art[y][x];
      if (a) c.style.setProperty('--art', PALETTE[a]);
      grid.appendChild(c);
      ui.cells.push(c);
    }

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
          <span class="clue-state">Unsolved</span>
        </div>
        <p class="clue-text"></p>
        <div class="slots" aria-hidden="true"></div>
        <form class="clue-form" autocomplete="off">
          <input type="text" aria-label="Answer for clue ${i + 1}" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="24" data-answer-input="${i}">
          <button class="btn btn-primary" type="submit">Check</button>
        </form>`;
      li.querySelector('.clue-text').append(document.createTextNode(cl.clue + ' '), Object.assign(document.createElement('span'), { className: 'muted', textContent: `(${cl.answer.length})` }));
      const input = li.querySelector('input');
      input.addEventListener('focus', () => { if (Game.state.currentClue !== i) Game.setActiveClue(i); });
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
    renderStatus(); renderCoach(); renderProgress(); renderClues(); renderMainGrid(); renderWorkspace(); renderButtons();
    const phase = Game.phase();
    if (phase !== ui.lastPhase) {
      if ((phase === 'building' || phase === 'placing') && window.innerWidth <= 768 && ui.screen === 'game') {
        $('work-panel').scrollIntoView({ block: 'nearest', behavior: 'auto' });
      }
      ui.lastPhase = phase;
    }
  }

  function renderStatus() {
    const m = Game.state.message;
    const el = $('status');
    el.className = 'status ' + m.type;
    el.textContent = m.text || ' ';
    if (m.text !== ui.lastMsg) { ui.lastMsg = m.text; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
  }

  function coachInfo() {
    const s = Game.state, lv = s.currentLevel, phase = Game.phase(), item = Game.active();
    if (lv.guidance === 'minimal' || phase === 'complete') return null;
    if (lv.guidance === 'light') {
      const t = { solving: 'Pick a clue and type your answer.', building: `Shape your ${item && item.n} pixels — any connected shape works.`, placing: 'Drag the block onto the grid where it fits the picture.' }[phase];
      return { step: null, text: t };
    }
    if (phase === 'solving') {
      return s.placedBlocks.length === 0 && s.solvedClues.length === 0
        ? { step: 1, text: 'Solve the clue to earn pixels.' }
        : { step: 6, text: 'Keep going — solve the next clue and build the final image.' };
    }
    if (phase === 'building') {
      const c = item.builder.length;
      if (c === 0) return { step: 2, text: `Your answer has ${item.n} letters — you earned ${item.n} pixels! Create any connected shape using all ${item.n} pixels.` };
      if (c === item.n && Polyomino.isConnected(item.builder)) return { step: 4, text: 'Nice shape! Press Confirm Shape to lock it in.' };
      return { step: 3, text: `Pixels must touch along an edge (corners don't count). Use all ${item.n}.` };
    }
    return { step: 5, text: 'Place your block on the puzzle grid.' };
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
    lv.clues.forEach((cl, i) => {
      const li = ui.clueEls[i];
      const st = Game.clueStatus(i);
      li.classList.toggle('active', s.currentClue === i && st === 'unsolved');
      li.classList.toggle('correct', st === 'correct');
      li.classList.toggle('completed', st === 'completed');
      li.dataset.status = st;
      if (st !== 'unsolved') li.classList.remove('wrong');
      li.querySelector('.clue-state').textContent = li.classList.contains('wrong') ? 'Incorrect' : (st === 'unsolved' ? 'Unsolved' : (st === 'correct' ? 'Correct' : 'Completed'));
      const revealed = st === 'unsolved' ? (s.hintReveals[i] || 0) : cl.answer.length;
      const slots = li.querySelector('.slots');
      const pat = Crossword.pattern(cl.answer, revealed);
      slots.innerHTML = '';
      pat.forEach((ch) => { const sp = document.createElement('span'); sp.textContent = ch === '_' ? '' : ch; slots.appendChild(sp); });
      const input = li.querySelector('input'), btn = li.querySelector('button');
      if (st !== 'unsolved') input.value = cl.answer;
      const locked = st !== 'unsolved' || phase !== 'solving';
      input.disabled = locked; btn.disabled = locked;
      input.title = st === 'unsolved' && phase !== 'solving' ? 'Place your current block first' : '';
    });
  }

  function renderMainGrid() {
    const s = Game.state, lv = s.currentLevel, n = lv.gridSize;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const idx = y * n + x, cell = ui.cells[idx];
      const g = s.grid[y][x];
      let cls = 'cell';
      if (g) {
        cls += g.pre ? ' pre' : ' filled';
        if (!g.pre && !lv.target[y][x]) cls += ' off';
        if (!g.pre) cell.style.setProperty('--fill', BLOCK_COLORS[g.clue % BLOCK_COLORS.length]);
      } else if (lv.target[y][x]) cls += ' target';
      if (s.completed && g) cls += ' art';
      const pv = ui.preview.get(idx);
      if (pv) cls += ' preview-' + pv;
      if (ui.flash.has(idx)) cls += ' flash';
      if (ui.badFlash.has(idx)) cls += ' bad-flash';
      if (ui.popBlock !== null && g && g.block === ui.popBlock) cls += ' pop';
      cell.dataset.state = g ? (g.pre ? 'pre' : 'block') : 'empty';
      if (cell.className !== cls) cell.className = cls;
    }
    if (ui.popBlock !== null) { const b = ui.popBlock; ui.popBlock = null; setTimeout(() => { ui.cells.forEach((c) => c.classList.remove('pop')); }, 400); void b; }
    $('main-grid').classList.toggle('armed', ui.armed);
  }

  function renderWorkspace() {
    const phase = Game.phase(), item = Game.active();
    $('panel-idle').hidden = phase === 'building' || phase === 'placing';
    $('panel-builder').hidden = phase !== 'building';
    $('panel-tray').hidden = phase !== 'placing';
    if (phase !== 'placing') ui.armed = false;
    if (phase === 'building') renderBuilder(item);
    if (phase === 'placing') renderTray(item);
    if (phase === 'solving' || phase === 'complete') {
      const s = Game.state;
      $('panel-idle').innerHTML = s.placedBlocks.length === s.currentLevel.clues.length && phase !== 'complete'
        ? '<p><strong>All blocks placed.</strong></p><p class="muted">The picture doesn\'t match yet — try Undo or Restart.</p>'
        : '<p><strong>No pixels yet.</strong></p><p class="muted">Solve a clue to earn pixels, then shape them here.</p>';
    }
  }

  function renderBuilder(item) {
    const size = Game.builderSize(item.n);
    const grid = $('builder-grid');
    if (ui.builderItem !== item) {
      ui.builderItem = item;
      grid.innerHTML = '';
      grid.style.setProperty('--b', size);
      grid.classList.toggle('dense', size >= 8);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'bcell'; b.dataset.x = x; b.dataset.y = y;
        b.setAttribute('aria-label', `Row ${y + 1}, column ${x + 1}`);
        b.setAttribute('aria-pressed', 'false');
        b.addEventListener('click', () => Game.toggleBuilderCell(x, y));
        grid.appendChild(b);
      }
      $('need-count').textContent = item.n;
    }
    const sel = new Set(item.builder.map((c) => c.x + ',' + c.y));
    const c = item.builder.length;
    const connected = c > 0 && Polyomino.isConnected(item.builder);
    const stray = c === item.n && !connected ? new Set(Polyomino.stray(item.builder).map((q) => q.x + ',' + q.y)) : new Set();
    [...grid.children].forEach((b) => {
      const k = b.dataset.x + ',' + b.dataset.y;
      const on = sel.has(k);
      b.classList.toggle('on', on && !stray.has(k));
      b.classList.toggle('stray', stray.has(k));
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    const cnt = $('sel-count');
    cnt.textContent = `${c} / ${item.n}`;
    cnt.classList.toggle('over', c > item.n);
    cnt.classList.toggle('ok', c === item.n && connected);
    const msg = $('builder-msg');
    let text = '', err = false;
    if (c === item.n && !connected) { text = '⚠ All pixels must be connected.'; err = true; }
    else if (c > item.n) { text = `⚠ Use exactly ${item.n} pixels.`; err = true; }
    else if (c === item.n) text = '✓ Connected — ready to confirm.';
    else text = c === 0 ? 'Click cells to toggle them.' : `${item.n - c} more to go.`;
    msg.textContent = text; msg.classList.toggle('error', err);
    $('btn-confirm').disabled = c === 0;
  }

  function renderTray(item) {
    const block = $('tray-block');
    if (ui.trayShape !== item.shape) {
      ui.trayShape = item.shape;
      const { w, h } = Polyomino.bounds(item.shape);
      const have = new Set(item.shape.map((c) => c.x + ',' + c.y));
      block.innerHTML = '';
      block.style.setProperty('--w', w);
      block.style.setProperty('--fill', BLOCK_COLORS[item.clue % BLOCK_COLORS.length]);
      const avail = Math.max(60, ($('panel-tray').clientWidth || 240) - 48);
      block.style.setProperty('--tc', Math.max(14, Math.min(34, Math.floor(avail / w))) + 'px');
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const d = document.createElement('div');
        d.className = 'tblock' + (have.has(x + ',' + y) ? '' : ' gap');
        d.dataset.x = x; d.dataset.y = y;
        block.appendChild(d);
      }
    }
    block.classList.toggle('armed', ui.armed);
    $('tray-for').textContent = `— clue ${item.clue + 1} · ${item.n} pixels`;
    const q = Game.state.queue.length - 1;
    $('queue-note').hidden = q <= 0;
    $('queue-note').textContent = q > 0 ? `${q} more block${q > 1 ? 's' : ''} waiting after this one.` : '';
  }

  function renderButtons() {
    const s = Game.state;
    $('btn-undo').disabled = s.completed || s.placedBlocks.length === 0;
    $('btn-hint').disabled = s.completed;
  }

  function updateTimer() {
    $('timer').textContent = Scoring.formatTime(Game.state.elapsedTime);
  }

  /* ================= drag / click placement ================= */
  function gridRect() { return $('main-grid').getBoundingClientRect(); }

  function dropFromPointer(clientX, clientY, gx, gy) {
    const s = Game.state, n = s.currentLevel.gridSize;
    const pt = Grid.cellFromPoint(gridRect(), n, clientX, clientY);
    if (!pt.inside) return null;
    return { dropX: pt.x - gx, dropY: pt.y - gy };
  }

  function setPreview(drop) {
    ui.preview.clear();
    const item = Game.active();
    if (drop && item && item.shape) {
      const n = Game.state.currentLevel.gridSize;
      const check = Grid.canPlace(Game.state.grid, item.shape, drop.dropX, drop.dropY);
      Grid.absolute(item.shape, drop.dropX, drop.dropY).forEach((c) => {
        if (c.x >= 0 && c.y >= 0 && c.x < n && c.y < n) ui.preview.set(c.y * n + c.x, check.ok ? 'ok' : 'bad');
      });
    }
    renderMainGrid();
  }

  function makeGhost(shape) {
    const rect = gridRect(), n = Game.state.currentLevel.gridSize;
    const cw = rect.width / n, ch = rect.height / n;
    const { w, h } = Polyomino.bounds(shape);
    const have = new Set(shape.map((c) => c.x + ',' + c.y));
    const g = document.createElement('div');
    g.className = 'drag-ghost';
    g.style.gridTemplateColumns = `repeat(${w}, ${cw}px)`;
    g.style.gridAutoRows = ch + 'px';
    g.style.setProperty('--fill', BLOCK_COLORS[Game.active().clue % BLOCK_COLORS.length]);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const d = document.createElement('div');
      d.className = 'tblock' + (have.has(x + ',' + y) ? '' : ' gap');
      g.appendChild(d);
    }
    g.dataset.cw = cw; g.dataset.ch = ch;
    document.body.appendChild(g);
    return g;
  }
  function removeGhost() { document.querySelectorAll('.drag-ghost').forEach((g) => g.remove()); }

  function endDrag() {
    if (ui.drag && ui.drag.ghost) ui.drag.ghost.remove();
    $('tray-block').classList.remove('dragging');
    ui.drag = null;
    ui.preview.clear();
    if (Game.state.currentLevel) renderMainGrid();
  }

  function attemptPlace(drop) {
    const r = Game.place(drop.dropX, drop.dropY);
    if (r.ok) ui.armed = false;
    return r;
  }

  function initTray() {
    const block = $('tray-block');
    block.addEventListener('pointerdown', (e) => {
      if (Game.phase() !== 'placing' || e.button > 0) return;
      const item = Game.active();
      const r = block.getBoundingClientRect();
      const { w, h } = Polyomino.bounds(item.shape);
      const gx = Math.min(w - 1, Math.max(0, Math.floor((e.clientX - r.left) / (r.width / w))));
      const gy = Math.min(h - 1, Math.max(0, Math.floor((e.clientY - r.top) / (r.height / h))));
      ui.drag = { pid: e.pointerId, gx, gy, sx: e.clientX, sy: e.clientY, moved: false, ghost: null };
      try { block.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      e.preventDefault();
    });
    block.addEventListener('pointermove', (e) => {
      const d = ui.drag;
      if (!d || d.pid !== e.pointerId) return;
      if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 6) {
        d.moved = true;
        ui.armed = false; block.classList.remove('armed');
        d.ghost = makeGhost(Game.active().shape);
        block.classList.add('dragging');
      }
      if (!d.moved) return;
      const cw = parseFloat(d.ghost.dataset.cw), ch = parseFloat(d.ghost.dataset.ch);
      d.ghost.style.left = (e.clientX - (d.gx + 0.5) * cw) + 'px';
      d.ghost.style.top = (e.clientY - (d.gy + 0.5) * ch) + 'px';
      setPreview(dropFromPointer(e.clientX, e.clientY, d.gx, d.gy));
    });
    const finish = (e) => {
      const d = ui.drag;
      if (!d || d.pid !== e.pointerId) return;
      try { block.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      const moved = d.moved, gx = d.gx, gy = d.gy;
      endDrag();
      if (!moved) { toggleArmed(); return; }
      const drop = e.type === 'pointerup' ? dropFromPointer(e.clientX, e.clientY, gx, gy) : null;
      if (drop) attemptPlace(drop);
      else if (e.type === 'pointerup') { Game.setMessage('Drop the block onto the puzzle grid.', 'info'); Game.emit('change'); }
    };
    block.addEventListener('pointerup', finish);
    block.addEventListener('pointercancel', finish);
    block.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleArmed(); } });

    // tap-to-place: block armed, then tap a grid cell
    const grid = $('main-grid');
    grid.addEventListener('pointermove', (e) => {
      if (!ui.armed || ui.drag || Game.phase() !== 'placing') return;
      const a = Polyomino.anchor(Game.active().shape);
      setPreview(dropFromPointer(e.clientX, e.clientY, a.x, a.y));
    });
    grid.addEventListener('pointerleave', () => { if (ui.armed) setPreview(null); });
    grid.addEventListener('click', (e) => {
      if (!ui.armed || Game.phase() !== 'placing') return;
      const a = Polyomino.anchor(Game.active().shape);
      const drop = dropFromPointer(e.clientX, e.clientY, a.x, a.y);
      if (drop) { ui.preview.clear(); attemptPlace(drop); }
    });
  }

  function toggleArmed() {
    if (Game.phase() !== 'placing') return;
    ui.armed = !ui.armed;
    Game.setMessage(ui.armed ? 'Now tap a grid cell to drop the block there.' : 'Drag the block onto the puzzle grid.', 'info');
    if (!ui.armed) ui.preview.clear();
    Game.emit('change');
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
    $('btn-builder-reset').addEventListener('click', () => Game.resetBuilder());
    $('btn-confirm').addEventListener('click', () => Game.confirmShape());
    $('btn-rotate').addEventListener('click', () => Game.rotate());
    $('btn-reshape').addEventListener('click', () => Game.reshape());

    $('btn-replay').addEventListener('click', () => { $('overlay-complete').hidden = true; Game.restart(); });
    $('btn-complete-levels').addEventListener('click', () => { $('overlay-complete').hidden = true; Game.exit(); });
    $('btn-next').addEventListener('click', () => {
      const next = Game.state.currentLevel.id + 1;
      $('overlay-complete').hidden = true;
      openLevel(next);
    });

    initTray();

    document.addEventListener('keydown', (e) => {
      const typing = /^(INPUT|TEXTAREA)$/.test((document.activeElement || {}).tagName || '');
      if (e.key === 'Escape') {
        if (!$('overlay-help').hidden) closeHelp();
        else if (ui.armed) toggleArmed();
      }
      if ((e.key === 'r' || e.key === 'R') && !typing && ui.screen === 'game' && Game.phase() === 'placing') Game.rotate();
    });
    window.addEventListener('resize', () => { if (ui.screen === 'game' && Game.state.currentLevel) { ui.trayShape = null; if (ui.drag) endDrag(); renderAll(); } });

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
          const g = $('builder-grid');
          g.classList.remove('shake'); void g.offsetWidth; g.classList.add('shake');
          setTimeout(() => g.classList.remove('shake'), 500);
          break;
        }
        case 'placed': ui.popBlock = data.id; ui.armed = false; ui.preview.clear(); break;
        case 'placeFailed': {
          const n = Game.state.currentLevel.gridSize;
          ui.badFlash.clear();
          data.bad.forEach((b) => { if (b.x >= 0 && b.y >= 0 && b.x < n && b.y < n) ui.badFlash.add(b.y * n + b.x); });
          const f = $('grid-frame');
          f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake');
          setTimeout(() => { f.classList.remove('shake'); ui.badFlash.clear(); renderMainGrid(); }, 600);
          break;
        }
        case 'flashTarget': {
          const s = Game.state, n = s.currentLevel.gridSize;
          ui.flash.clear();
          for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (s.currentLevel.target[y][x] && !s.grid[y][x]) ui.flash.add(y * n + x);
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
