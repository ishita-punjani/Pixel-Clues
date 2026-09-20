// Verifies every level: row lengths, pixel budget and that a partition into connected
// pieces of the required sizes actually exists (randomised constructive search).
require('../js/levels.js');
const PC = globalThis.PC;

function neighbors(x, y) { return [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]; }
const key = (x, y) => x + ',' + y;

function subsetPossible(sizes, target) {
  const dp = new Set([0]);
  for (const s of sizes) for (const v of [...dp]) dp.add(v + s);
  return dp.has(target);
}
function canSumEach(compSizes, sizes) {
  // can the remaining piece sizes be split among components (each component sum exact)?
  const used = new Array(sizes.length).fill(false);
  const comps = [...compSizes].sort((a, b) => b - a);
  function go(ci) {
    if (ci === comps.length) return used.every(Boolean);
    const need = comps[ci];
    function pick(start, rem) {
      if (rem === 0) return go(ci + 1);
      for (let i = start; i < sizes.length; i++) {
        if (used[i] || sizes[i] > rem) continue;
        used[i] = true;
        if (pick(i + 1, rem - sizes[i])) return true;
        used[i] = false;
      }
      return false;
    }
    return pick(0, need);
  }
  return go(0);
}

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function solve(level, seedBase = 1) {
  const n = level.gridSize;
  const cells = new Set();
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++)
    if (level.target[y][x] && !level.prefilled[y][x]) cells.add(key(x, y));
  const sizes = level.clues.map((c) => c.answer.length);
  if (sizes.reduce((a, b) => a + b, 0) !== cells.size) return { error: `pixel budget mismatch ${sizes.reduce((a, b) => a + b, 0)} vs ${cells.size}` };

  function components(free) {
    const seen = new Set(), out = [];
    for (const k of free) {
      if (seen.has(k)) continue;
      const comp = []; const st = [k]; seen.add(k);
      while (st.length) {
        const c = st.pop(); comp.push(c);
        const [x, y] = c.split(',').map(Number);
        for (const [nx, ny] of neighbors(x, y)) { const nk = key(nx, ny); if (free.has(nk) && !seen.has(nk)) { seen.add(nk); st.push(nk); } }
      }
      out.push(comp);
    }
    return out;
  }

  for (let attempt = 0; attempt < 4000; attempt++) {
    const rand = rng(seedBase * 7919 + attempt);
    const free = new Set(cells);
    const remaining = sizes.map((s, i) => ({ s, i }));
    const solution = [];
    let ok = true;
    // order: process largest first sometimes, random otherwise
    remaining.sort(() => rand() - 0.5);
    while (remaining.length && ok) {
      const { s, i } = remaining.shift();
      // start at a free cell with the fewest free neighbours (hardest to fill later)
      const list = [...free].map((k) => { const [x, y] = k.split(',').map(Number); return { k, x, y, d: neighbors(x, y).filter(([a, b]) => free.has(key(a, b))).length }; });
      list.sort((a, b) => a.d - b.d || rand() - 0.5);
      const start = list[Math.floor(rand() * Math.min(3, list.length))];
      const piece = new Set([start.k]);
      while (piece.size < s) {
        const cand = [];
        for (const pk of piece) {
          const [x, y] = pk.split(',').map(Number);
          for (const [nx, ny] of neighbors(x, y)) {
            const nk = key(nx, ny);
            if (free.has(nk) && !piece.has(nk)) {
              const d = neighbors(nx, ny).filter(([a, b]) => free.has(key(a, b)) && !piece.has(key(a, b))).length;
              cand.push({ nk, d });
            }
          }
        }
        if (!cand.length) { ok = false; break; }
        cand.sort((a, b) => a.d - b.d || rand() - 0.5);
        piece.add(cand[Math.floor(rand() * Math.min(2, cand.length))].nk);
      }
      if (!ok) break;
      for (const k of piece) free.delete(k);
      solution.push({ clue: i, cells: [...piece].map((k) => { const [x, y] = k.split(',').map(Number); return { x, y }; }) });
      const rest = remaining.map((r) => r.s);
      const comps = components(free).map((c) => c.length);
      if (!canSumEach(comps, rest)) ok = false;
    }
    if (ok && free.size === 0) return { solution };
  }
  return { error: 'no partition found' };
}

module.exports = { solve };

if (require.main === module) {
  let failed = false;
  for (const lv of PC.LEVELS) {
    const r = solve(lv);
    const flag = r.solution ? 'SOLVABLE' : 'FAIL: ' + r.error;
    console.log(`L${lv.id} ${lv.name} ${lv.gridSize}x${lv.gridSize} clues=${lv.clues.length} playerCells=${lv.playerCells} answerSum=${lv.totalPixels} -> ${flag}`);
    if (!r.solution) failed = true;
  }
  process.exit(failed ? 1 : 0);
}
