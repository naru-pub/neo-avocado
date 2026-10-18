-- 최대값 기준 출력 (avo_status_config.st_use_max): a stat shown against its
-- 최대값 rather than the character's own maximum.
ALTER TABLE stats ADD COLUMN use_max INTEGER NOT NULL DEFAULT 0;
-- 아이템 기능 (avo_item.it_type): one of 커뮤니티 설정's 아이템 기능 names
-- (cf_item_category), for the owner's lists.
ALTER TABLE items ADD COLUMN item_type TEXT NOT NULL DEFAULT '';
-- 접속기기 (g5_group.gr_device): where a group's boards show: both, pc or
-- mobile.
ALTER TABLE board_groups ADD COLUMN device TEXT NOT NULL DEFAULT 'both';
