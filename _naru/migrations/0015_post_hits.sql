-- 조회수 (wr_hit, bbs/view.php): how many times a post was opened on its
-- own, once a browser session. A table of its own, so that a view does not
-- write the posts that live queries read.
CREATE TABLE post_hits (
  post_id INTEGER PRIMARY KEY,
  hits INTEGER NOT NULL DEFAULT 0
);
