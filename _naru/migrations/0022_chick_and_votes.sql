-- 췩 (bo_use_chick, mmb's wr_ing): a log posted picture first, still being
-- written, until its writer finishes it.
ALTER TABLE posts ADD COLUMN writing INTEGER NOT NULL DEFAULT 0;
-- 추천 and 비추천 (wr_good, wr_nogood; bbs/good.php): one a member a post.
CREATE TABLE post_votes (
  post_id INTEGER NOT NULL,
  member TEXT NOT NULL,
  vote INTEGER NOT NULL CHECK (vote IN (1, -1)),
  PRIMARY KEY (post_id, member)
);
