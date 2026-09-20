/* crossword.js — clue answer checking and letter hints. */
(function () {
  const PC = (globalThis.PC = globalThis.PC || {});

  const Crossword = {
    normalize(text) { return String(text == null ? '' : text).toUpperCase().replace(/[^A-Z]/g, ''); },

    /** 'empty' | 'correct' | 'incorrect' */
    check(clue, input) {
      const t = Crossword.normalize(input);
      if (!t) return 'empty';
      return t === Crossword.normalize(clue.answer) ? 'correct' : 'incorrect';
    },

    /** e.g. answer FLOWER, 2 revealed → ['F','L','_','_','_','_'] */
    pattern(answer, revealed) {
      return answer.split('').map((ch, i) => (i < revealed ? ch : '_'));
    },

    maxReveal(answer) { return Math.max(0, answer.length - 1); }
  };

  PC.Crossword = Crossword;
})();
