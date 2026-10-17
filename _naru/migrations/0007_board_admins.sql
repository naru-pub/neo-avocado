-- 게시판 관리자 and 그룹 관리자 (g5_board.bo_admin, g5_group.gr_admin): one
-- member each, who moderates that board, or every board of the group, as
-- the staff do everywhere (lib/common.lib.php's is_admin: 'board', 'group').
ALTER TABLE boards ADD COLUMN admin TEXT;
ALTER TABLE board_groups ADD COLUMN admin TEXT;
