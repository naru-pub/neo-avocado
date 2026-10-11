// 실행: npm test
// 서버 함수를 나루가 부르는 그대로 부른다: ctx 하나와 인자. ctx는 메모리에
// 있는 가짜이고, 나루에서처럼 함수가 쓴 문서에는 작성자가 붙지 않는다.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buy,
  daily,
  gacha,
  DAILY_REWARD,
  GACHA_COST,
} from "../_naru/functions/neo-avocado.js";

const P = "neo_avocado_";
function fakeCtx({ now = Date.parse("2030-01-01T03:00:00Z"), roll = 0 } = {}) {
  const store = new Map();
  let added = 0;
  const table = (name) => {
    if (!store.has(name)) store.set(name, new Map());
    return store.get(name);
  };
  const ctx = {
    member: { id: "m-1" },
    now,
    random: () => roll,
    get: (name, id) => {
      const data = table(name).get(id);
      return data === undefined ? null : { id, data, createdBy: null };
    },
    list: (name) => ({
      documents: [...table(name)].map(([id, data]) => ({ id, data })),
      nextCursor: null,
    }),
    set: (name, id, data) => {
      table(name).set(id, structuredClone(data));
      return { id, data, createdBy: null };
    },
    add: (name, data) => ctx.set(name, `added-${added++}`, data),
  };
  return { ctx, table };
}

test("the daily reward is once per day in Korea", () => {
  const { ctx, table } = fakeCtx();
  assert.deepEqual(daily(ctx), { ok: true, balance: DAILY_REWARD });
  assert.deepEqual(daily(ctx), { ok: false, reason: "already" });
  // 2030-01-01 15:00 UTC is already 2 January in Korea.
  ctx.now = Date.parse("2030-01-01T15:00:00Z");
  assert.deepEqual(daily(ctx), { ok: true, balance: 2 * DAILY_REWARD });
  assert.equal(table(`${P}wallets`).get("m-1").lastDaily, "2030-01-02");
});

test("buying checks the item, its stock and the balance before taking anything", () => {
  const { ctx, table } = fakeCtx();
  table(`${P}items`).set("sword", { name: "검", price: 80, stock: 1 });
  table(`${P}items`).set("potion", { name: "물약", price: 10 });
  table(`${P}items`).set("secret", { name: "비밀", price: 1, hidden: true });
  assert.deepEqual(buy(ctx, { item: "sword" }), {
    ok: false,
    reason: "not_enough",
  });
  assert.equal(table(`${P}wallets`).size, 0);
  daily(ctx);
  const bought = buy(ctx, { item: "sword" });
  assert.equal(bought.ok, true);
  assert.equal(bought.balance, DAILY_REWARD - 80);
  assert.deepEqual(bought.owned.data, {
    owner: "m-1",
    item: "sword",
    name: "검",
    from: "shop",
  });
  assert.equal(table(`${P}items`).get("sword").stock, 0);
  assert.deepEqual(buy(ctx, { item: "sword" }), {
    ok: false,
    reason: "sold_out",
  });
  // No stock is no limit.
  assert.equal(buy(ctx, { item: "potion" }).ok, true);
  assert.equal(table(`${P}items`).get("potion").stock, undefined);
  for (const item of ["secret", "missing", undefined, 7])
    assert.deepEqual(buy(ctx, { item }), { ok: false, reason: "no_item" });
});

test("gacha picks by weight with the server's roll, and costs what it says", () => {
  const prize = (roll) => {
    const { ctx, table } = fakeCtx({ roll });
    table(`${P}wallets`).set("m-1", { balance: GACHA_COST });
    table(`${P}items`).set("common", { name: "흔한 씨앗" });
    table(`${P}items`).set("rare", { name: "황금 아보카도" });
    table(`${P}gacha`).set("g1", { item: "common", weight: 9 });
    table(`${P}gacha`).set("g2", { item: "rare", weight: 1 });
    table(`${P}gacha`).set("g3", { item: "rare", weight: 0 });
    const result = gacha(ctx);
    assert.equal(result.balance, 0);
    assert.equal(table(`${P}inventory`).size, 1);
    return result.owned.data.name;
  };
  assert.equal(prize(0), "흔한 씨앗");
  assert.equal(prize(0.89), "흔한 씨앗");
  assert.equal(prize(0.9), "황금 아보카도");
  assert.equal(prize(0.999), "황금 아보카도");
  const { ctx, table } = fakeCtx();
  assert.deepEqual(gacha(ctx), { ok: false, reason: "not_enough" });
  table(`${P}wallets`).set("m-1", { balance: GACHA_COST });
  assert.deepEqual(gacha(ctx), { ok: false, reason: "empty" });
  // A table naming an item the shop does not have is the owner's mistake,
  // and fails the call, which Naru then rolls back.
  table(`${P}gacha`).set("g", { item: "gone", weight: 1 });
  assert.throws(() => gacha(ctx), /gone/);
});
