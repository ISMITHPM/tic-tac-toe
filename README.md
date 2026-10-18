# Tic Tac Toe

A Chrome extension that puts a game of tic-tac-toe in your toolbar popup.

## Features

- Play an easy computer, a hard computer, or a human opponent on the same screen
- 3×3, 5×5 and 7×7 grids (3, 4 and 5 in a row to win)
- The hard computer is unbeatable on 3×3 (minimax); on 5×5 and 7×7 it uses a strong heuristic
- The pointer becomes the X or O you are about to place
- Replay the last game move by move
- History of the last 20 games for each opponent and grid size, with a filterable overview grid and pie charts
- Themes (Classic blue, Schoolbook, Dark) and a font toggle (Standard or Poppins)
- Options and scores are saved with `chrome.storage.local`. Nothing leaves your browser.

## Install for development

1. Clone this repository.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and choose the repository folder.

## Tests

The game logic in `game.js` has no browser dependencies and can be tested with Node:

```
node tests/game.test.js
```

## Packaging for the Chrome Web Store

Only the extension files should go in the upload:

```
zip -r tic-tac-toe.zip manifest.json popup.html popup.css popup.js game.js icons fonts
```

## Project layout

| File | Purpose |
| --- | --- |
| `manifest.json` | Extension manifest (Manifest V3) |
| `popup.html`, `popup.css`, `popup.js` | The popup UI |
| `game.js` | Game rules, computer players and score maths |
| `fonts/` | Poppins (Latin subset), licensed under the SIL Open Font License |

## Licence

The code is released under the [MIT License](LICENSE). The bundled Poppins font files in `fonts/` are covered by their own licence, the SIL Open Font License (see `fonts/OFL.txt`).
