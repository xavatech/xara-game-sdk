import type { GameState, Outcome, Purchase } from "./types";

/** The JSON the Xara app sends. Game code never sees this. */
export interface WirePlayer {
  user_id: number;
  name: string;
  status: "invited" | "accepted" | "declined";
  is_you: boolean;
}

export interface WireState {
  session: {
    session_id: number;
    status: GameState["session"]["status"];
    revision: number;
    turn_user_id: number | null;
    created_by: number;
    group_id: number | null;
    result: { winner_ids: number[]; summary: string | null; forfeited_by?: number } | null;
  };
  game: { id: number; name: string };
  viewer: { user_id: number; role: "player" | "spectator" };
  players: WirePlayer[];
  moves: { revision: number; user_id: number; payload: unknown; created_at: string }[];
  purchases: WirePurchase[];
}

export interface WirePurchase {
  id: number;
  session_id: number;
  reference: string;
  item: string;
  amount: number;
  currency: "NGN";
  status: "requested" | "paid";
  payment_reference: string | null;
}

export function readState<T>(raw: WireState): GameState<T> {
  const session = raw.session;
  const result = session.result;
  return {
    session: {
      id: session.session_id,
      status: session.status,
      moveCount: session.revision ?? 0,
      turn: session.turn_user_id ?? null,
      startedBy: session.created_by,
      groupId: session.group_id ?? null,
      outcome: result
        ? {
            winners: result.winner_ids ?? [],
            summary: result.summary ?? null,
            ...(result.forfeited_by != null ? { leftBy: result.forfeited_by } : {}),
          }
        : null,
    },
    game: { id: raw.game.id, name: raw.game.name },
    me: { id: raw.viewer.user_id, watching: raw.viewer.role === "spectator" },
    players: raw.players.map((player) => ({
      id: player.user_id,
      name: player.name,
      status: player.status,
      you: player.is_you,
    })),
    moves: raw.moves.map((move) => ({
      step: move.revision,
      playerId: move.user_id,
      move: move.payload as T,
      at: move.created_at,
    })),
    purchases: raw.purchases.map(readPurchase),
  };
}

export function readPurchase(raw: WirePurchase): Purchase {
  return {
    id: raw.id,
    sessionId: raw.session_id,
    reference: raw.reference,
    item: raw.item,
    amount: raw.amount,
    currency: raw.currency,
    status: raw.status,
    receipt: raw.payment_reference,
  };
}

/** What the app stores when a game reports how it ended. */
export function writeOutcome(outcome: Outcome): { winner_ids: number[]; summary?: string } {
  return {
    winner_ids: outcome.winners,
    ...(outcome.summary != null ? { summary: outcome.summary } : {}),
  };
}
