import type { GameState, Outcome, PurchaseRequest, PurchaseResult } from "./types";
import { readPurchase, readState, writeOutcome, type WireState } from "./wire";

export const PROTOCOL_VERSION = 1;
const CHANNEL = "XaraGames";

/** What a call to the app can fail with. */
export class XaraGameError extends Error {
  constructor(
    /** `rejected` (the app or server refused it), `timeout`, `closed`, or `failed`. */
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "XaraGameError";
  }
}

type HostMessage = {
  source: "xara-host";
  v: number;
  id?: string;
  ok?: boolean;
  result?: unknown;
  error?: { code: string; message: string };
  event?: string;
  payload?: unknown;
  key?: string;
};

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer?: ReturnType<typeof setTimeout> };

/** The parts of `window` the SDK uses, so tests and the mock host can stand in for the app. */
export type HostWindow = {
  XaraGames?: { postMessage(message: string): void };
  __xaraGamesBoot?: HostMessage;
  __xaraGamesOnBoot?: (message: HostMessage) => void;
  __xaraGamesReceive?: (message: HostMessage) => void;
};

export interface ConnectOptions {
  /** Defaults to the page's `window`. */
  window?: HostWindow;
  /** How long a call waits for the app, in milliseconds. Payments wait for the player instead. */
  timeoutMs?: number;
}

/** Whether a page is running inside the Xara app's game screen. */
export function inXara(win: HostWindow = globalThis as unknown as HostWindow): boolean {
  return typeof win[CHANNEL]?.postMessage === "function";
}

/** How far along a state is, so an older answer never replaces a newer state. */
function progress(state: GameState): [number, number, number] {
  const { status, moveCount } = state.session;
  const stage = status === "invited" ? 0 : status === "active" ? 1 : 2;
  const answered = state.players.filter((player) => player.status !== "invited").length;
  return [stage, moveCount, answered];
}

function isWireState(value: unknown): value is WireState {
  return !!value && typeof value === "object" && "session" in value && "viewer" in value;
}

type WirePurchaseShape = Parameters<typeof readPurchase>[0];

function isOlder(next: GameState, current: GameState): boolean {
  const [a, b] = [progress(next), progress(current)];
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

/**
 * A game's connection to the Xara app. The app makes every call to Xara
 * with the player's account and asks for their PIN before anything is paid;
 * the page never sees a token or a PIN.
 */
export class XaraGames<T = unknown> {
  private readonly win: HostWindow;
  private readonly timeoutMs: number;
  private readonly pending = new Map<string, Pending>();
  private readonly listeners = new Set<(state: GameState<T>) => void>();
  private key: Promise<string>;
  private counter = 0;
  private current: GameState<T> | null = null;

  constructor(options: ConnectOptions = {}) {
    this.win = options.window ?? (globalThis as unknown as HostWindow);
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.win.__xaraGamesReceive = (message) => this.receive(message);
    this.key = new Promise((resolve) => {
      const take = (message?: HostMessage) => {
        if (message?.source === "xara-host" && typeof message.key === "string") resolve(message.key);
      };
      take(this.win.__xaraGamesBoot);
      this.win.__xaraGamesOnBoot = take;
    });
  }

  /** The latest state, once [load] has resolved. */
  get state(): GameState<T> | null {
    return this.current;
  }

  /** Loads the game as it stands, including every move so far. */
  async load(): Promise<GameState<T>> {
    return this.call("ready");
  }

  /** Called whenever the game changes: someone moved, accepted, or left. Returns a function that stops listening. */
  onChange(listener: (state: GameState<T>) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** This phone is playing, and it is their turn. */
  isMyTurn(): boolean {
    const state = this.current;
    return (
      !!state &&
      !state.me.watching &&
      state.session.status === "active" &&
      state.session.turn === state.me.id
    );
  }

  /** Accepts this phone's invite. The game starts once everyone has. */
  accept(): Promise<GameState<T>> {
    return this.call("accept");
  }

  /**
   * Plays this phone's move. Pass `outcome` when the move ends the game.
   * Xara checks it is their turn; whether the move is legal is up to your game.
   */
  move(move: T, options: { outcome?: Outcome } = {}): Promise<GameState<T>> {
    return this.call("move", {
      move,
      revision: this.current?.session.moveCount ?? 0,
      ...(options.outcome ? { result: writeOutcome(options.outcome) } : {}),
    });
  }

  /** Ends the game without another move. No winners is a draw. */
  end(outcome: Outcome): Promise<GameState<T>> {
    return this.call("complete", {
      result: writeOutcome(outcome),
      revision: this.current?.session.moveCount ?? 0,
    });
  }

  /**
   * Asks the player to buy `item` for `amount` naira, paid to your business.
   * The app shows its own approval sheet and asks for their PIN.
   */
  async buy(request: PurchaseRequest): Promise<PurchaseResult> {
    const result = await this.call<PurchaseResult & { purchase?: WirePurchaseShape }>("requestPayment", { ...request }, 0);
    return { ...result, purchase: result.purchase ? readPurchase(result.purchase) : undefined };
  }

  /** Closes the game screen. */
  async close(): Promise<void> {
    await this.call("close");
  }

  private async call<R>(type: string, payload: Record<string, unknown> = {}, timeoutMs = this.timeoutMs): Promise<R> {
    const channel = this.win[CHANNEL];
    if (!channel) throw new XaraGameError("closed", "Open this game from a Xara chat");
    const key = await this.key;
    const id = `${Date.now().toString(36)}-${++this.counter}`;
    const answer = new Promise<unknown>((resolve, reject) => {
      const pending: Pending = { resolve, reject };
      if (timeoutMs > 0) {
        pending.timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new XaraGameError("timeout", "The app didn't answer"));
        }, timeoutMs);
      }
      this.pending.set(id, pending);
    });
    channel.postMessage(JSON.stringify({ source: "xara-game", v: PROTOCOL_VERSION, key, id, type, payload }));
    const result = await answer;
    if (type !== "requestPayment" && isWireState(result)) {
      this.update(readState<T>(result));
      return this.current as R;
    }
    return result as R;
  }

  private receive(message: HostMessage) {
    if (!message || message.source !== "xara-host" || message.v !== PROTOCOL_VERSION) return;
    if (message.event === "state" && isWireState(message.payload)) {
      this.update(readState<T>(message.payload));
      return;
    }
    const pending = message.id ? this.pending.get(message.id) : undefined;
    if (!pending) return;
    this.pending.delete(message.id!);
    if (pending.timer) clearTimeout(pending.timer);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new XaraGameError(message.error?.code ?? "failed", message.error?.message ?? "Something went wrong"));
  }

  private update(next: GameState<T>) {
    if (this.current && isOlder(next, this.current)) return;
    this.current = next;
    for (const listener of this.listeners) listener(next);
  }
}

/** Connects to the Xara app's game screen. */
export function connect<T = unknown>(options?: ConnectOptions): XaraGames<T> {
  return new XaraGames<T>(options);
}
