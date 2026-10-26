import { PROTOCOL_VERSION, type HostWindow } from "./client";
import type { GameState, Move, PaymentResult, Player, Purchase } from "./types";

export interface MockHostOptions {
  window?: HostWindow;
  game?: { id: number; name: string };
  /** Defaults to two players, both accepted. */
  players?: Pick<Player, "user_id" | "name">[];
  /** The game starts waiting for the other players to accept. */
  invited?: boolean;
  /** Approves or refuses a purchase; defaults to approving it. */
  approvePayment?: (item: string, amount: number) => boolean | Promise<boolean>;
}

/**
 * Plays the part of the Xara app, so a game can be built in a browser.
 * Like the app it keeps turns and revisions, but every player sits at this
 * one screen: the viewer is always whoever's turn it is.
 */
export function installMockHost(options: MockHostOptions = {}) {
  const win = options.window ?? (globalThis as unknown as HostWindow);
  const people = options.players ?? [
    { user_id: 1, name: "Player 1" },
    { user_id: 2, name: "Player 2" },
  ];
  const key = "mock";
  const moves: Move[] = [];
  const purchases: Purchase[] = [];
  const state: GameState = {
    game: options.game ?? { id: 1, name: "Game" },
    session: {
      session_id: 1,
      status: options.invited ? "invited" : "active",
      revision: 0,
      turn_user_id: options.invited ? null : people[0].user_id,
      created_by: people[0].user_id,
      group_id: null,
      result: null,
    },
    viewer: { user_id: options.invited ? people[1].user_id : people[0].user_id, role: "player" },
    players: people.map((person, i) => ({
      ...person,
      status: i === 0 || !options.invited ? "accepted" : "invited",
      is_you: false,
    })),
    moves,
    purchases,
  };

  const snapshot = (): GameState => {
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
        if (existing?.status === "paid") return { status: "success", purchase: existing } satisfies PaymentResult;
        const approve = options.approvePayment ?? (() => true);
        if (!(await approve(payload.item, payload.amount))) return { status: "cancelled" } satisfies PaymentResult;
        const purchase: Purchase = existing ?? {
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
        return { status: "success", purchase } satisfies PaymentResult;
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
