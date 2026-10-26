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
 * Turns work the way they do in the app, but every player sits at this
 * one screen: this phone is always whoever's turn it is.
 */
export function mockApp(options: MockAppOptions = {}) {
  const win = options.window ?? (globalThis as unknown as HostWindow);
  const people = options.players ?? [
    { id: 1, name: "Player 1" },
    { id: 2, name: "Player 2" },
  ];
  const key = "mock";
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
    const viewer = state.session.turn_user_id ?? state.viewer.user_id;
    return {
      ...structuredClone(state),
      viewer: { user_id: viewer, role: "player" },
      players: state.players.map((player) => ({ ...player, is_you: player.user_id === viewer })),
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
        const invited = state.players.find((player) => player.status === "invited");
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

  return {
    /** Sends the state as it is now, the way the app does when another phone changes the game. */
    push() {
      win.__xaraGamesReceive?.({ source: "xara-host", v: PROTOCOL_VERSION, event: "state", payload: snapshot() });
    },
  };
}
