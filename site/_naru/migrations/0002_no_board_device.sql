-- 접속기기 (bo_device, gr_device) is gone: every board shows on every
-- device, as the pages fit any screen. 팝업레이어 keep theirs (popups.device).
ALTER TABLE board_groups DROP COLUMN device;
UPDATE boards SET options = json_remove(options, '$.device')
  WHERE json_type(options, '$.device') IS NOT NULL;
