import { describe, expect, test, vi } from "vitest";
import { connect, installMockHost, XaraGameError, type GameState, type HostWindow } from "../src";

/** A window the app has opened the game in, recording what the page sends. */
function appWindow() {
  const sent: any[] = [];
  const win: HostWindow = { XaraGames: { postMessage: (raw) => sent.push(JSON.parse(raw)) } };
  const boot = () => win.__xaraGamesOnBoot?.({ source: "xara-host", v: 1, key: "k1" });
  const answer = (id: string, result: unknown) =>
    win.__xaraGamesReceive?.({ source: "xara-host", v: 1, id, ok: true, result });
  return { win, sent, boot, answer };
}

const state = (revision: number, status: GameState["session"]["status"] = "active"): GameState => ({
  session: { session_id: 9, status, revision, turn_user_id: 1, created_by: 1, group_id: null, result: null },
  game: { id: 3, name: "Tic-Tac-Toe" },
  viewer: { user_id: 1, role: "player" },
  players: [
    { user_id: 1, name: "You", status: "accepted", is_you: true },
    { user_id: 2, name: "Ada", status: "accepted", is_you: false },
  ],
  moves: [],
  purchases: [],
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("connect", () => {
  test("waits for the app's key, then sends it with every call", async () => {
    const { win, sent, boot, answer } = appWindow();
    const xara = connect({ window: win });
    const ready = xara.ready();
    await tick();
    expect(sent).toHaveLength(0);
    boot();
    await tick();
    expect(sent[0]).toMatchObject({ source: "xara-game", v: 1, key: "k1", type: "ready" });
    answer(sent[0].id, state(0));
    expect((await ready).session.revision).toBe(0);
    expect(xara.isMyTurn()).toBe(true);
  });

  test("moves after the latest revision", async () => {
    const { win, sent, boot, answer } = appWindow();
    const xara = connect<{ cell: number }>({ window: win });
    boot();
    const ready = xara.ready();
    await tick();
    answer(sent[0].id, state(2));
    await ready;
    const moved = xara.move({ cell: 4 }, { result: { winner_ids: [1] } });
    await tick();
    expect(sent[1]).toMatchObject({
      type: "move",
      payload: { move: { cell: 4 }, revision: 2, result: { winner_ids: [1] } },
    });
    answer(sent[1].id, state(3, "completed"));
    expect((await moved).session.status).toBe("completed");
  });

  test("tells listeners about other players' moves, but never goes back", async () => {
    const { win, sent, boot, answer } = appWindow();
    const xara = connect({ window: win });
    const seen = vi.fn();
    xara.onState((next) => seen(next.session.revision));
    boot();
    const ready = xara.ready();
    await tick();
    answer(sent[0].id, state(1));
    await ready;
    win.__xaraGamesReceive?.({ source: "xara-host", v: 1, event: "state", payload: state(3) });
    win.__xaraGamesReceive?.({ source: "xara-host", v: 1, event: "state", payload: state(2) });
    expect(seen.mock.calls.map(([revision]) => revision)).toEqual([1, 3]);
    expect(xara.state?.session.revision).toBe(3);
  });

  test("rejects with the app's reason", async () => {
    const { win, sent, boot } = appWindow();
    const xara = connect({ window: win });
    boot();
    const accepted = xara.accept();
    await tick();
    win.__xaraGamesReceive?.({
      source: "xara-host",
      v: 1,
      id: sent[0].id,
      ok: false,
      error: { code: "rejected", message: "It's not your turn" },
    });
    await expect(accepted).rejects.toEqual(new XaraGameError("rejected", "It's not your turn"));
  });

  test("ignores answers to calls it didn't make, or already settled", async () => {
    const { win, sent, boot, answer } = appWindow();
    const xara = connect({ window: win });
    boot();
    const ready = xara.ready();
    await tick();
    answer("someone-else", state(5));
    answer(sent[0].id, state(1));
    answer(sent[0].id, state(7));
    expect((await ready).session.revision).toBe(1);
    expect(xara.state?.session.revision).toBe(1);
  });

  test("times out when the app never answers, but waits on payments", async () => {
    vi.useFakeTimers();
    const { win, boot } = appWindow();
    const xara = connect({ window: win, timeoutMs: 1000 });
    boot();
    const ready = xara.ready();
    const paying = xara.requestPayment({ item: "Hint", amount: 100, reference: "h1" });
    let paid = false;
    paying.then(() => (paid = true));
    const failed = expect(ready).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(5000);
    await failed;
    expect(paid).toBe(false);
    vi.useRealTimers();
  });

  test("refuses to run outside the app", async () => {
    await expect(connect({ window: {} }).ready()).rejects.toMatchObject({ code: "closed" });
  });
});

describe("installMockHost", () => {
  test("keeps turns and revisions like the app", async () => {
    const win: HostWindow = {};
    installMockHost({ window: win, players: [{ user_id: 1, name: "A" }, { user_id: 2, name: "B" }] });
    const xara = connect<{ cell: number }>({ window: win });
    await xara.ready();
    await xara.move({ cell: 0 });
    expect(xara.state?.session).toMatchObject({ revision: 1, turn_user_id: 2 });
    expect(xara.state?.viewer.user_id).toBe(2);
    await xara.move({ cell: 4 }, { result: { winner_ids: [2], summary: "O wins" } });
    expect(xara.state?.session).toMatchObject({ status: "completed", result: { winner_ids: [2] } });
    await expect(xara.move({ cell: 8 })).rejects.toMatchObject({ code: "rejected" });
  });

  test("starts once the invited player accepts", async () => {
    const win: HostWindow = {};
    installMockHost({ window: win, invited: true });
    const xara = connect({ window: win });
    expect((await xara.ready()).session.status).toBe("invited");
    expect((await xara.accept()).session.status).toBe("active");
  });

  test("charges for a purchase reference once", async () => {
    const win: HostWindow = {};
    const approve = vi.fn(() => true);
    installMockHost({ window: win, approvePayment: approve });
    const xara = connect({ window: win });
    const first = await xara.requestPayment({ item: "Hint", amount: 100, reference: "h1" });
    const again = await xara.requestPayment({ item: "Hint", amount: 100, reference: "h1" });
    expect(first.status).toBe("success");
    expect(again.purchase?.id).toBe(first.purchase?.id);
    expect(approve).toHaveBeenCalledTimes(1);
  });

  test("tells the game when the player cancels a purchase", async () => {
    const win: HostWindow = {};
    installMockHost({ window: win, approvePayment: () => false });
    const xara = connect({ window: win });
    expect((await xara.requestPayment({ item: "Hint", amount: 100, reference: "h2" })).status).toBe("cancelled");
  });
});
