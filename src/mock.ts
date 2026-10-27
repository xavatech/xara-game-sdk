import { PROTOCOL_VERSION, type HostWindow } from "./client";
import type { WirePurchase, WireState } from "./wire";

export interface MockAppOptions {
  window?: HostWindow;
  game?: { id: number; name: string };
  /** Defaults to two players, both already in the game. */
  players?: { id: number; name: string }[];
  /** The game starts waiting for the other players to accept. */
  invited?: boolean;
  /** Approves or refuses a purchase. Defaults to approving it. */
  approvePayment?: (item: string, amount: number) => boolean | Promise<boolean>;
}

/**
 * Plays the part of the Xara app, so a game can be built in a browser.
 * The page is one phone. The bar it adds switches which player's phone
 * that is, and a move only goes through on that player's turn.
 */
export function mockApp(options: MockAppOptions = {}) {
  const win = options.window ?? (globalThis as unknown as HostWindow);
  const people = options.players ?? [
    { id: 1, name: "Player 1" },
    { id: 2, name: "Player 2" },
  ];
  const key = "mock";
  /** Which player's phone this page is. It stays until the bar switches it. */
  let phone = options.invited ? people[1].id : people[0].id;
  const moves: WireState["moves"] = [];
  const purchases: WirePurchase[] = [];
  const state: WireState = {
    game: options.game ?? { id: 1, name: "Game" },
    session: {
      session_id: 1,
      status: options.invited ? "invited" : "active",
      revision: 0,
      turn_user_id: options.invited ? null : people[0].id,
      created_by: people[0].id,
      group_id: null,
      result: null,
    },
    viewer: { user_id: options.invited ? people[1].id : people[0].id, role: "player" },
    players: people.map((person, i) => ({
      user_id: person.id,
      name: person.name,
      status: i === 0 || !options.invited ? "accepted" : "invited",
      is_you: false,
    })),
    moves,
    purchases,
  };

  const snapshot = (): WireState => {
    paint();
    return {
      ...structuredClone(state),
      viewer: { user_id: phone, role: "player" },
      players: state.players.map((player) => ({ ...player, is_you: player.user_id === phone })),
    };
  };
  const reply = (id: string, result?: unknown, error?: string) =>
    win.__xaraGamesReceive?.({
      source: "xara-host",
      v: PROTOCOL_VERSION,
      id,
      ...(error ? { ok: false, error: { code: "rejected", message: error } } : { ok: true, result }),
    });

  const handle = async (type: string, payload: Record<string, any>): Promise<unknown> => {
    const session = state.session;
    switch (type) {
      case "ready":
        return snapshot();
      case "accept": {
        const invited = state.players.find((player) => player.user_id === phone && player.status === "invited");
        if (session.status !== "invited" || !invited) throw new Error("This game has already started or ended");
        invited.status = "accepted";
        if (state.players.every((player) => player.status === "accepted")) {
          session.status = "active";
          session.turn_user_id = state.players[0].user_id;
        }
        return snapshot();
      }
      case "move":
      case "complete": {
        if (session.status !== "active") throw new Error("This game isn't being played");
        if (phone !== session.turn_user_id) throw new Error("It isn't your turn");
        if (payload.revision !== session.revision) throw new Error("The game has moved on. Reload it and try again");
        const mover = session.turn_user_id!;
        if (type === "move") {
          session.revision += 1;
          moves.push({ revision: session.revision, user_id: mover, payload: payload.move, created_at: new Date().toISOString() });
          const index = state.players.findIndex((player) => player.user_id === mover);
          session.turn_user_id = state.players[(index + 1) % state.players.length].user_id;
        }
        if (payload.result) {
          session.status = "completed";
          session.turn_user_id = null;
          session.result = { winner_ids: payload.result.winner_ids ?? [], summary: payload.result.summary ?? null };
        }
        return snapshot();
      }
      case "requestPayment": {
        const existing = purchases.find((purchase) => purchase.reference === payload.reference);
        if (existing?.status === "paid") return { status: "success", purchase: existing };
        const approve = options.approvePayment ?? (() => true);
        if (!(await approve(payload.item, payload.amount))) return { status: "cancelled" };
        const purchase: WirePurchase = existing ?? {
          id: purchases.length + 1,
          session_id: session.session_id,
          reference: payload.reference,
          item: payload.item,
          amount: payload.amount,
          currency: "NGN",
          status: "paid",
          payment_reference: `mock-${purchases.length + 1}`,
        };
        if (!existing) purchases.push(purchase);
        return { status: "success", purchase };
      }
      case "close":
        return undefined;
    }
    throw new Error(`Unknown call ${type}`);
  };

  win.XaraGames = {
    postMessage(raw: string) {
      const call = JSON.parse(raw);
      if (call.key !== key) return;
      handle(call.type, call.payload ?? {}).then(
        (result) => reply(call.id, result),
        (error: Error) => reply(call.id, undefined, error.message)
      );
    },
  };
  const boot = { source: "xara-host" as const, v: PROTOCOL_VERSION, key };
  win.__xaraGamesBoot = boot;
  win.__xaraGamesOnBoot?.(boot);

  const bar = mountBar(win, people, (id) => {
    phone = id;
    push();
  });

  function paint() {
    bar?.paint(phone, state.players.find((player) => player.user_id === state.session.turn_user_id)?.name ?? null);
  }

  function push() {
    win.__xaraGamesReceive?.({ source: "xara-host", v: PROTOCOL_VERSION, event: "state", payload: snapshot() });
  }

  return {
    /** Makes the page that player's phone, and tells the game. */
    playAs(userId: number) {
      phone = userId;
      push();
    },
    /** Sends the state as it is now, the way the app does when another phone changes the game. */
    push,
  };
}

/** The bar for switching phones. Absent where there is no page, such as tests. */
function mountBar(
  win: HostWindow,
  people: { id: number; name: string }[],
  onPick: (id: number) => void
): { paint(phone: number, turnName: string | null): void } | null {
  const doc = (win as { document?: Document }).document;
  if (!doc?.body) return null;
  const bar = doc.createElement("div");
  bar.setAttribute("style", [
    "position:fixed", "z-index:2147483647", "left:50%", "bottom:16px", "transform:translateX(-50%)",
    "display:flex", "align-items:center", "gap:6px", "padding:6px",
    "background:#102a24", "color:#fff", "border-radius:999px",
    "font:600 13px/1 system-ui,sans-serif", "box-shadow:0 8px 24px rgb(0 0 0 / 28%)",
  ].join(";"));
  const turn = doc.createElement("span");
  turn.setAttribute("style", "padding:0 8px;color:#b7c4bf");
  const buttons = people.map((person) => {
    const button = doc.createElement("button");
    button.type = "button";
    button.textContent = person.name;
    button.setAttribute("style", "border:0;border-radius:999px;padding:8px 12px;font:inherit;cursor:pointer");
    button.addEventListener("click", () => onPick(person.id));
    bar.append(button);
    return button;
  });
  bar.append(turn);
  doc.body.append(bar);
  return {
    paint(phone, turnName) {
      buttons.forEach((button, i) => {
        const on = people[i].id === phone;
        button.style.background = on ? "#fff" : "transparent";
        button.style.color = on ? "#102a24" : "#fff";
      });
      turn.textContent = turnName ? `${turnName}'s turn` : "";
    },
  };
}
