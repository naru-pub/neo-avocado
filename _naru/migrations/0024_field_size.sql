-- 입력칸 크기 (avo_article.ar_size, mypage/character/character_form.php:283):
-- a one-line field's width, or a textarea's height, in pixels; 0 the page's
-- own.
ALTER TABLE character_fields ADD COLUMN size INTEGER NOT NULL DEFAULT 0;
