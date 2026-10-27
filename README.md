# @xavatech/xara-game-sdk

Build turn-based web games that people start from Xara chats, one-to-one or in groups. Your game is a web page; the Xara app opens it full screen and this SDK connects the two. The app makes every call to Xara with the player's account and asks for their PIN before anything is paid, so your page never sees a token, a PIN, or any account details.

See [xara-guess-the-number](https://github.com/xavatech/xara-guess-the-number) for a short game, and [xara-tic-tac-toe-game](https://github.com/xavatech/xara-tic-tac-toe-game) for a complete one.

## Cursor

Install the [game skill](https://docs.usexara.ai/games/skill) once, then describe the game:

```bash
curl -fsSL --create-dirs -o .claude/skills/build-xara-game/SKILL.md https://docs.usexara.ai/skills/build-xara-game/SKILL.md
```

## Install

Start a new game, with the SDK, tests, and the game skill set up:

```bash
npx @xavatech/create-xara-game my-game
```

Or add it to an existing page:

```bash
npm install @xavatech/xara-game-sdk
```

Or without a bundler: `<script src="https://unpkg.com/@xavatech/xara-game-sdk"></script>`, then `XaraGameSDK.connect()`.

## Use

```ts
import { connect } from "@xavatech/xara-game-sdk";

type MyMove = { cell: number };
const xara = connect<MyMove>();

xara.onChange(draw); // someone moved, accepted, or left
draw(await xara.load()); // the game as it stands, with every move so far

async function play(cell: number) {
  if (!xara.isMyTurn()) return;
  const won = /* your rules */ false;
  await xara.move(
    { cell },
    won ? { outcome: { winners: [xara.state!.me.id] } } : {},
  );
}
```

| Call                               | What it does                                                                                          |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `load()`                           | Loads the game and resolves with its state.                                                           |
| `onChange(fn)`                     | Calls `fn` with each new state. Returns a function that stops it.                                     |
| `isMyTurn()`                       | This phone is playing, and it is their turn.                                                          |
| `accept()`                         | Accepts this phone's invite. The game starts once everyone has.                                       |
| `move(move, { outcome? })`         | Plays a move. With `outcome` the move ends the game.                                                  |
| `end(outcome)`                     | Ends the game without a move. `winners: []` is a draw.                                                |
| `buy({ item, amount, reference })` | Asks the player to pay `amount` naira to your business. Resolves `success`, `cancelled`, or `failed`. |
| `close()`                          | Closes the game screen.                                                                               |

Calls the app refuses reject with `XaraGameError`; `code` is `rejected` (for example "It's not your turn"), `timeout`, or `closed` (not opened from Xara).

### Game state

- `session`: `status` (`invited`, `active`, `completed`, `declined`, `cancelled`), `moveCount`, `turn`, `outcome`.
- `players`: in turn order, starter first. `name` is how this phone labels them, and `you` marks this phone.
- `me`: this phone's `id`, and `watching` for a group member who is only watching.
- `moves`: every move, oldest first. Each has `playerId` and `move`, which is what the game sent. Replay them to draw the game.
- `purchases`: what this phone has bought in this game.

### Rules Xara keeps

Xara checks that whoever moves is a player, that it is their turn, and that the move follows the latest one; turns go round the players in order. Whether a move is legal in your game is for your game to check, on every phone, by replaying the moves. A move can hold any JSON up to 4,000 characters.

### Payments

`buy` opens the app's own approval sheet. Nothing is paid until the player enters their PIN, and the money goes to the business that submitted the game. `reference` is your id for the purchase: asking again with the same one returns that purchase instead of charging twice, so derive it from what is being bought (for example `hint-<session>-<move>`).

## Develop in a browser

```ts
import { connect, inXara, mockApp } from "@xavatech/xara-game-sdk";

if (!inXara())
  mockApp({
    players: [
      { id: 1, name: "Ada" },
      { id: 2, name: "Bayo" },
    ],
  });
```

Outside the app, a bar at the bottom switches which player's phone the page is. A move only goes through on that player's turn, the same as in the app.

## Security

- Serve the game over https. The app only answers SDK calls from the origin of the URL you submitted, and won't navigate anywhere else, so keep all pages on it and don't embed other sites.
- Each page load gets a fresh key that only your top frame can read; iframes can't talk to the app.

## Build this package

```bash
npm install
npm test
npm run build   # dist/: ESM, CommonJS, a browser global (XaraGameSDK), and types
```
