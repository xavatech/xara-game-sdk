export type SessionStatus = "invited" | "active" | "completed" | "declined" | "cancelled";

export type PlayerStatus = "invited" | "accepted" | "declined";

/** A player, in turn order: whoever started the game moves first. */
export interface Player {
  user_id: number;
  /** How the player's phone labels them: "You", or a contact name. */
  name: string;
  status: PlayerStatus;
  is_you: boolean;
}

/** How a game ended. No winners is a draw. */
export interface GameResult {
  winner_ids: number[];
  summary: string | null;
  /** Set when a player left a game being played. */
  forfeited_by?: number;
}

export interface Session {
  session_id: number;
  status: SessionStatus;
  /** How many moves have been made. */
  revision: number;
  turn_user_id: number | null;
  created_by: number;
  group_id: number | null;
  result: GameResult | null;
}

/** A move a player made, as your game sent it. */
export interface Move<T = unknown> {
  /** Counts from 1. */
  revision: number;
  user_id: number;
  payload: T;
  created_at: string;
}

export interface Purchase {
  id: number;
  session_id: number;
  /** Your own id for the purchase. */
  reference: string;
  item: string;
  /** Whole naira. */
  amount: number;
  currency: "NGN";
  status: "requested" | "paid";
  payment_reference: string | null;
}

/** Everything a game needs to draw itself, sent on start and after every change. */
export interface GameState<T = unknown> {
  session: Session;
  game: { id: number; name: string };
  /** A spectator is a group member watching; they can't move. */
  viewer: { user_id: number; role: "player" | "spectator" };
  players: Player[];
  /** Every move so far, oldest first. Replay them to rebuild the game. */
  moves: Move<T>[];
  /** The viewer's own purchases in this session. */
  purchases: Purchase[];
}

export interface PaymentRequest {
  /** What the player is buying, shown on the approval sheet. */
  item: string;
  /** Whole naira, paid to your business. */
  amount: number;
  /** Your id for this purchase. Asking again with it never charges twice. */
  reference: string;
}

export interface PaymentResult {
  status: "success" | "cancelled" | "failed";
  message?: string;
  purchase?: Purchase;
}

export type ResultInput = { winner_ids: number[]; summary?: string };
