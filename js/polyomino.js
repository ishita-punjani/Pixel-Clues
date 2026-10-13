/* polyomino.js — player-drawn shapes: connectivity and validation. */
(function () {
  const PC = (globalThis.PC = globalThis.PC || {});
  const DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]]; // UP DOWN LEFT RIGHT — no diagonals

  const Polyomino = {
    /** BFS over orthogonal neighbours; returns the set of visited cells from the first cell. */
    reachable(cells, startIdx = 0) {
      if (!cells.length) return [];
      const key = (c) => c.x + ',' + c.y;
      const all = new Map(cells.map((c) => [key(c), c]));
      const seen = new Set([key(cells[startIdx])]);
      const queue = [cells[startIdx]];
      const out = [];
      while (queue.length) {
        const cur = queue.shift();
        out.push(cur);
        for (const [dx, dy] of DIRS) {
          const nk = (cur.x + dx) + ',' + (cur.y + dy);
          if (all.has(nk) && !seen.has(nk)) { seen.add(nk); queue.push(all.get(nk)); }
        }
      }
      return out;
    },

    isConnected(cells) {
      if (cells.length === 0) return false;
      return Polyomino.reachable(cells).length === cells.length;
    },

    /** Cells that are NOT part of the largest connected group (used for highlighting). */
    stray(cells) {
      const key = (c) => c.x + ',' + c.y;
      const left = new Map(cells.map((c) => [key(c), c]));
      let best = [];
      while (left.size) {
        const comp = Polyomino.reachable([...left.values()]);
        comp.forEach((c) => left.delete(key(c)));
        if (comp.length > best.length) best = comp;
      }
      const bk = new Set(best.map(key));
      return cells.filter((c) => !bk.has(key(c)));
    },

    /**
     * A shape is valid only when selected === n AND all cells are orthogonally connected.
     */
    validate(cells, n) {
      if (cells.length !== n) {
        return { valid: false, reason: 'count', message: `Use exactly ${n} pixels.`, stray: [] };
      }
      if (!Polyomino.isConnected(cells)) {
        return { valid: false, reason: 'disconnected', message: 'All pixels must be connected.', stray: Polyomino.stray(cells) };
      }
      return { valid: true, reason: null, message: '', stray: [] };
    }
  };

  PC.Polyomino = Polyomino;
})();
