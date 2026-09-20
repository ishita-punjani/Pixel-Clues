/* levels.js — data-driven level definitions.
 *
 * Each level is described by `rows`: an array of strings, one per grid row.
 *   '.'            empty cell
 *   UPPERCASE char cell the PLAYER must fill (letter = colour in PC.PALETTE)
 *   lowercase char cell that is PRE-FILLED at level start (same colour, lowercase)
 *
 * Rule for a solvable level:  sum of answer lengths === number of UPPERCASE cells.
 * (tools/verify_levels.js proves that a partition into connected pieces exists.)
 */
(function () {
  const PC = (globalThis.PC = globalThis.PC || {});

  PC.PALETTE = {
    G: '#1f5c45', // dark green
    L: '#79c46e', // light green
    P: '#f28fb1', // pink
    Y: '#ffd23f', // yellow
    K: '#4a3a34', // dark brown
    R: '#e2554f', // red
    S: '#9aa7b4', // stone
    B: '#4f9be0', // blue
    W: '#dbe6f0', // pale steel / white
    O: '#ff9440'  // orange
  };

  const LEVELS = [
    {
      id: 1, name: 'Beginner', title: 'Little House', gridSize: 8, playable: true,
      guidance: 'full', parTime: 120,
      blurb: 'Learn the loop: solve, shape, place.',
      rows: [
        '........',
        '........',
        '...PP...',
        '..PPPP..',
        '..YYYY..',
        '..YKKY..',
        '........',
        '........'
      ],
      clues: [
        { clue: 'Covers the top of a house', answer: 'ROOF' },
        { clue: 'You open it to walk inside', answer: 'DOOR' },
        { clue: 'Glass you look through in a wall', answer: 'WINDOW' }
      ]
    },
    {
      id: 2, name: 'Easy', title: 'Sailboat Bay', gridSize: 10, playable: true,
      guidance: 'light', parTime: 240,
      blurb: 'Longer words and a bigger picture.',
      rows: [
        '..........',
        '........YY',
        '....K...YY',
        '....KP....',
        '....KPP...',
        '....KPPP..',
        '....K.....',
        '.GGGGGGGG.',
        '..GGGGGG..',
        '..........'
      ],
      clues: [
        { clue: 'Huge body of salt water', answer: 'OCEAN' },
        { clue: 'Heavy weight dropped to keep a ship in place', answer: 'ANCHOR' },
        { clue: 'Person in charge of a ship', answer: 'CAPTAIN' },
        { clue: 'Cloth that catches the wind', answer: 'SAIL' },
        { clue: 'White bird that squawks at the beach', answer: 'SEAGULL' }
      ]
    },
    {
      id: 3, name: 'Medium', title: 'Flower Garden', gridSize: 12, playable: true,
      guidance: 'minimal', parTime: 300,
      blurb: 'The showcase: flower, leaf, bee, stem and sun.',
      rows: [
        '..........YY',
        '...........Y',
        '.....P......',
        '....PYP.YKY.',
        '.....P......',
        '.....G......',
        '.....G.LL...',
        '.....GLL....',
        '.....G......',
        '.....G......',
        '............',
        '............'
      ],
      clues: [
        { clue: 'A colourful plant with petals', answer: 'FLOWER' },
        { clue: 'Green part on a stem', answer: 'LEAF' },
        { clue: 'Buzzing garden visitor', answer: 'BEE' },
        { clue: 'Holds the flower upright', answer: 'STEM' },
        { clue: 'Gives warmth and light', answer: 'SUN' }
      ]
    },
    {
      id: 4, name: 'Hard', title: 'Castle Keep', gridSize: 15, playable: true,
      guidance: 'minimal', parTime: 480, preview: true,
      blurb: '15×15 with 8 clues, 10-letter words and a pre-built castle base.',
      rows: [
        '...............',
        '.......RR......',
        '.......K.......',
        '.......K.......',
        '..S.S.SSS.S.S..',
        '..SSS.SSS.SSS..',
        '..SYS.SYS.SYS..',
        '..SSS.SSS.SSS..',
        '..SSS.SKS.SSS..',
        '..SSSSSKSSSSS..',
        'sssssssssssssss',
        'lllllllllllllll',
        'lllllllllllllll',
        '...............',
        '...............'
      ],
      clues: [
        { clue: 'Tall round or square part of a castle wall', answer: 'TOWER' },
        { clue: 'Armoured warrior on horseback', answer: 'KNIGHT' },
        { clue: 'Bridge over a moat that can be lifted up', answer: 'DRAWBRIDGE' },
        { clue: 'Notched top edge of a wall for defenders', answer: 'BATTLEMENT' },
        { clue: 'Heavy iron grate lowered over a castle gate', answer: 'PORTCULLIS' },
        { clue: 'Fire-breathing beast of legend', answer: 'DRAGON' },
        { clue: 'Flag flown from a castle pole', answer: 'BANNER' },
        { clue: 'Metal suit worn by a knight', answer: 'ARMOR' }
      ]
    },
    {
      id: 5, name: 'Expert', title: 'Rocket Launch', gridSize: 20, playable: true,
      guidance: 'minimal', parTime: 720, preview: true,
      blurb: '20×20 with 11 clues, 11-letter words, a launch tower and a starry sky.',
      rows: [
        '..y...........y.....',
        '.......y..........y.',
        '...WWW...PP.........',
        '..WWWW..PPPP........',
        '..WWWW..WWWW...KK...',
        '..WWWW..WBBW...KK...',
        '...WWW..WBBW...KK...',
        '........WWWW...KK...',
        '........WWWWKKKKK...',
        '.......PWWWWP..KK...',
        '......PPWWWWPP.KK...',
        '......PP.OO.PP.KK...',
        '.........YY....KK...',
        '.........OO....KK...',
        '...............KK...',
        '...............KK...',
        '...............KK...',
        'ssssssssssssssssssss',
        'llllllllllllllllllll',
        'llllllllllllllllllll'
      ],
      clues: [
        { clue: 'Where astronomers study a whole collection of planets', answer: 'PLANETARIUM' },
        { clue: 'Journey of discovery into unknown places', answer: 'EXPLORATION' },
        { clue: 'Engine part that pushes a rocket upward', answer: 'THRUSTER' },
        { clue: 'The red planet', answer: 'MARS' },
        { clue: 'Vehicle that carries crew beyond Earth', answer: 'SPACESHIP' },
        { clue: 'Platform a rocket takes off from', answer: 'LAUNCHPAD' },
        { clue: 'Person who travels in space', answer: 'ASTRONAUT' },
        { clue: 'Instrument for viewing distant stars', answer: 'TELESCOPE' },
        { clue: 'Man-made object circling the Earth', answer: 'SATELLITE' },
        { clue: 'Silvery glow of the night sky', answer: 'MOONLIGHT' },
        { clue: 'Numbers said backwards before blast-off', answer: 'COUNTDOWN' }
      ]
    }
  ];

  /** Parse the row strings into matrices the engine uses. Mutates + returns level. */
  function prepare(level) {
    const n = level.gridSize;
    level.target = [];   // targetGrid[y][x]: 1 = must be occupied at the end (incl. pre-filled)
    level.art = [];      // colour letter per cell
    level.prefilled = []; // 1 = occupied at the start
    let need = 0;
    for (let y = 0; y < n; y++) {
      const row = level.rows[y] || '';
      if (row.length !== n) throw new Error(`Level ${level.id} row ${y} has length ${row.length}, expected ${n}`);
      level.target.push([]); level.art.push([]); level.prefilled.push([]);
      for (let x = 0; x < n; x++) {
        const ch = row[x];
        const filled = ch !== '.';
        const pre = filled && ch === ch.toLowerCase();
        level.target[y].push(filled ? 1 : 0);
        level.prefilled[y].push(pre ? 1 : 0);
        level.art[y].push(filled ? ch.toUpperCase() : '');
        if (filled && !pre) need++;
      }
    }
    level.playerCells = need;
    level.totalPixels = level.clues.reduce((s, c) => s + c.answer.length, 0);
    level.clues.forEach((c) => { c.answer = c.answer.toUpperCase(); });
    return level;
  }

  LEVELS.forEach(prepare);
  PC.LEVELS = LEVELS;
  PC.prepareLevel = prepare;
})();
