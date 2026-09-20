/* storage.js — lightweight persistence. Every localStorage call is wrapped in try/catch,
 * so a blocked/full/disabled storage can never crash the game (falls back to memory). */
(function () {
  const PC = (globalThis.PC = globalThis.PC || {});
  const KEY = 'pixelclues.save.v1';

  function fresh() {
    return { unlocked: 1, completed: {}, stars: {}, bestScores: {}, bestTimes: {}, presenter: false };
  }

  const Storage = {
    KEY,
    data: fresh(),
    persistent: true,

    load() {
      try {
        const raw = globalThis.localStorage.getItem(KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          Storage.data = Object.assign(fresh(), parsed);
        } else {
          Storage.data = fresh();
        }
      } catch (err) {
        console.warn('Could not load game progress:', err);
        Storage.persistent = false;
        Storage.data = fresh();
      }
      return Storage.data;
    },

    save() {
      try {
        globalThis.localStorage.setItem(KEY, JSON.stringify(Storage.data));
        Storage.persistent = true;
        return true;
      } catch (err) {
        console.warn('Could not save game progress:', err);
        Storage.persistent = false;
        return false;
      }
    },

    isUnlocked(id) { return id <= Storage.data.unlocked; },

    recordCompletion(id, score, stars, seconds, levelCount) {
      const d = Storage.data;
      d.completed[id] = true;
      d.bestScores[id] = Math.max(d.bestScores[id] || 0, score);
      d.stars[id] = Math.max(d.stars[id] || 0, stars);
      d.bestTimes[id] = d.bestTimes[id] ? Math.min(d.bestTimes[id], seconds) : seconds;
      d.unlocked = Math.min(levelCount, Math.max(d.unlocked, id + 1));
      return Storage.save();
    },

    setPresenter(on) { Storage.data.presenter = !!on; Storage.save(); },

    reset() {
      Storage.data = fresh();
      Storage.save();
    }
  };

  PC.Storage = Storage;
})();
