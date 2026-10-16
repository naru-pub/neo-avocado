-- The economy: the shop's items (adm/item_list.php, shop_list.php), what
-- members hold (inventory), crafting recipes (adm/recipi_list.php), the draw
-- tables of the paid gacha and draw tickets, and exploration's (탐색). Money
-- is the foundation's wallets, and everything that moves it, or items, is
-- written to its history.

-- 아이템 (avo_item) with its shop listing (avo_shop) in the same row, by the
-- ID the owner gives it; a personal item a 개인 아이템 제작권 makes
-- (inventory/inc/add_item_form.php) is one too, hidden from the shop.
-- Nothing filters on display (진열 기간: dates, hours, weekdays), effect
-- (사용 효과), requirements (구매 조건, with the items an exchange takes) or
-- use_requirements (사용 조건): each is a JSON object, or NULL for none.
-- stock NULL is no limit, sell_price NULL not for sale back.
CREATE TABLE items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  effect_description TEXT NOT NULL DEFAULT '',
  shop_talk TEXT NOT NULL DEFAULT '',
  image TEXT,
  shop_category TEXT NOT NULL DEFAULT '',
  display TEXT,
  price INTEGER NOT NULL DEFAULT 0 CHECK (typeof(price) = 'integer' AND price >= 0),
  stock INTEGER CHECK (stock IS NULL OR (typeof(stock) = 'integer' AND stock >= 0)),
  sell_price INTEGER CHECK (sell_price IS NULL OR (typeof(sell_price) = 'integer' AND sell_price >= 0)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  sellable INTEGER NOT NULL DEFAULT 1,
  giftable INTEGER NOT NULL DEFAULT 1,
  usable INTEGER NOT NULL DEFAULT 1,
  usable_in_posts INTEGER NOT NULL DEFAULT 0,
  craft_material INTEGER NOT NULL DEFAULT 0,
  reusable INTEGER NOT NULL DEFAULT 0,
  effect TEXT,
  requirements TEXT NOT NULL DEFAULT '{}',
  use_requirements TEXT NOT NULL DEFAULT '{}',
  personal INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX items_hidden ON items (hidden);

-- 인벤토리 (avo_inventory): one row a copy, the member's own or one of
-- their characters'. origin is how it came (shop, gacha, craft, explore,
-- item, personal, admin). gift is a JSON object: a gift's sender,
-- senderName (se_ch_name), memo (in_memo) and receivedAt, or the owner's
-- 지급 사유 as memo.
CREATE TABLE inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  item_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT '',
  character_id INTEGER,
  gift TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX inventory_owner ON inventory (owner);
CREATE INDEX inventory_character ON inventory (character_id);

-- 레시피 (avo_item_recipi): what it makes, and for how much.
CREATE TABLE recipes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  item_id TEXT NOT NULL,
  cost INTEGER NOT NULL DEFAULT 0 CHECK (typeof(cost) = 'integer' AND cost >= 0),
  hidden INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX recipes_hidden ON recipes (hidden);

-- A recipe's materials: so many of an item each.
CREATE TABLE recipe_ingredients (
  id INTEGER PRIMARY KEY,
  recipe_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  count INTEGER NOT NULL CHECK (typeof(count) = 'integer' AND count > 0),
  UNIQUE (recipe_id, item_id)
);
CREATE INDEX recipe_ingredients_item ON recipe_ingredients (item_id);

-- 뽑기 표: a draw ticket's rows (source, the ticket's item) or the paid
-- gacha's (source NULL), each its item (NULL: 꽝) and weight.
CREATE TABLE gacha (
  id TEXT PRIMARY KEY,
  source TEXT,
  item_id TEXT,
  weight REAL NOT NULL DEFAULT 1 CHECK (typeof(weight) IN ('integer', 'real') AND weight >= 0 AND weight <= 1e12)
);
CREATE INDEX gacha_source ON gacha (source);

-- 탐색 표: what exploring finds (item NULL: nothing), by weight.
CREATE TABLE explore (
  id TEXT PRIMARY KEY,
  item_id TEXT,
  weight REAL NOT NULL DEFAULT 1 CHECK (typeof(weight) IN ('integer', 'real') AND weight >= 0 AND weight <= 1e12)
);

-- The rank table's experience, which granting experience to every character
-- at once sums the bonus points of (characters' levels).
CREATE INDEX levels_exp ON levels (exp);
