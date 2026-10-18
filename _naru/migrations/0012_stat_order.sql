-- 스탯 순서 (avo_status_config.st_order, adm/status_list.php): the order a
-- character's stats are shown and allocated in, lowest first.
ALTER TABLE stats ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
