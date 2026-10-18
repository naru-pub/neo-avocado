-- 링크 연결 수 (wr_link1_hit, wr_link2_hit; bbs/link.php): how many times
-- each of a post's links was followed, apart from the posts live queries
-- read.
CREATE TABLE link_hits (
  post_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (post_id, url)
);
