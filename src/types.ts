export type SessionStatus = "invited" | "active" | "completed" | "declined" | "cancelled";

export type PlayerStatus = "invited" | "accepted" | "declined";

/** A player, in turn order. The person who started the game goes first. */
export interface Player {
  id: number;
  /** "You" on this phone, or the name this phone has for them. */
  name: string;
  status: PlayerStatus;
  /** This phone. */
  you: boolean;
}

/** How a game ended. No winners is a draw. */
export interface Outcome {
  winners: number[];
  /** Shown on the chat card. The same line for every player, so it never says "you". */
  summary?: string | null;
  /** Set when a player left a game that was being played. */
  leftBy?: number;
}

export interface Session {
  id: number;
  status: SessionStatus;
  /** How many moves have been played. The next move follows this one. */
  moveCount: number;
  /** Whose turn it is, while the game is being played. */
  turn: number | null;
  startedBy: number;
  groupId: number | null;
  outcome: Outcome | null;
}

/** A move someone already played, oldest first in the list. */
export interface PlayedMove<T = unknown> {
  /** Counts from 1. */
  step: number;
  playerId: number;
  /** What that player's game sent. */
  move: T;
  at: string;
}

export interface Purchase {
  id: number;
  sessionId: number;
  /** The reference your game sent with `buy`. */
  reference: string;
  item: string;
  /** Whole naira. */
  amount: number;
  currency: "NGN";
  status: "requested" | "paid";
  /** Set once the player has paid. */
  receipt: string | null;
}

/** Everything a game needs to draw itself. */
export interface GameState<T = unknown> {
  session: Session;
  game: { id: number; name: string };
  /** This phone. `watching` is a group member who is not playing. */
  me: { id: number; watching: boolean };
  players: Player[];
  /** Every move so far, oldest first. Replay these to draw the game. */
  moves: PlayedMove<T>[];
  /** What this phone has bought in this game. */
  purchases: Purchase[];
}

export interface PurchaseRequest {
  /** Shown on the approval sheet. */
  item: string;
  /** Whole naira, paid to your business. */
  amount: number;
  /**
   * Your id for this purchase. Asking again with the same reference
   * returns it instead of charging twice.
   */
  reference: string;
}

export interface PurchaseResult {
  status: "success" | "cancelled" | "failed";
  message?: string;
  purchase?: Purchase;
}
