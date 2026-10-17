-- A post's 링크 (wr_link1, wr_link2: the mmb skin's Link #1 and #2) and the
-- pictures a plain board's post takes beyond its first (bo_upload_count's
-- files), each a JSON list of addresses; nothing filters on them.
ALTER TABLE posts ADD COLUMN links TEXT NOT NULL DEFAULT '[]';
ALTER TABLE posts ADD COLUMN files TEXT NOT NULL DEFAULT '[]';
