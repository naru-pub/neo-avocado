-- HTML 본문 허용 (bo_use_dhtml_editor) and HTML 쓰기 등급 (bo_html_level) are
-- gone: posts are plain text, and one written as HTML before reads as its
-- text. The owner's HTML (안내 pages, 팝업레이어, 상단 내용, 카운터) stays.
UPDATE boards SET options = json_remove(options, '$.html', '$.htmlLevel')
  WHERE json_type(options, '$.html') IS NOT NULL
    OR json_type(options, '$.htmlLevel') IS NOT NULL;
