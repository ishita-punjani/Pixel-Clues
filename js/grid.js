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

    inBounds(grid, x, y) { return x >= 0 && y >= 0 && y < grid.length && x < grid.length; },
    isFree(grid, x, y) { return Grid.inBounds(grid, x, y) && grid[y][x] === null; },
    isOccupied(grid, x, y) { return Grid.inBounds(grid, x, y) && grid[y][x] !== null; },

    /** Mark absolute cells {x,y} with `info` (e.g. {clue, block}). Cells must already be free. */
    put(grid, cells, info) {
      cells.forEach((c) => { grid[c.y][c.x] = Object.assign({}, info); });
    },

    /** Clear absolute cells {x,y} back to empty. */
    remove(grid, cells) {
      cells.forEach((c) => { grid[c.y][c.x] = null; });
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
