-- 상점 진열 (avo_shop, adm/shop_form.php): further sales of an item beside
-- the one its own form sets, each with its category, NPC talk, dates and
-- hours, price, stock, order and conditions, so an item may be sold in more
-- than one category, or on other terms for a time.
CREATE TABLE shop_entries (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  shop_category TEXT NOT NULL DEFAULT '',
  shop_talk TEXT NOT NULL DEFAULT '',
  display TEXT,
  price INTEGER NOT NULL DEFAULT 0 CHECK (typeof(price) = 'integer' AND price >= 0),
  stock INTEGER CHECK (stock IS NULL OR (typeof(stock) = 'integer' AND stock >= 0)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  requirements TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX shop_entries_item ON shop_entries (item_id);
