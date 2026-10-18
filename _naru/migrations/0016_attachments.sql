-- 첨부파일 (g5_board_file, skin/board/basic/write.skin.php's bf_file): a
-- plain board's post keeps the files it takes beside its pictures, each
-- {url, name, size, type}, as a JSON list; and how many times each was
-- downloaded (bf_download, bbs/download.php), apart from the posts that
-- live queries read.
ALTER TABLE posts ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]';
CREATE TABLE attachment_downloads (
  post_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  downloads INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (post_id, url)
);
