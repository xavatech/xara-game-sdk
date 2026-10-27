---
name: build-xara-game
description: >-
  Builds a turn-based web game for Xara chats from a plain-language game
  description, using @xavatech/xara-game-sdk. Use when a third party asks to
  create, scaffold, or implement a game for Xara, describes a game people
  should play from a Xara chat, or mentions the Xara game SDK.
---

# Build a Xara game

The user describes a game. Build it as its own static web page with `@xavatech/xara-game-sdk`. Create a new project. Do not add the game to the SDK repo, and do not call Xara's HTTP API.

Xara already checks membership, acceptance, whose turn it is, and that a move follows the previous one. The game checks whether a move is legal.

## Turn the description into rules

Write this down before the screen:

- Player count, fixed or a range, between 2 and 8. The starter goes first. Turns continue in that order.
- One move, as JSON the game sends. Keep it under 4,000 characters.
- How replaying `state.moves` draws the current game. Every phone, including someone watching, rebuilds from that list. Do not keep board state only in memory.
- Who wins, and what a draw is.
- A purchase, only if the description includes one: the item name, a whole naira amount from 1 to 1,000,000, and a reference.

A fact every phone must share, and that is not itself a move (a secret number, a shuffled deck), is derived from `session.id` plus the move list. There is no hidden game state on the server.

The chat card shows one summary to everyone. It never says "you". Name the player by their mark, the winning value, or similar. Stay within 120 characters.

## Project

Vite and TypeScript. `base: "./"` so the built files work from any https path. One private package. Depend on `@xavatech/xara-game-sdk`.

```
index.html
src/main.ts
src/rules.ts
src/rules.test.ts
src/style.css
vite.config.ts
```

Rules live in `src/rules.ts` and have tests. `src/main.ts` only draws state and sends moves. Do not add a helper module for something `rules.ts` can do.

Lock the page to itself:

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; frame-src 'none'">
```

No other origins, no CDN fonts, no iframes.

## Connect

```ts
import { connect, inXara, mockApp } from "@xavatech/xara-game-sdk";

if (import.meta.env.DEV && !inXara()) {
  mockApp({
    players: [
      { id: 1, name: "Ada" },
      { id: 2, name: "Bayo" },
    ],
    approvePayment: (item, amount) => window.confirm(`Buy ${item} for ₦${amount}?`),
  });
}

type Move = { cell: number };
const xara = connect<Move>();
xara.onChange(draw);
draw(await xara.load());
```

`mockApp` is for the browser during development. It is not part of the build the app opens.

## Draw and play

Redraw from the `GameState` passed to `draw`. Fields the game uses:

- `session.status`: `invited`, `active`, `completed`, `declined`, `cancelled`
- `session.moveCount`, `session.turn`, `session.id`, `session.outcome` (`winners`, `summary`)
- `players`: `id`, `name`, `status`, `you`
- `me`: `id`, `watching` (a group member who is not playing)
- `moves`: `step`, `playerId`, `move`, `at` — oldest first. `move` is the JSON this game sent
- `purchases`: `reference`, `status` (`requested` or `paid`), `receipt`

While `session.status` is `invited` and this phone's player is still invited, show an accept control that calls `xara.accept()`. The session starts after every invitee accepts. Someone watching gets no accept control and no move control.

Accept a move only when `xara.isMyTurn()` is true. Ignore clicks otherwise.

```ts
await xara.move({ cell }, won
  ? { outcome: { winners: [xara.state!.me.id], summary: "X wins with three in a row" } }
  : {});
```

Pass `outcome` on the move that ends the game. `winners` is the player ids. An empty list is a draw. Call `xara.end(outcome)` only when the game ends without a move. `xara.close()` leaves the game screen.

Give status, the board, and any purchase line a fixed height so a new move does not push the page around.

## A purchase

Skip this when the description has nothing to sell.

```ts
const paid = await xara.buy({
  item: "Hint",
  amount: 100,
  reference: `hint-${state.session.id}-${state.session.moveCount}`,
});
if (paid.status === "success") showHint();
```

The reference matches `/^[A-Za-z0-9_.:-]{1,64}$/`. The same reference returns the existing purchase. A different item or amount on that reference is refused. Put `moveCount` in the reference only when a later turn is a new purchase; leave it out when the purchase is once per session (`hint-${session.id}`).

After a reload, read `state.purchases`. Show the item when one with that reference has `status === "paid"`. The page never asks for a PIN. The app shows its own approval sheet. The payee is the business that submitted the game.

`XaraGameError` codes are `rejected`, `timeout`, and `closed`. A closed error means the page was not opened from a Xara chat.

## Names to use

Use the names above. These older names are not the SDK: `ready`, `onState`, `viewer`, `requestPayment`, `installMockHost`, `winner_ids`, `revision`, `turn_user_id`.

## Check

1. `npm test` for the rules, including an illegal move, a win, a draw, and a purchase reference if the game sells something.
2. `npm run build`.
3. With the dev server, play a full game through `mockApp`: accept, take turns, reach the outcome, and buy once if the game sells something. Play again with the same reference and confirm it does not describe a second charge.
4. Replay the same `moves` and confirm both players would draw the same board.

## What to tell the user

The built `dist/` is a static site. It has to be served over https on one origin. They submit that URL in the Xara business dashboard with the player counts and SDK version `2.0.0`. The game stays in review until an admin approves it. Changing the URL or the player counts after approval sends it back to review. Changing the name, description, or icon does not.

Do not submit, host, or publish the package unless the user asks.
