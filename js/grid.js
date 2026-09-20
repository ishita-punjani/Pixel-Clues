/* grid.js — pure grid helpers (no DOM). grid[y][x] is null (empty) or an object {clue, block, pre}. */
(function () {
  const PC = (globalThis.PC = globalThis.PC || {});

  const Grid = {
    create(size) {
      return Array.from({ length: size }, () => Array(size).fill(null));
    },

    /** New grid with the level's pre-filled cells already occupied. */
    fromLevel(level) {
      const g = Grid.create(level.gridSize);
      for (let y = 0; y < level.gridSize; y++)
        for (let x = 0; x < level.gridSize; x++)
          if (level.prefilled[y][x]) g[y][x] = { pre: true, clue: -1, block: -1 };
      return g;
    },

    /**
     * Validate placing `cells` (relative coords) with its origin at (dropX, dropY).
     * Valid only if EVERY cell is inside the grid and lands on an empty cell.
     * Does not modify the grid.
     */
    canPlace(grid, cells, dropX, dropY) {
      const size = grid.length;
      const bad = [];
      let outside = false, collision = false;
      for (const c of cells) {
        const ax = dropX + c.x;
        const ay = dropY + c.y;
        if (ax < 0 || ax >= size || ay < 0 || ay >= size) { outside = true; bad.push({ x: ax, y: ay, type: 'outside' }); continue; }
        if (grid[ay][ax] !== null) { collision = true; bad.push({ x: ax, y: ay, type: 'collision' }); }
      }
      if (outside) return { ok: false, reason: 'out-of-bounds', message: 'That block goes outside the puzzle.', bad };
      if (collision) return { ok: false, reason: 'collision', message: 'That space is already occupied.', bad };
      return { ok: true, reason: null, message: '', bad: [] };
    },

    absolute(cells, dropX, dropY) {
      return cells.map((c) => ({ x: dropX + c.x, y: dropY + c.y }));
    },

    put(grid, cells, dropX, dropY, info) {
      for (const c of Grid.absolute(cells, dropX, dropY)) grid[c.y][c.x] = Object.assign({}, info);
    },

    remove(grid, cells, dropX, dropY) {
      for (const c of Grid.absolute(cells, dropX, dropY)) grid[c.y][c.x] = null;
    },

    /** Compare occupancy of the player's grid with the target matrix. */
    compare(grid, target) {
      const size = grid.length;
      const extra = [], missing = [];
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const occ = grid[y][x] !== null;
          if (occ && !target[y][x]) extra.push({ x, y });
          if (!occ && target[y][x]) missing.push({ x, y });
        }
      return { match: extra.length === 0 && missing.length === 0, extra, missing };
    },

    /**
     * Convert a pointer position to a grid cell using the grid's ACTUAL rendered rectangle,
     * so it stays correct at every viewport size.
     */
    cellFromPoint(rect, size, clientX, clientY) {
      const cellW = rect.width / size;
      const cellH = rect.height / size;
      const x = Math.floor((clientX - rect.left) / cellW);
      const y = Math.floor((clientY - rect.top) / cellH);
      const inside = clientX >= rect.left && clientX < rect.left + rect.width &&
                     clientY >= rect.top && clientY < rect.top + rect.height;
      return { x, y, inside, cellW, cellH };
    }
  };

  PC.Grid = Grid;
})();
