# Pixel Clues — browser prototype

Solve words → earn pixels → design a connected shape → place it → build the picture.

## Run
Open `index.html` in any modern browser (double-click). It uses classic `<script>` tags, so no server is needed.
Optional local server: `python -m http.server 8080` then visit http://localhost:8080.

## Tests (optional)
```
npm install            # only needed for the browser e2e test (Playwright)
npx playwright install chromium
npm test               # level solvability + 55 unit tests + browser e2e
```
`node tests/unit.test.js` and `node tools/verify_levels.js` need no dependencies.

## Structure
- `js/levels.js` – level data (row strings → target matrix, colours, pre-filled cells)
- `js/grid.js` – placement validation, target comparison, pointer→cell maths
- `js/polyomino.js` – BFS connectivity, validation, normalise, rotate
- `js/crossword.js`, `js/scoring.js`, `js/storage.js` – answers/hints, score+stars, guarded localStorage
- `js/game.js` – state machine, timer, undo/restart, completion; `js/ui.js` – DOM + drag/drop
- `tools/verify_levels.js` – proves each level has a valid partition into connected pieces

Score = 1000 − 75·hints − 25·wrong answers − 20·undos − 2·(seconds over par), min 100. ★★★ ≥ 850, ★★ ≥ 600, otherwise ★.
"Presenter mode" (level select) opens locked levels for demos without saving progress.
