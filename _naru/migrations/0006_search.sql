-- Search: full-text tables the board search (the skins' 검색) finds posts
-- and comments by, in place of reading every post's
-- title and text. trigram finds any piece of 3 characters or more, Korean
-- too; shorter terms are searched on posts and comments as before. Naru has
-- no triggers, so the mutations that write, edit and delete posts and
-- comments keep these in step, in the same call.

-- A post's title and text, as plain text (an HTML post's without its
-- tags), by the post's id as rowid.
CREATE VIRTUAL TABLE posts_search USING fts5(title, body, tokenize = 'trigram');

-- A comment's text, by the comment's id as rowid.
CREATE VIRTUAL TABLE comments_search USING fts5(body, tokenize = 'trigram');

-- The posts and comments written before this migration. An HTML post's text
-- goes in as it is kept (SQL cannot take its tags out); writing it again
-- keeps its plain text.
INSERT INTO posts_search (rowid, title, body) SELECT id, title, body FROM posts;
INSERT INTO comments_search (rowid, body) SELECT id, body FROM comments;
