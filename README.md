# @xavatech/xara-game-sdk

Build turn-based web games that people start from Xara chats, one-to-one or in groups. Your game is a web page; the Xara app opens it full screen and this SDK connects the two. The app makes every call to Xara with the player's account and asks for their PIN before anything is paid, so your page never sees a token, a PIN, or any account details.

See [xara-tic-tac-toe](../xara-tic-tac-toe) for a complete game.

## Install

```bash
npm install @xavatech/xara-game-sdk
```

Or without a bundler: `<script src="https://unpkg.com/@xavatech/xara-game-sdk"></script>`, then `XaraGameSDK.connect()`.

## Use

```ts
import { connect } from "@xavatech/xara-game-sdk";

type MyMove = { cell: number };
const xara = connect<MyMove>();

xara.onState(draw);           // another player moved, accepted, or left
draw(await xara.ready());     // the game as it stands, with every move so far

async function play(cell: number) {
  if (!xara.isMyTurn()) return;
  const won = /* your rules */ false;
  await xara.move({ cell }, won ? { result: { winner_ids: [xara.state!.viewer.user_id] } } : {});
}
```

| Call | What it does |
| --- | --- |
| `ready()` | Connects and resolves with the `GameState`. |
| `onState(fn)` | Calls `fn` with each new state. Returns a function that stops it. |
| `isMyTurn()` | The viewer is a player and it's their turn. |
| `accept()` | Accepts the viewer's invite. The game starts once everyone has. |
| `move(payload, { result? })` | Moves after the latest revision. With `result` the move ends the game. |
| `complete(result)` | Ends the game without a move. `winner_ids: []` is a draw. |
| `requestPayment({ item, amount, reference })` | Asks the player to pay `amount` naira to your business. Resolves `success`, `cancelled`, or `failed`. |
| `close()` | Closes the game screen. |

Calls the app refuses reject with `XaraGameError`; `code` is `rejected` (for example "It's not your turn"), `timeout`, or `closed` (not opened from Xara).

### Game state

- `session`: `status` (`invited`, `active`, `completed`, `declined`, `cancelled`), `revision` (moves made), `turn_user_id`, `result`.
- `players`: in turn order, starter first, with `name` as the viewer's phone labels them and `is_you`.
- `viewer`: `user_id` and `role` (`player`, or `spectator` for group members watching).
- `moves`: every move, oldest first. Replay them to draw the game; it is how a reopened game catches up.
- `purchases`: the viewer's purchases in this session.

### Rules Xara keeps

Xara checks that whoever moves is a player, that it is their turn, and that the move follows the latest revision; turns go round the players in order. Whether a move is legal in your game is for your game to check, on every phone, by replaying the moves. A move can hold any JSON up to 4,000 characters.

### Payments

`requestPayment` opens the app's own approval sheet. Nothing is paid until the player enters their PIN, and the money goes to the business that submitted the game. `reference` is your id for the purchase: asking again with the same one returns that purchase instead of charging twice, so derive it from what is being bought (for example `hint-<session>-<revision>`).

## Develop in a browser

```ts
import { connect, inXara, installMockHost } from "@xavatech/xara-game-sdk";

if (import.meta.env.DEV && !inXara()) installMockHost({ players: [{ user_id: 1, name: "Ada" }, { user_id: 2, name: "Bayo" }] });
```

The mock host keeps turns and revisions like the app, with every player at one screen.

## Security

- Serve the game over https. The app only answers SDK calls from the origin of the URL you submitted, and won't navigate anywhere else, so keep all pages on it and don't embed other sites.
- Each page load gets a fresh key that only your top frame can read; iframes can't talk to the app.

## Build this package

```bash
npm install
npm test
npm run build   # dist/: ESM, CommonJS, a browser global (XaraGameSDK), and types
```
