// 네오 아보카도의 서버 함수. 나루가 이 파일을 회원의 브라우저가 아니라 서버에서,
// 한 트랜잭션 안에서 돌린다. 함수가 오류를 내면 그동안 쓴 것은 모두 없던 일이
// 된다. 페이지는 member.call("neo-avocado/<함수>", 인자)로 부른다.
//
// 여기서 쓰는 지갑·인벤토리·상점·뽑기 컬렉션은 쓰기가 ‘관리자만’이라 회원이
// 직접 고칠 수 없고, 이 함수들만 바꾼다. 함수가 쓴 문서에는 회원 작성자가
// 붙지 않는다.
const PREFIX = "neo_avocado_";
const WALLETS = `${PREFIX}wallets`;
const INVENTORY = `${PREFIX}inventory`;
const ITEMS = `${PREFIX}items`;
const GACHA = `${PREFIX}gacha`;

/** 출석 보상과 뽑기 한 번의 값. */
export const DAILY_REWARD = 100;
export const GACHA_COST = 50;

const kstDay = (now) =>
  new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);

function wallet(ctx) {
  const found = ctx.get(WALLETS, ctx.member.id);
  return found ? found.data : { balance: 0, lastDaily: null };
}
function pay(ctx, current, amount, changes = {}) {
  ctx.set(WALLETS, ctx.member.id, {
    ...current,
    ...changes,
    balance: current.balance - amount,
  });
  return current.balance - amount;
}
function give(ctx, item, from) {
  return ctx.add(INVENTORY, {
    owner: ctx.member.id,
    item: item.id,
    name: item.data.name,
    from,
  });
}

/** 하루 한 번, 한국 시간으로 날이 바뀌면 받는 출석 보상. */
export function daily(ctx) {
  const current = wallet(ctx);
  const today = kstDay(ctx.now);
  if (current.lastDaily === today) return { ok: false, reason: "already" };
  const balance = pay(ctx, current, -DAILY_REWARD, { lastDaily: today });
  return { ok: true, balance };
}

/** 상점에서 하나 산다. 재고(stock)가 없으면 무제한이다. */
export function buy(ctx, { item } = {}) {
  const listing = typeof item === "string" ? ctx.get(ITEMS, item) : null;
  if (!listing || listing.data.hidden) return { ok: false, reason: "no_item" };
  const { price = 0, stock } = listing.data;
  if (typeof stock === "number" && stock < 1)
    return { ok: false, reason: "sold_out" };
  const current = wallet(ctx);
  if (current.balance < price) return { ok: false, reason: "not_enough" };
  const balance = pay(ctx, current, price);
  if (typeof stock === "number")
    ctx.set(ITEMS, listing.id, { ...listing.data, stock: stock - 1 });
  const owned = give(ctx, listing, "shop");
  return { ok: true, balance, owned };
}

/**
 * 뽑기 한 번. 뽑기 컬렉션의 항목마다 무게(weight)가 있고, 무게에 비례해
 * 하나가 나온다. 주사위는 서버가 굴린다.
 */
export function gacha(ctx) {
  const current = wallet(ctx);
  if (current.balance < GACHA_COST) return { ok: false, reason: "not_enough" };
  const table = ctx
    .list(GACHA, { size: 100 })
    .documents.filter((row) => row.data.weight > 0);
  if (!table.length) return { ok: false, reason: "empty" };
  const total = table.reduce((sum, row) => sum + row.data.weight, 0);
  let roll = ctx.random() * total;
  const won =
    table.find((row) => (roll -= row.data.weight) < 0) ?? table.at(-1);
  const prize = ctx.get(ITEMS, won.data.item);
  if (!prize)
    throw new Error(`뽑기의 아이템 ${won.data.item}이 상점에 없습니다.`);
  const balance = pay(ctx, current, GACHA_COST);
  const owned = give(ctx, prize, "gacha");
  return { ok: true, balance, owned };
}
