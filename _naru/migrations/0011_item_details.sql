-- 아이템 분류 (avo_item.it_category: 일반, 개인, 출석) and 상세이미지 (it_1).
-- A personal item a 개인 아이템 제작권 made is 개인, as
-- inventory/item_form_update.php files it.
ALTER TABLE items ADD COLUMN category TEXT NOT NULL DEFAULT 'general';
ALTER TABLE items ADD COLUMN detail_image TEXT;
UPDATE items SET category = 'personal' WHERE personal = 1;
CREATE INDEX items_category ON items (category);
