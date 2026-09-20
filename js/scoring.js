/* scoring.js — simple, explainable scoring + stars. */
(function () {
  const PC = (globalThis.PC = globalThis.PC || {});

  const Scoring = {
    BASE: 1000,
    HINT_COST: 75,
    WRONG_COST: 25,
    UNDO_COST: 20,
    OVERTIME_COST_PER_SEC: 2,
    MIN_SCORE: 100,
    THREE_STAR: 850,
    TWO_STAR: 600,

    /**
     * score = 1000 − 75·hints − 25·wrongAnswers − 20·undos − 2·(seconds over par time)
     * (never below 100).  Stars: ≥850 → 3, ≥600 → 2, otherwise 1.
     */
    compute(stats, level) {
      const par = level.parTime || 120;
      const over = Math.max(0, Math.floor(stats.seconds) - par);
      const breakdown = {
        base: Scoring.BASE,
        hints: stats.hints * Scoring.HINT_COST,
        wrong: stats.wrong * Scoring.WRONG_COST,
        undos: stats.undos * Scoring.UNDO_COST,
        overtime: over * Scoring.OVERTIME_COST_PER_SEC,
        parTime: par
      };
      const score = Math.max(Scoring.MIN_SCORE, Scoring.BASE - breakdown.hints - breakdown.wrong - breakdown.undos - breakdown.overtime);
      return { score, stars: Scoring.stars(score), breakdown };
    },

    stars(score) {
      if (score >= Scoring.THREE_STAR) return 3;
      if (score >= Scoring.TWO_STAR) return 2;
      return 1;
    },

    formatTime(totalSeconds) {
      const s = Math.max(0, Math.floor(totalSeconds));
      return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    }
  };

  PC.Scoring = Scoring;
})();
