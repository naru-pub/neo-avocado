// 게시판관리 (adm/admin.menu300.php): boards and their groups, content pages, quests and emoticons.
import { plainHttps, type Model } from "./shared.js";

export const boardsModels: Record<string, Model> = {
  boards: {
    label: "게시판",
    help: "등급은 회원 관리에서 설정합니다. 목록/본문/작성/댓글 권한을 따로 정합니다. 등급 1은 로그인하지 않은 손님입니다: 목록·본문을 1로 두면 누구나 읽고, 글쓰기·댓글을 1로 두면 손님이 이름과 비밀번호로 씁니다.",
    fields: [
      { key: "name", label: "게시판 이름", required: true, max: 120 },
      // bo_content_head: shown above the list as (sanitized) HTML.
      {
        key: "description",
        label: "설명 (목록 위에 HTML로 표시)",
        type: "textarea",
        max: 2000,
      },
      {
        key: "kind",
        label: "글 형식",
        type: "choice",
        options: [
          ["image", "그림 로그"],
          ["text", "일반 글"],
          ["qna", "질문 답변 (손님 비밀 질문, 운영진 답변)"],
          ["settlement", "정산 (분류 필수, 운영진이 경험치·아보 지급)"],
        ],
      },
      { key: "enabled", label: "운영 중", type: "checkbox", default: true },
      // bo_order: the boards' order in lists and pickers.
      {
        key: "order",
        label: "출력 순서 (작은 숫자가 먼저)",
        type: "number",
        default: 0,
      },
      {
        key: "group",
        label: "게시판 그룹",
        type: "pick",
        from: "groups",
        optional: true,
      },
      // bo_admin: a member who moderates this board as the staff do.
      {
        key: "admin",
        label: "게시판 관리자 (이 게시판의 글·댓글을 운영진처럼 관리)",
        type: "profile",
        optional: true,
      },
      { key: "listLevel", label: "목록 보기 등급", type: "number", default: 2 },
      { key: "readLevel", label: "본문 읽기 등급", type: "number", default: 2 },
      { key: "writeLevel", label: "글쓰기 등급", type: "number", default: 2 },
      { key: "commentLevel", label: "댓글 등급", type: "number", default: 2 },
      // bo_link_level, bo_upload_level and bo_download_level.
      {
        key: "linkLevel",
        label: "링크 등급 (링크를 달 수 있는 등급)",
        type: "number",
        default: 1,
      },
      {
        key: "uploadLevel",
        label: "업로드 등급 (그림·첨부파일을 올릴 수 있는 등급)",
        type: "number",
        default: 1,
      },
      {
        key: "downloadLevel",
        label: "다운로드 등급 (첨부파일을 받을 수 있는 등급)",
        type: "number",
        default: 1,
      },
      // bo_reply_level and bo_reply_order: 답변글 on a plain board.
      {
        key: "replyLevel",
        label: "글답변 등급 (일반 글 게시판)",
        type: "number",
        default: 2,
      },
      {
        key: "replyOrder",
        label: "답변 달기",
        type: "choice",
        default: "1",
        options: [
          ["1", "나중에 쓴 답변 아래로 달기 (기본)"],
          ["0", "나중에 쓴 답변 위로 달기"],
        ],
      },
      { key: "categories", label: "분류 (쉼표로 구분)", type: "tokens" },
      {
        key: "actions",
        label: "행동 허용 (글: 탐색·조합·아이템 사용, 댓글: 탐색·아이템 사용)",
        type: "checkbox",
      },
      // bo_use_rss_view (bbs/rss.php): /rss/<게시판ID>, for boards visitors read.
      {
        key: "rss",
        label:
          "RSS 보이기 사용 (손님이 목록·본문을 읽는 게시판만, 주소 /rss/게시판ID)",
        type: "checkbox",
      },
      // bo_use_search: 최근게시물 and 전체검색 take the board's posts.
      {
        key: "useSearch",
        label: "전체 검색 사용 (최근게시물과 전체검색에 이 게시판의 글을 보임)",
        type: "checkbox",
        default: true,
      },
      // bo_use_noname: members may post and comment as 익명.
      { key: "anonymous", label: "익명 사용", type: "checkbox" },
      // bo_gallery_height: an image log at least this tall folds (로그접기).
      {
        key: "foldHeight",
        label: "로그 자동 접기 높이 (px, 0이면 직접 접은 로그만)",
        type: "number",
        default: 600,
      },
      // bo_page_rows (cf_page_rows 15, install_db.php:157).
      {
        key: "pageRows",
        label: "한 페이지 글 수",
        type: "number",
        default: 15,
      },
      // bo_sort_field (board_form.php:697); 조회수 and 추천수 have no counts here.
      {
        key: "sortField",
        label: "리스트 정렬 필드 (공지 다음)",
        type: "choice",
        options: [
          ["", "기본 (최근 글부터)"],
          ["datetime asc", "날짜 이전것 부터"],
          ["datetime desc", "날짜 최근것 부터"],
          ["last asc", "최근글 이전것 부터 (글·댓글 시각)"],
          ["last desc", "최근글 최근것 부터 (글·댓글 시각)"],
          ["comment asc", "댓글수 낮은것 부터"],
          ["comment desc", "댓글수 높은것 부터"],
          ["hit asc", "조회수 낮은것 부터"],
          ["hit desc", "조회수 높은것 부터"],
          ["good asc", "추천수 낮은것 부터"],
          ["good desc", "추천수 높은것 부터"],
          ["nogood asc", "비추천수 낮은것 부터"],
          ["nogood desc", "비추천수 높은것 부터"],
          ["subject asc", "제목 오름차순"],
          ["subject desc", "제목 내림차순"],
          ["name asc", "글쓴이 오름차순"],
          ["name desc", "글쓴이 내림차순"],
          ["category asc", "분류명 오름차순"],
          ["category desc", "분류명 내림차순"],
        ],
      },
      // bo_new: hours a new post shows its N mark (board_form.php:668).
      {
        key: "newHours",
        label: "새글 아이콘 (글을 쓴 뒤 N을 표시할 시간, 0이면 표시 안 함)",
        type: "number",
        default: 24,
      },
      // bo_subject_len, bo_hot: a list's titles cut to so many characters,
      // and 인기글 marked from so many views.
      {
        key: "subjectLen",
        label: "제목 길이 (목록에서 이만큼 넘으면 줄임, 0이면 줄이지 않음)",
        type: "number",
        default: 60,
      },
      {
        key: "hot",
        label: "인기글 (조회수가 이만큼 되면 아이콘 표시, 0이면 표시 안 함)",
        type: "number",
        default: 100,
      },
      // bo_use_list_content: a plain board's list with its posts' text.
      {
        key: "listContent",
        label:
          "목록에서 내용 사용 (일반 글 게시판, 끄면 목록에 제목만 보이고 본문 보기로 읽음)",
        type: "checkbox",
        default: true,
        newDefault: false,
      },
      // bo_use_good, bo_use_nogood (bbs/good.php): members' votes on others'
      // posts, once each.
      { key: "useGood", label: "추천 사용", type: "checkbox" },
      { key: "useNogood", label: "비추천 사용", type: "checkbox" },
      // bo_use_chick (mmb): a picture posted first holds its place while its
      // writer writes it.
      {
        key: "chick",
        label:
          "췩 사용 (그림 로그 게시판: 그림을 먼저 올려 자리를 잡고, 글은 이어서 씀)",
        type: "checkbox",
      },
      // bo_use_list_view (bbs/board.php:234): a post opened on its own has
      // the list under it, or only 윗글·아래글. Off as the original makes a
      // board; a board saved before keeps its list.
      {
        key: "listView",
        label:
          "전체목록보이기 사용 (일반 글 게시판, 글을 따로 열 때 아래에 목록도 보임)",
        type: "checkbox",
        default: true,
        newDefault: false,
      },
      // bo_upload_count and bo_image_width: a plain board's pictures.
      {
        key: "uploadCount",
        label:
          "파일 업로드 개수 (일반 글 게시판 한 글의 그림 수, 0이면 그림 없음)",
        type: "number",
        default: 1,
      },
      // bo_upload_size, bo_use_file_content, bo_use_list_file.
      {
        key: "uploadSize",
        label:
          "파일 업로드 용량 (MB, 파일 하나의 최대 크기, 0이면 나루 미디어의 한도)",
        type: "number",
        default: 0,
      },
      {
        key: "fileContent",
        label: "파일 설명 사용 (일반 글 게시판의 첨부파일마다 설명을 받음)",
        type: "checkbox",
      },
      {
        key: "listFile",
        label: "리스트에서 파일 사용 (끄면 첨부파일은 글을 따로 열 때만 보임)",
        type: "checkbox",
        default: true,
        newDefault: false,
      },
      {
        key: "imageWidth",
        label: "이미지 폭 크기 (px, 일반 글 게시판에서 보이는 그림의 최대 폭)",
        type: "number",
        default: 600,
      },
      // bo_count_modify (board_form.php:89).
      {
        key: "editLock",
        label: "다른 회원 댓글이 이만큼 달리면 수정 금지 (0이면 제한 없음)",
        type: "number",
        default: 1,
      },
      // bo_write_point, bo_comment_point: paid in the community's money.
      {
        key: "readReward",
        // bo_read_point: paid, or taken when negative, on opening a post
        // alone, once a post; a member short of a charge cannot open it.
        label:
          "글읽기 포인트 (글을 따로 열 때 한 번, 음수면 차감, 모자라면 읽을 수 없음)",
        type: "signed",
        default: 0,
      },
      // bo_download_point: paid, or taken when negative, on a member's first
      // download of a file.
      {
        key: "downloadPoint",
        label: "다운로드 포인트 (파일마다 처음 받을 때 한 번, 음수면 차감)",
        type: "signed",
        default: 0,
      },
      {
        key: "writeReward",
        label: "글쓰기 보상 (화폐, 글을 지우면 회수)",
        type: "number",
        default: 0,
      },
      {
        key: "commentReward",
        label: "댓글쓰기 보상 (화폐, 댓글을 지우면 회수)",
        type: "number",
        default: 0,
      },
      // bo_insert_content, bo_write_min/max, bo_comment_min/max.
      {
        key: "insertContent",
        label: "새 글 기본 내용",
        type: "textarea",
        max: 2000,
      },
      {
        key: "writeMin",
        label: "글 최소 글자 수 (0이면 제한 없음, HTML 게시판·운영진 제외)",
        type: "number",
        default: 0,
      },
      {
        key: "writeMax",
        label: "글 최대 글자 수 (0이면 제한 없음)",
        type: "number",
        default: 0,
      },
      {
        key: "commentMin",
        label: "댓글 최소 글자 수 (0이면 제한 없음, 운영진 제외)",
        type: "number",
        default: 0,
      },
      {
        key: "commentMax",
        label: "댓글 최대 글자 수 (0이면 제한 없음)",
        type: "number",
        default: 0,
      },
      {
        key: "secret",
        label: "비밀글",
        type: "choice",
        options: [
          ["off", "허용하지 않음"],
          ["optional", "선택"],
          ["required", "모든 글 비밀글"],
        ],
      },
      // 게시판 여분필드 설정 (bo_1_subj…bo_10): free fields the owner keeps
      // for a board, as the original's skins and add-ons read them.
      { type: "group", label: "여분필드" },
      ...Array.from({ length: 10 }, (_, i) => [
        {
          key: `extra${i + 1}Subject`,
          label: `여분필드 ${i + 1} 제목`,
          max: 255,
        },
        { key: `extra${i + 1}`, label: `여분필드 ${i + 1} 값`, max: 255 },
      ]).flat(),
    ],
    check(data) {
      if (
        ["listLevel", "readLevel", "writeLevel", "commentLevel"].some(
          (key) => data[key] < 1 || data[key] > 10,
        ) ||
        ["replyLevel", "linkLevel", "uploadLevel", "downloadLevel"].some(
          (key) => data[key] !== undefined && (data[key] < 1 || data[key] > 10),
        )
      )
        throw new Error("게시판 등급은 1~10입니다.");
      if (data.subjectLen > 255)
        throw new Error("제목 길이는 255자 이하입니다.");
      if (
        data.categories.length > 20 ||
        data.categories.some((name) => name.length > 40)
      )
        throw new Error("분류는 20개 이하, 각 40자 이하입니다.");
      if (data.pageRows < 1 || data.pageRows > 100)
        throw new Error("한 페이지 글 수는 1~100입니다.");
      if (data.uploadCount > 10)
        throw new Error("파일 업로드 개수는 0~10입니다.");
      if (data.imageWidth > 2000)
        throw new Error("이미지 폭 크기는 2000px 이하입니다.");
      if (data.newHours > 8760)
        throw new Error("새글 아이콘 시간은 8760시간(1년) 이하입니다.");
      if (
        (data.writeMax && data.writeMin > data.writeMax) ||
        (data.commentMax && data.commentMin > data.commentMax)
      )
        throw new Error("최소 글자 수는 최대 글자 수보다 클 수 없습니다.");
    },
  },
  board_groups: {
    label: "게시판 그룹",
    help: "게시판을 묶어 게시판 고르기에서 함께 보여 줍니다. ‘그룹 회원만’을 켜면 그 그룹의 게시판은 회원 등급의 그룹 회원과 게시물 운영자(그룹 관리자 포함)만 이용합니다.",
    fields: [
      { key: "name", label: "그룹 이름", required: true, max: 60 },
      // gr_admin: a member who moderates every board of the group.
      {
        key: "admin",
        label: "그룹 관리자 (그룹의 모든 게시판을 운영진처럼 관리)",
        type: "profile",
        optional: true,
      },
      { key: "membersOnly", label: "그룹 회원만", type: "checkbox" },
      { key: "order", label: "정렬 순서", type: "number", default: 0 },
    ],
  },
  content: {
    label: "내용 페이지",
    help: "안내·소개 페이지를 만듭니다. 모바일 본문이 비어 있으면 기본 본문을 표시합니다. 읽기 등급은 회원 등급 기준이고, 1이면 손님도 읽습니다. ID를 site_main으로 만들면 메인 화면을 대신하며, 본문의 {{VISUAL_SLIDE}}는 메인 슬라이드, {{OUTLOGIN}}은 회원 카드, {{LOGIN}}·{{JOIN}}은 손님에게 보이는 로그인 링크, {{LOGOUT}}·{{MYPAGE}}는 회원에게 보이는 로그아웃·마이페이지 링크가 됩니다. {{BGM}}과 {{TWITTER}}는 지워집니다(배경음악은 상단의 재생 버튼으로 듣습니다).",
    fields: [
      { key: "name", label: "제목", required: true, max: 120 },
      { key: "enabled", label: "공개 중", type: "checkbox", default: true },
      {
        key: "readLevel",
        label: "읽기 등급 (1~10, 1: 손님도 읽음)",
        type: "number",
        // The original's content pages have no read level (bbs/content.php):
        // everyone reads them, site_main included (main.php).
        default: 1,
      },
      {
        key: "format",
        label: "본문 형식",
        type: "choice",
        options: [
          ["html", "HTML"],
          ["text", "일반 텍스트"],
        ],
      },
      {
        key: "body",
        label: "본문",
        type: "textarea",
        required: true,
        max: 12000,
      },
      {
        key: "mobileBody",
        label: "모바일 본문 (빈칸: 기본 본문)",
        type: "textarea",
        max: 12000,
      },
      {
        key: "headerImage",
        label: "상단 이미지",
        type: "url",
        image: true,
        max: 2000,
      },
      {
        key: "footerImage",
        label: "하단 이미지",
        type: "url",
        image: true,
        max: 2000,
      },
    ],
    check(data) {
      if (data.readLevel < 1 || data.readLevel > 10)
        throw new Error("읽기 등급은 1~10입니다.");
    },
  },
  quests: {
    label: "퀘스트",
    help: "일일·주간 구분, 세력, 게시 기간과 여러 이미지를 설정합니다. 시간은 한국 시간입니다. 빈 시작/종료 시간은 제한 없음입니다.",
    fields: [
      { key: "name", label: "퀘스트 이름", required: true, max: 120 },
      {
        key: "type",
        label: "종류",
        type: "choice",
        options: [
          ["daily", "일일"],
          ["weekly", "주간"],
        ],
      },
      // quest_form.php's 수행가능: one of the 소속 list, or everyone's.
      {
        key: "side",
        label: "수행 가능 소속 (비우면 공통)",
        type: "pick",
        from: "sides",
        valueBy: "name",
        optional: true,
        fallbackText: true,
        max: 40,
      },
      {
        key: "startsAt",
        label: "시작 (한국 시간)",
        type: "datetime-local",
        max: 19,
      },
      {
        key: "endsAt",
        label: "종료 (한국 시간)",
        type: "datetime-local",
        max: 19,
      },
      {
        key: "images",
        label: "이미지 (주소를 한 줄에 하나, 올린 파일은 끝에 추가)",
        type: "textarea",
        images: true,
        max: 20000,
      },
    ],
    check(data) {
      const date = (value) => {
        if (!value) return null;
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value))
          throw new Error("기간을 확인하세요.");
        const stamp = Date.parse(`${value}+09:00`);
        if (
          !Number.isFinite(stamp) ||
          new Date(stamp + 9 * 3600000).toISOString().slice(0, value.length) !==
            value
        )
          throw new Error("기간을 확인하세요.");
        return stamp;
      };
      const start = date(data.startsAt),
        end = date(data.endsAt);
      if (start !== null && end !== null && start >= end)
        throw new Error("종료는 시작보다 늦어야 합니다.");
      data.images = data.images
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean);
      if (
        data.images.length > 20 ||
        data.images.some((value) => !plainHttps(value))
      )
        throw new Error(
          "인증 정보 없는 HTTPS 이미지 주소를 최대 20개 입력하세요.",
        );
    },
  },
  emoticons: {
    label: "이모티콘",
    help: "댓글에서 입력한 명령어를 그림으로 표시합니다. 예: :웃음:. 이미지는 파일로 올리거나 HTTPS 주소로 입력합니다.",
    fields: [
      { key: "name", label: "명령어", required: true, max: 40 },
      {
        key: "image",
        label: "이미지",
        type: "url",
        image: true,
        required: true,
        max: 2000,
      },
    ],
  },
};
