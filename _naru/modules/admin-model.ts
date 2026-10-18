import {
  BACKGROUNDS,
  BOXES,
  BUTTONS,
  PANELS,
  TEXTS,
  colorOf,
} from "./design.js";
// The admin's sections (admin/): each one's form, and `buildRecord`, which
// checks what a form sends and makes the record its table keeps. The page
// draws its forms from these; the owner's mutations in admin/ check every
// save with them (modules/admin.ts), so a form's rules hold on the server.
/** One field of a section's form. */
export interface ModelField {
  // Headings (type "heading") have no key.
  key?: string;
  label: string;
  type?: string;
  default?: unknown;
  /** A new record's value, where a saved one without the key means `default`. */
  newDefault?: unknown;
  max?: number;
  optional?: boolean;
  required?: boolean;
  options?: any[];
  image?: boolean;
  from?: string;
  valueBy?: string;
  transient?: boolean;
  maxCount?: number;
  fallbackText?: boolean;
  multiple?: boolean;
  images?: boolean;
  consumes?: boolean;
}
/** One admin section: its form and how its records are kept. */
export interface Model {
  label: string;
  help?: string;
  // Reports have none.
  fields?: ModelField[];
  fixedId?: string;
  readOnly?: boolean;
  /** Rows that only come with something else: nothing to register here. */
  noCreate?: boolean;
  noDelete?: boolean;
  memberKey?: boolean;
  characterKey?: boolean;
  holdings?: boolean;
  report?: string;
  review?: boolean;
}
export const models: Record<string, Model> = {
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
  },
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
      { key: "categories", label: "분류 (쉼표로 구분)", type: "tokens" },
      {
        key: "html",
        label: "HTML 본문 허용 (최대 12,000자, 표시할 때 정리)",
        type: "checkbox",
      },
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
      // bo_use_list_content: a plain board's list with its posts' text.
      {
        key: "listContent",
        label:
          "목록에서 내용 사용 (일반 글 게시판, 끄면 목록에 제목만 보이고 본문 보기로 읽음)",
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
    ],
  },
  members: {
    label: "회원 등급·운영 역할",
    help: "가입 승인과 로그인 차단은 나루 데이터베이스의 사이트 회원 관리에서 변경합니다. 여기서는 회원 번호별 게시판 등급과 운영 역할, 커뮤니티의 접근차단일을 정합니다. 목록은 최근 접속 순으로 등급·역할·경고·탈퇴일·차단일·최종 접속을 보여 주고, 닉네임이나 회원 번호로 찾습니다. 회원 삭제는 원본처럼 닉네임은 남기고 그 회원의 쪽지·관심로그·화폐 내역·잔액·운영 역할·게시판 관리자 지정을 지웁니다(글·댓글·캐릭터는 남음). 나루 계정은 사이트가 지울 수 없으니, 로그인까지 막으려면 나루에서 차단하세요.",
    fields: [
      { key: "level", label: "회원 등급 (1~10)", type: "number", default: 2 },
      {
        key: "role",
        label: "커뮤니티 역할",
        type: "choice",
        options: [
          ["member", "회원"],
          ["moderator", "게시물 운영자"],
        ],
      },
      {
        key: "groups",
        label: "그룹 회원 (그룹 회원만 쓰는 게시판 그룹, 여러 개 선택 가능)",
        type: "pick",
        from: "groups",
        multiple: true,
      },
      // mb_adult: sees 19금 posts without the cover (list.log.skin.php:133).
      {
        key: "adult",
        label: "성인 (19금 로그를 가리지 않음)",
        type: "checkbox",
      },
      { key: "warnings", label: "누적 경고", type: "number", default: 0 },
      { key: "warningNote", label: "경고 내용", type: "textarea", max: 1000 },
      {
        key: "left",
        label: "탈퇴일 (빈칸: 이용 중. 지우면 다시 이용할 수 있습니다)",
        type: "date",
      },
      // mb_intercept_date: from that day the member is a guest here.
      {
        key: "blocked",
        label:
          "접근차단일 (그날부터 손님처럼만 이용, 빈칸: 차단 안 함. 로그인까지 막으려면 나루에서 차단)",
        type: "date",
      },
      { key: "note", label: "운영 메모", max: 500 },
    ],
  },
  wallets: {
    label: "회원 잔액",
    memberKey: true,
    noDelete: true,
    help: "잔액을 변경하면 같은 트랜잭션에서 회원의 기록에 조정 사유를 남깁니다. 잔액 기록은 삭제하지 않습니다.",
    fields: [
      { key: "balance", label: "잔액", type: "number", default: 0 },
      {
        key: "lastDaily",
        label: "최근 로그인 보상일 (빈칸: 초기화)",
        type: "date",
      },
      {
        key: "note",
        label: "잔액 조정 사유",
        required: true,
        max: 500,
        transient: true,
      },
    ],
  },
  inventory: {
    label: "아이템 지급·보유 현황",
    help: "회원과 캐릭터를 선택해 아이템을 지급하거나 보유 정보를 고칩니다. 이름은 아이템 정의에서 가져옵니다.",
    fields: [
      { key: "owner", label: "회원", type: "profile", required: true },
      {
        key: "character",
        label: "캐릭터 (빈칸: 회원 인벤토리)",
        type: "character",
        optional: true,
      },
      { key: "item", label: "아이템", type: "item", required: true },
      { key: "memo", label: "지급 사유", max: 500 },
    ],
  },
  history: {
    label: "전체 활동·구매 기록",
    help: "회원별 경제 활동 기록입니다. 화폐·경험치·구매기록으로 거르고 회원·캐릭터·아이템·내용으로 찾습니다. 화폐나 경험치를 바꾼 기록을 삭제하면 원본처럼 그만큼 되돌리고, 그 뒤 기록의 누계도 고칩니다.",
    readOnly: true,
    fields: [],
  },
  items: {
    label: "아이템·상점",
    help: "상점 가격·재고와 사용 효과, 구매 조건을 설정합니다. 빈 재고는 무제한입니다. 개인 제작 아이템도 여기에서 관리합니다.",
    fields: [
      { key: "name", label: "이름", required: true, max: 80 },
      // it_category (adm/item_form.php:81): what the item list files it under.
      {
        key: "category",
        label: "아이템 분류",
        type: "choice",
        options: [
          ["general", "일반 아이템"],
          ["personal", "개인 아이템"],
          ["attendance", "출석 아이템"],
        ],
      },
      { key: "description", label: "설명", type: "textarea", max: 2000 },
      // it_content2: what it does, under the description in the item's detail.
      {
        key: "effectDescription",
        label: "효과 설명",
        type: "textarea",
        max: 1000,
      },
      // sh_content: what the shop's NPC says of it when picked.
      { key: "shopTalk", label: "상점 NPC 대사", type: "textarea", max: 500 },
      { key: "image", label: "이미지", type: "url", image: true, max: 2000 },
      // it_1: a larger picture for the item's detail.
      {
        key: "detailImage",
        label: "상세이미지 (상점·인벤토리의 아이템 상세에 보임)",
        type: "url",
        image: true,
        max: 2000,
      },
      {
        key: "shopCategory",
        label: "상점 분류 (기본 설정의 분류 중 하나, 빈칸: 첫 분류)",
        max: 40,
      },
      {
        key: "display.from",
        label: "진열 시작일 (빈칸: 제한 없음)",
        type: "date",
      },
      {
        key: "display.until",
        label: "진열 종료일 (빈칸: 제한 없음)",
        type: "date",
      },
      {
        key: "display.fromHour",
        label: "진열 시작 시각 (0~23시, 한국 시간, 빈칸: 제한 없음)",
        type: "optional-number",
      },
      {
        key: "display.untilHour",
        label: "진열 종료 시각 (0~23시, 그 시각까지 포함)",
        type: "optional-number",
      },
      {
        key: "display.weekdays",
        label: "진열 요일 (일, 월, 화… 쉼표로 구분, 빈칸: 매일)",
        type: "tokens",
      },
      { key: "price", label: "구매 가격", type: "number", default: 0 },
      { key: "stock", label: "재고 (빈칸: 무제한)", type: "optional-number" },
      {
        key: "sellPrice",
        label: "판매 보상 (빈칸: 판매 불가)",
        type: "optional-number",
      },
      // sh_order (adm/shop_form.php): lower first in the shop.
      {
        key: "order",
        label: "진열 순서 (작은 수가 먼저)",
        type: "number",
        default: 0,
      },
      // A new item starts hidden, so it is not on sale at 0 until priced.
      {
        key: "hidden",
        label: "상점에서 숨기기",
        type: "checkbox",
        newDefault: true,
      },
      { key: "sellable", label: "판매 허용", type: "checkbox", default: true },
      { key: "giftable", label: "선물 허용", type: "checkbox", default: true },
      { key: "usable", label: "사용 허용", type: "checkbox", default: true },
      // it_use_mmb_able, it_use_recepi: both start off (adm/item_form.php:217).
      {
        key: "usableInPosts",
        label: "로그·댓글에서 사용 가능",
        type: "checkbox",
      },
      {
        key: "craftMaterial",
        label: "조합 재료로 사용 가능",
        type: "checkbox",
      },
      { key: "reusable", label: "사용 후 남기기", type: "checkbox" },
      {
        key: "effect.type",
        label: "사용 효과",
        type: "choice",
        options: [
          ["", "사용 효과 없음"],
          ["restore", "능력치 회복"],
          ["draw", "뽑기권"],
          ["create", "개인 아이템 제작권"],
          ["profile", "프로필 수정권"],
        ],
      },
      {
        key: "effect.stat",
        label: "회복할 능력치",
        type: "stat",
        optional: true,
      },
      { key: "effect.amount", label: "회복량", type: "optional-number" },
      {
        key: "requirements.approved",
        label: "승인 캐릭터만 구매",
        type: "checkbox",
      },
      {
        key: "requirements.sides",
        label: "구매 가능 세력 (쉼표로 구분, 빈칸: 모두)",
        type: "tokens",
      },
      {
        key: "requirements.classes",
        label: "구매 가능 종족 (쉼표로 구분, 빈칸: 모두)",
        type: "tokens",
      },
      {
        key: "requirements.exp",
        label: "구매에 필요한 경험치",
        type: "number",
        default: 0,
      },
      {
        key: "requirements.consumeExp",
        label: "구매 시 경험치 소모",
        type: "checkbox",
      },
      {
        key: "requirements.title",
        label: "구매에 필요한 타이틀",
        type: "title",
        optional: true,
      },
      {
        key: "requirements.consumeTitle",
        label: "구매 시 타이틀 소모",
        type: "checkbox",
      },
      {
        key: "requirements.limit",
        label: "구매 한도 (빈칸: 무제한)",
        type: "optional-number",
      },
      {
        key: "requirements.consumeMoney",
        label: "구매 시 돈 소모",
        type: "checkbox",
        default: true,
      },
      {
        key: "requirements.items",
        label: "구매에 필요한 교환 아이템",
        type: "ingredients",
        maxCount: 18,
        consumes: true,
      },
      {
        key: "useRequirements.approved",
        label: "승인 캐릭터만 사용",
        type: "checkbox",
      },
      {
        key: "useRequirements.sides",
        label: "사용 가능 세력 (쉼표로 구분)",
        type: "tokens",
      },
      {
        key: "useRequirements.classes",
        label: "사용 가능 종족 (쉼표로 구분)",
        type: "tokens",
      },
      {
        key: "useRequirements.exp",
        label: "사용에 필요한 경험치",
        type: "number",
        default: 0,
      },
      {
        key: "useRequirements.title",
        label: "사용에 필요한 타이틀",
        type: "title",
        optional: true,
      },
    ],
  },
  gacha: {
    label: "뽑기 표",
    help: "같은 뽑기권의 항목끼리 무게에 비례해 뽑습니다. 뽑기권을 고르지 않으면 일반 유료 뽑기입니다. 결과 아이템을 고르지 않으면 꽝입니다.",
    fields: [
      {
        key: "source",
        label: "뽑기권 아이템 (빈칸: 일반 뽑기)",
        type: "item",
        optional: true,
      },
      {
        key: "item",
        label: "결과 아이템 (빈칸: 꽝)",
        type: "item",
        optional: true,
      },
      {
        key: "weight",
        label: "무게 (0: 나오지 않음)",
        type: "decimal",
        default: 1,
      },
    ],
  },
  recipes: {
    label: "제작 레시피",
    help: "결과와 필요한 재료를 선택합니다. 한 제작에 재료를 최대 20개 소모합니다.",
    fields: [
      { key: "name", label: "레시피 이름", required: true, max: 80 },
      { key: "description", label: "설명", type: "textarea", max: 2000 },
      { key: "item", label: "결과 아이템", type: "item", required: true },
      { key: "cost", label: "제작 비용", type: "number", default: 0 },
      { key: "hidden", label: "숨기기", type: "checkbox" },
      {
        key: "ingredients",
        label: "필요 재료",
        type: "ingredients",
        maxCount: 20,
      },
    ],
  },
  sides: {
    label: "소속",
    help: "캐릭터가 고를 소속입니다. 목록이 비어 있으면 회원이 자유롭게 적습니다. 이름을 바꾸면 이미 고른 캐릭터의 소속은 그대로이니 함께 확인하세요.",
    fields: [
      { key: "name", label: "소속 이름", required: true, max: 40 },
      { key: "image", label: "이미지", type: "url", image: true, max: 2000 },
      // si_auth, cl_auth: members below this level do not see it to pick.
      {
        key: "level",
        label: "선택 가능 회원 등급 (1~10, 기본 1)",
        type: "number",
        default: 1,
      },
      { key: "order", label: "정렬 순서", type: "number", default: 0 },
    ],
  },
  classes: {
    label: "종족",
    help: "캐릭터가 고를 종족입니다. 목록이 비어 있으면 회원이 자유롭게 적습니다.",
    fields: [
      { key: "name", label: "종족 이름", required: true, max: 40 },
      { key: "image", label: "이미지", type: "url", image: true, max: 2000 },
      // si_auth, cl_auth: members below this level do not see it to pick.
      {
        key: "level",
        label: "선택 가능 회원 등급 (1~10, 기본 1)",
        type: "number",
        default: 1,
      },
      { key: "order", label: "정렬 순서", type: "number", default: 0 },
    ],
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
  couples: {
    label: "커플",
    help: "양쪽 캐릭터와 시작일을 등록합니다.",
    fields: [
      {
        key: "first",
        label: "첫 번째 캐릭터",
        type: "character",
        required: true,
      },
      {
        key: "second",
        label: "두 번째 캐릭터",
        type: "character",
        required: true,
      },
      { key: "since", label: "시작일", type: "date" },
      { key: "order", label: "정렬 순서", type: "number", default: 0 },
    ],
  },
  titles: {
    label: "타이틀",
    help: "타이틀을 만든 뒤 캐릭터 관리에서 지급합니다.",
    fields: [
      { key: "name", label: "타이틀 이름", required: true, max: 80 },
      // ti_use: a title out of use is shown nowhere (extend/title.lib.php:7).
      { key: "enabled", label: "사용", type: "checkbox", default: true },
      { key: "image", label: "이미지", type: "url", image: true, max: 2000 },
      { key: "description", label: "설명", type: "textarea", max: 2000 },
    ],
  },
  character_fields: {
    label: "캐릭터 프로필 항목",
    help: "캐릭터 프로필에 추가할 항목입니다. ID(고유코드)는 영문 소문자로 시작하는 영문 소문자·숫자·밑줄입니다. 공개 범위: 전체 공개, 오너+운영자, 운영자만(회원은 보거나 입력할 수 없고 신청 심사에서 입력). 최대 50개, 한 캐릭터의 추가 항목은 합쳐서 6,000자까지입니다.",
    fields: [
      { key: "label", label: "항목명", required: true, max: 40 },
      {
        key: "type",
        label: "항목 타입",
        type: "choice",
        options: [
          ["text", "한 줄 텍스트"],
          ["textarea", "텍스트"],
          ["select", "단일 선택"],
          ["url", "링크 (HTTPS)"],
          ["image", "이미지 (파일 또는 HTTPS 주소)"],
        ],
      },
      {
        key: "options",
        label: "선택지 (단일 선택, 쉼표로 구분)",
        type: "tokens",
      },
      { key: "help", label: "도움말", max: 200 },
      // ar_text: a unit shown after a one-line value (character_form.php:331).
      {
        key: "suffix",
        label: "단위 (한 줄 텍스트 뒤에 붙음, 예: cm)",
        max: 20,
      },
      {
        key: "order",
        label: "순서 (작을수록 먼저)",
        type: "number",
        default: 0,
      },
      {
        key: "visibility",
        label: "공개 범위",
        type: "choice",
        options: [
          ["public", "전체 공개"],
          ["owner", "오너+운영자 공개"],
          ["admin", "운영자만"],
        ],
      },
      { key: "required", label: "신청할 때 필수", type: "checkbox" },
    ],
  },
  explore: {
    label: "탐색 표",
    help: "승인된 캐릭터가 댓글에서 탐색하면 무게에 비례해 하나를 뽑아 캐릭터 인벤토리에 넣습니다. 결과 아이템을 고르지 않으면 꽝입니다. 하루 횟수는 기본 설정에서 정합니다.",
    fields: [
      {
        key: "item",
        label: "결과 아이템 (빈칸: 꽝)",
        type: "item",
        optional: true,
      },
      {
        key: "weight",
        label: "무게 (0: 나오지 않음)",
        type: "decimal",
        default: 1,
      },
    ],
  },
  character_state: {
    label: "캐릭터 경험치·능력치·타이틀",
    // A character's record is its row's: it comes and goes with the
    // character, so it is neither registered nor deleted here.
    noCreate: true,
    noDelete: true,
    help: "소속·종족은 캐릭터 시트의 것 하나뿐이며 상점과 아이템 조건도 그것을 봅니다(‘캐릭터 신청 심사’의 수정에서 고칩니다). 포인트는 기본 능력치 외에 배분할 총 포인트입니다. 승인은 ‘캐릭터 신청 심사’의 신청 상태입니다.",
    characterKey: true,
    fields: [
      { key: "exp", label: "경험치", type: "number", default: 0 },
      {
        key: "expNote",
        label:
          "경험치 변경 사유 (경험치를 바꿀 때, 회원의 경험치 내역에 남습니다)",
        max: 500,
        transient: true,
      },
      { key: "points", label: "총 배분 포인트", type: "number", default: 0 },
      {
        key: "titles",
        label: "보유 타이틀 (여러 개 선택 가능)",
        type: "titles",
      },
    ],
  },
  stat_config: {
    label: "능력치 정의",
    help: "ID는 hp처럼 소문자로 시작하는 영문·숫자·밑줄입니다. 최대 20종을 지원합니다. 이미 쓰는 정의를 바꾸면 캐릭터 배분값도 확인하세요.",
    fields: [
      { key: "name", label: "능력치 이름", required: true, max: 40 },
      { key: "initial", label: "기본값", type: "number", default: 0 },
      { key: "max", label: "최대값", type: "number", default: 999 },
      // st_min, st_help (adm/status_list.php).
      { key: "min", label: "최소값", type: "number", default: 0 },
      { key: "help", label: "도움말 (배분할 때 보임)", max: 200 },
      // st_order: the order stats are shown in, lowest first.
      { key: "order", label: "순서 (작은 수부터)", type: "number", default: 0 },
    ],
  },
  levels: {
    // adm/level_list.php, named by cf_rank_name.
    label: "랭킹 설정",
    help: "캐릭터의 경험치가 기준 이상인 가장 높은 단계를 표시합니다. 단계에 오르면 그 단계의 추가 능력치 포인트를 받고, 경험치가 줄어 내려가면 돌려놓습니다.",
    fields: [
      { key: "name", label: "이름", required: true, max: 40 },
      { key: "exp", label: "필요 경험치", type: "number", default: 0 },
      // lv_add_state: reaching it adds stat points; falling below takes them back.
      {
        key: "bonusPoints",
        label: "달성 시 추가 능력치 포인트",
        type: "number",
        default: 0,
      },
    ],
  },
  // adm/character_article_list.php's 기본 항목: the 두상, 흉상 and 전신 a
  // character sheet asks for, each an upload or an address.
  character_images: {
    label: "프로필 기본 항목",
    help: "캐릭터 신청서의 두상·흉상·전신 이미지와, 캐릭터 보기에 보일 항목을 정합니다. 두상은 목록과 프로필, 흉상과 전신은 캐릭터 보기에 보입니다. 원본의 프로필 양식 관리 기본 항목과 같습니다.",
    fixedId: "profile",
    fields: [
      { type: "heading", label: "두상" },
      {
        key: "thumbUse",
        label: "사용",
        type: "checkbox",
        default: true,
      },
      {
        key: "thumbUrl",
        label: "외부 이미지 경로로 등록 (끄면 파일을 올립니다)",
        type: "checkbox",
      },
      { key: "thumbLabel", label: "항목 이름", default: "두상", max: 20 },
      { key: "thumbHelp", label: "도움말", max: 200 },
      { type: "heading", label: "흉상" },
      {
        key: "headUse",
        label: "사용",
        type: "checkbox",
        default: false,
      },
      {
        key: "headUrl",
        label: "외부 이미지 경로로 등록 (끄면 파일을 올립니다)",
        type: "checkbox",
      },
      { key: "headLabel", label: "항목 이름", default: "흉상", max: 20 },
      { key: "headHelp", label: "도움말", max: 200 },
      { type: "heading", label: "전신" },
      {
        key: "bodyUse",
        label: "사용",
        type: "checkbox",
        default: false,
      },
      {
        key: "bodyUrl",
        label: "외부 이미지 경로로 등록 (끄면 파일을 올립니다)",
        type: "checkbox",
      },
      { key: "bodyLabel", label: "항목 이름", default: "전신", max: 20 },
      { key: "bodyHelp", label: "도움말", max: 200 },
      // ad_use_exp, ad_use_rank, ad_use_status, ad_use_title, ad_use_closet.
      { type: "heading", label: "캐릭터 보기" },
      {
        key: "showExp",
        label: "경험치 보이기",
        type: "checkbox",
        default: true,
      },
      {
        key: "showRank",
        label: "랭킹 보이기",
        type: "checkbox",
        default: true,
      },
      {
        key: "showStats",
        label: "능력치 보이기",
        type: "checkbox",
        default: true,
      },
      {
        key: "showTitles",
        label: "타이틀 보이기",
        type: "checkbox",
        default: true,
      },
      {
        key: "showCloset",
        label: "옷장 보이기",
        type: "checkbox",
        default: true,
      },
    ],
  },
  // adm/community_form.php (커뮤니티 설정): one page, in its sections.
  settings: {
    label: "커뮤니티 설정",
    help: "커뮤니티 전체에 적용되는 설정입니다: 공개 여부, 가입할 때 동의받을 규칙과 쓸 수 없는 닉네임, 캐릭터 생성·수정, 탐색, 로그인·가입 보상, 쪽지, 상점, 캐릭터 보기와 화폐·경험치·소속·종족의 이름. 원본의 커뮤니티 설정과 같습니다.",
    fixedId: "community",
    fields: [
      { type: "heading", label: "홈페이지 기본환경 설정" },
      // cf_open (adm/community_form.php:45): off, visitors see only the
      // sign-in screen. The original installs it off; here it starts on.
      {
        key: "siteOpen",
        label: "사이트공개",
        type: "checkbox",
        default: true,
      },
      {
        key: "bgm",
        label: "배경음악 (유튜브 재생목록·영상 주소, 빈칸: 끄기)",
        max: 300,
      },
      // 관리자 아이콘 (admin_icon_file, adm/config_form.php:100): shown on the
      // site owner's comments in place of the 관리자 mark.
      {
        key: "adminIcon",
        label:
          "관리자 아이콘 (운영자의 댓글에 보이는 그림, 빈칸: '관리자' 글자)",
        type: "url",
        image: true,
        max: 2000,
      },
      // adm/config_form.php's 회원가입 설정: what a new member agrees to
      // (cf_stipulation, cf_privacy) and the nicknames no one may take
      // (cf_prohibit_id, the original's list until changed).
      { type: "heading", label: "회원가입 설정" },
      {
        key: "stipulation",
        label:
          "커뮤니티 활동 규칙 (가입할 때 동의를 받습니다, 빈칸: 묻지 않음)",
        type: "textarea",
        max: 20000,
      },
      {
        key: "characterNotice",
        label: "캐릭터 유의사항 (가입할 때 동의를 받습니다, 빈칸: 묻지 않음)",
        type: "textarea",
        max: 20000,
      },
      {
        key: "reservedNicks",
        label: "사용할 수 없는 닉네임 (쉼표로 구분)",
        type: "textarea",
        default:
          "admin,administrator,관리자,운영자,어드민,주인장,webmaster,웹마스터,sysop,시삽,시샵,manager,매니저,메니저,root,루트,su,guest,방문객",
        max: 2000,
      },
      // cf_register_level 회원가입시 권한 (adm/config_form.php:349, installed
      // at 2): the level a member starts at (register_form_update.php:219).
      {
        key: "registerLevel",
        label: "회원가입시 권한 (새 회원의 등급)",
        type: "choice",
        default: "2",
        options: Array.from({ length: 9 }, (_, i) => [
          String(i + 1),
          String(i + 1),
        ]),
      },
      // cf_use_recommend and cf_recommend_point (adm/config_form.php:360,
      // a hidden field there, installed at 0).
      {
        key: "useRecommend",
        label: "추천인제도 사용 (가입할 때 추천인 닉네임을 받음)",
        type: "checkbox",
      },
      {
        key: "recommendReward",
        label:
          "추천인 포인트 (가입한 회원을 추천한 회원이 받는 화폐, 그 회원을 삭제하면 회수)",
        type: "number",
        default: 0,
      },
      { type: "heading", label: "기능 설정" },
      {
        key: "characterCreation",
        label: "캐릭터 생성 가능",
        type: "checkbox",
        default: true,
      },
      {
        key: "characterEditing",
        label: "캐릭터 수정 가능",
        type: "checkbox",
        default: true,
      },
      {
        key: "characterLimit",
        label: "회원당 캐릭터 수 (0이면 제한 없음)",
        type: "number",
        default: 1,
      },
      // cf_5 조합(레시피)사용: a post's 조합 (write.skin.php:208). The
      // original installs it off; a site saved before it keeps 조합 on.
      {
        key: "recipes",
        label: "조합(레시피) 사용 (글에서 조합 행동을 쓸 수 있음)",
        type: "checkbox",
        default: true,
        newDefault: false,
      },
      {
        key: "exploreLimit",
        label: "캐릭터별 하루 탐색 횟수 (0: 탐색 끄기, 한국 시간 기준)",
        type: "number",
        default: 0,
      },
      {
        key: "initialStatPoints",
        label: "새 캐릭터 배분 포인트",
        type: "number",
        default: 0,
      },
      // 화폐 (adm/config_form.php:137, 353): cf_login_point and
      // cf_register_point, both installed at 0 (install/install_db.php).
      { type: "heading", label: "화폐" },
      {
        key: "loginReward",
        label: "로그인 시 획득 (1일 1회, 한국 시간 기준)",
        type: "number",
        default: 0,
      },
      {
        key: "signupReward",
        label: "회원가입 시 획득",
        type: "number",
        default: 0,
      },
      // adm/config_form.php's 게시판 기본 설정: cf_delay_sec, cf_page_rows,
      // cf_write_pages, cf_mobile_pages, cf_link_target. A first save
      // writes the original's 30 seconds; a site saved before keeps none.
      { type: "heading", label: "게시판 기본 설정" },
      {
        key: "writeDelay",
        label:
          "글쓰기 간격 (초, 글·댓글을 쓴 뒤 이만큼 지나야 다시 씀, 0이면 제한 없음, 운영진 제외)",
        type: "number",
        default: 0,
        newDefault: 30,
      },
      {
        key: "pageRows",
        label:
          "한페이지당 라인수 (새 게시판의 한 페이지 글 수, 관심로그·화폐·경험치 내역 한 번에 읽는 수, 최대 20)",
        type: "number",
        default: 15,
      },
      // cf_new_rows: 최근게시물 (bbs/new.php) a page.
      {
        key: "newRows",
        label: "최근게시물 라인수 (최근게시물 한 페이지의 글·댓글 수, 최대 50)",
        type: "number",
        default: 15,
      },
      // cf_new_del 최근게시물 삭제 (installed at 30): bbs/db_table.optimize.php
      // deletes older entries; here 최근게시물 leaves them out, and the
      // posts stay. A site saved before shows them all.
      {
        key: "newDays",
        label:
          "최근게시물 기간 (일, 이보다 지난 글·댓글은 최근게시물에 보이지 않음, 0이면 모두)",
        type: "number",
        default: 0,
        newDefault: 30,
      },
      {
        key: "writePages",
        label: "페이지 표시 수 (번호로 넘기는 목록의 페이지 링크 수)",
        type: "number",
        default: 10,
      },
      {
        key: "mobilePages",
        label: "모바일 페이지 표시 수",
        type: "number",
        default: 5,
      },
      {
        key: "linkTarget",
        label:
          "새창 링크 (글·댓글 속 주소를 여는 곳, 그림 로그는 원본처럼 늘 새 창)",
        type: "choice",
        options: [
          ["_blank", "_blank"],
          ["_self", "_self"],
          ["_top", "_top"],
          ["_new", "_new"],
        ],
      },
      // cf_filter (adm/config_form.php:315), checked on posts and comments.
      {
        key: "bannedWords",
        label: "단어 필터링 (쉼표로 구분, 제목·본문·댓글에 쓸 수 없음)",
        type: "textarea",
        max: 5000,
      },
      { type: "heading", label: "쪽지" },
      {
        key: "messageCost",
        label: "쪽지 발송 비용 (회원 한 명당)",
        type: "number",
        default: 0,
      },
      {
        key: "messageDailyLimit",
        label: "회원 한 명이 하루에 보낼 수 있는 쪽지 (0이면 제한 없음)",
        type: "number",
        default: 100,
      },
      // ajax/load_memo_call.php's memo_call.MP3, left commented out there.
      {
        key: "alarmSound",
        label:
          "쪽지·호출 알림음 (새 쪽지·호출 창이 뜰 때 짧은 소리. 회원이 화면을 누른 뒤부터 나며, 회원은 알림 창에서 끌 수 있음)",
        type: "checkbox",
      },
      { type: "heading", label: "상점" },
      {
        key: "shopCategories",
        label: "상점 분류 (쉼표로 구분, 첫 분류가 기본)",
        default: "일반, 이벤트",
        max: 200,
      },
      {
        key: "shopNpc",
        label: "상점 NPC 이미지",
        type: "url",
        image: true,
        max: 2000,
      },
      {
        key: "shopGreeting",
        label: "상점 NPC 인사말",
        type: "textarea",
        max: 500,
      },
      { type: "heading", label: "캐릭터 보기" },
      {
        key: "viewerInventory",
        label: "캐릭터 보기에 인벤토리 보이기",
        type: "checkbox",
      },
      {
        key: "viewerMoney",
        label: "캐릭터 보기에 오너의 소지금 보이기",
        type: "checkbox",
      },
      // 기타 항목명 설정 (cf_money, cf_money_pice, cf_exp_name, cf_exp_pice,
      // cf_rank_name, cf_side_title, cf_class_title).
      { type: "heading", label: "기타 항목명 설정" },
      { key: "moneyName", label: "화폐 명칭", default: "아보", max: 20 },
      { key: "moneyUnit", label: "화폐 단위", default: "아보", max: 20 },
      { key: "expName", label: "경험치 명칭", default: "경험치", max: 20 },
      {
        key: "expUnit",
        label: "경험치 단위 (빈칸 가능, 예: exp)",
        default: "",
        max: 20,
      },
      { key: "rankName", label: "랭킹 명칭", default: "랭킹", max: 20 },
      {
        key: "sideTitle",
        label: "선택A 명칭 (기본 소속, 빈칸: 프로필에 표시하지 않음)",
        default: "소속",
        max: 20,
      },
      {
        key: "classTitle",
        label: "선택B 명칭 (기본 종족, 빈칸: 프로필에 표시하지 않음)",
        default: "종족",
        max: 20,
      },
    ],
  },
};
const schedule = [
  {
    key: "startsAt",
    label: "시작 (한국 시간, 빈칸: 제한 없음)",
    type: "datetime-local",
    max: 19,
  },
  {
    key: "endsAt",
    label: "종료 (한국 시간, 빈칸: 제한 없음)",
    type: "datetime-local",
    max: 19,
  },
];
/** design_form.php's 배경반복, 배경위치, 배경크기 and 고정, blank first. */
const REPEAT_CHOICES = [
  ["", "반복"],
  ["no-repeat", "반복없음"],
  ["repeat-x", "가로반복"],
  ["repeat-y", "세로반복"],
];
const POSITION_CHOICES = [
  ["", "왼쪽 상단"],
  ["left center", "왼쪽 중단"],
  ["left bottom", "왼쪽 하단"],
  ["center top", "중간 상단"],
  ["center center", "중간 중단"],
  ["center bottom", "중간 하단"],
  ["right top", "오른쪽 상단"],
  ["right center", "오른쪽 중단"],
  ["right bottom", "오른쪽 하단"],
];
const SIZE_CHOICES = [
  ["", "원본크기"],
  ["contain", "맞춤"],
  ["cover", "꽉참"],
  ["100% 100%", "늘이기"],
];
const color = (key: string, label: string): ModelField => ({
  key,
  label,
  type: "css-color",
  max: 40,
});
const px = (key: string, label: string): ModelField => ({
  key,
  label: `${label} (px)`,
  type: "optional-number",
});
/** A background's fields (cs_value, cs_etc_1–5): 이미지, 색상코드, 반복, 위치, 크기, 고정. */
function backgroundFields(name: keyof typeof BACKGROUNDS): ModelField[] {
  const { label, image, fixed } = BACKGROUNDS[name];
  const key = `styles.${name}`;
  return [
    { type: "group", label },
    ...(image
      ? [
          {
            key: `${key}.image`,
            label: "이미지",
            type: "url",
            image: true,
            max: 2000,
          },
        ]
      : []),
    color(`${key}.color`, "색상코드"),
    {
      key: `${key}.repeat`,
      label: "배경반복",
      type: "choice",
      options: REPEAT_CHOICES,
    },
    {
      key: `${key}.position`,
      label: "배경위치",
      type: "choice",
      options: POSITION_CHOICES,
    },
    {
      key: `${key}.size`,
      label: "배경크기",
      type: "choice",
      options: SIZE_CHOICES,
    },
    ...(fixed
      ? [
          {
            key: `${key}.fixed`,
            label: "고정",
            type: "choice",
            options: [
              ["", "스크롤"],
              ["fixed", "고정"],
            ],
          },
        ]
      : []),
  ];
}
/** A box's fields: 배경색상, 폰트색상, 라인색상·타입·굵기와 상·하·좌·우. */
function boxFields(name: keyof typeof BOXES): ModelField[] {
  const box = BOXES[name];
  const key = `styles.${name}`;
  return [
    { type: "group", label: box.label },
    color(`${key}.background`, "배경색상"),
    color(`${key}.color`, "폰트색상"),
    ...("hover" in box ? [color(`${key}.hover`, "오버색상")] : []),
    ...("margin" in box ? [px(`${key}.margin`, "하단여백")] : []),
    color(`${key}.borderColor`, "라인색상"),
    {
      key: `${key}.borderStyle`,
      label: "라인타입",
      type: "choice",
      options: [
        ["", "라인없음"],
        ["solid", "실선"],
        ["dotted", "점선"],
        ["dashed", "대쉬선"],
        ["double", "이중선"],
      ],
    },
    px(`${key}.borderWidth`, "라인굵기"),
    {
      key: `${key}.borderSides`,
      label: "라인 방향 (여럿 선택)",
      type: "choice",
      multiple: true,
      options: [
        ["top", "상"],
        ["bottom", "하"],
        ["left", "좌"],
        ["right", "우"],
      ],
    },
  ];
}
function buttonFields(name: keyof typeof BUTTONS): ModelField[] {
  const key = `styles.${name}`;
  return [
    { type: "group", label: BUTTONS[name] },
    color(`${key}.color`, "텍스트색상"),
    color(`${key}.background`, "배경색상"),
    color(`${key}.borderColor`, "라인색상"),
    color(`${key}.hoverColor`, "마우스 오버 텍스트색상"),
    color(`${key}.hoverBackground`, "마우스 오버 배경색상"),
    color(`${key}.hoverBorderColor`, "마우스 오버 라인색상"),
  ];
}
function panelFields(name: keyof typeof PANELS): ModelField[] {
  const key = `styles.${name}`;
  return [
    { type: "group", label: PANELS[name] },
    color(`${key}.background`, "배경색상"),
    color(`${key}.color`, "폰트색상"),
    color(`${key}.borderColor`, "라인색상"),
    px(`${key}.topLeft`, "좌측상단 둥글기"),
    px(`${key}.topRight`, "우측상단 둥글기"),
    px(`${key}.bottomRight`, "우측하단 둥글기"),
    px(`${key}.bottomLeft`, "좌측하단 둥글기"),
  ];
}
function textFields(name: keyof typeof TEXTS): ModelField[] {
  const { label, size } = TEXTS[name];
  const key = `styles.${name}`;
  return [
    { type: "group", label },
    color(`${key}.color`, "색상코드"),
    ...(size ? [px(`${key}.size`, "폰트크기")] : []),
  ];
}
models.design = {
  label: "디자인",
  help: "원본의 디자인 설정처럼 화면·메뉴·버튼·테이블·로드비·기타 디자인을 정합니다. 디자인 사용을 끄면 원본처럼 꾸미지 않은 기본 화면이고, 켜면 아래 설정이 적용됩니다(빈칸은 기본 디자인 그대로). 색상코드는 #000000, #000, rgba(0, 0, 0, .5), transparent 꼴로 적습니다. 이미지는 파일로 올리거나 HTTPS 주소로 입력합니다. 회원과 손님 모두에게 적용됩니다.",
  fixedId: "site",
  fields: [
    { key: "enabled", label: "디자인 사용", type: "checkbox" },
    { type: "heading", label: "화면 디자인 설정" },
    // use_header: off, the page is its content alone (no logo, menu or footer).
    {
      key: "useHeader",
      label: "헤더 사용 (끄면 로고·메뉴·하단 없이 내용만 보입니다)",
      type: "checkbox",
      default: true,
    },
    { key: "title", label: "사이트 이름", max: 60 },
    // cf_site_descript, cf_site_img, cf_favicon (head.sub.php). Link
    // previews (_naru/routes/) use the name, description and image, and
    // the site's address for their links.
    { key: "description", label: "사이트 설명 (링크 미리보기)", max: 300 },
    {
      key: "shareImage",
      label: "대표 이미지 (링크 미리보기, 빈칸: 로고 이미지)",
      type: "url",
      image: true,
      max: 2000,
    },
    {
      key: "address",
      label:
        "사이트 주소 (링크 미리보기의 주소, 예: https://neo-avocado.naru.pub)",
      type: "url",
      max: 200,
    },
    {
      key: "favicon",
      label: "파비콘 (브라우저 탭 아이콘)",
      type: "url",
      image: true,
      max: 2000,
    },
    { key: "logo", label: "로고 이미지", type: "url", image: true, max: 2000 },
    // adm/design_form.php's m_logo and m_background, and the background's
    // 색상코드, 배경반복 and 배경위치.
    {
      key: "mobileLogo",
      label: "모바일 로고 이미지 (빈칸: 로고 이미지)",
      type: "url",
      image: true,
      max: 2000,
    },
    {
      key: "background",
      label: "배경 이미지",
      type: "url",
      image: true,
      max: 2000,
    },
    {
      key: "mobileBackground",
      label: "모바일 배경 이미지 (빈칸: 배경 이미지)",
      type: "url",
      image: true,
      max: 2000,
    },
    {
      key: "backgroundColor",
      label: "배경 색상코드 (#000000 꼴, 빈칸: 바탕색)",
      max: 7,
    },
    {
      key: "backgroundRepeat",
      label: "배경 반복",
      type: "choice",
      options: [
        ["repeat", "반복"],
        ["no-repeat", "반복없음"],
        ["repeat-x", "가로반복"],
        ["repeat-y", "세로반복"],
      ],
    },
    {
      key: "backgroundPosition",
      label: "배경 위치",
      type: "choice",
      options: [
        ["left top", "왼쪽 상단"],
        ["left center", "왼쪽 중단"],
        ["left bottom", "왼쪽 하단"],
        ["center top", "중간 상단"],
        ["center center", "중간 중단"],
        ["center bottom", "중간 하단"],
        ["right top", "오른쪽 상단"],
        ["right center", "오른쪽 중단"],
        ["right bottom", "오른쪽 하단"],
      ],
    },
    {
      key: "backgroundSize",
      label: "배경 크기",
      type: "choice",
      options: SIZE_CHOICES,
    },
    ...backgroundFields("mobileBackground"),
    { type: "group", label: "헤더배경" },
    {
      key: "headerBackground",
      label: "이미지",
      type: "url",
      image: true,
      max: 2000,
    },
    ...backgroundFields("header").slice(1),
    ...backgroundFields("mobileHeader"),
    // menu_pos, menu_width, menu_height, menu_background, menu_text.
    { type: "heading", label: "메뉴 디자인 설정" },
    {
      key: "menuPosition",
      label: "메뉴 위치",
      type: "choice",
      options: [
        ["left", "좌측"],
        ["top", "상단"],
      ],
    },
    {
      key: "menuWidth",
      label: "가로 사이즈 (px, 메뉴 위치 좌측일 때)",
      type: "number",
      default: 200,
    },
    {
      key: "menuHeight",
      label: "세로 사이즈 (px, 메뉴 위치 상단일 때)",
      type: "number",
      default: 50,
    },
    ...backgroundFields("menu"),
    ...backgroundFields("mobileMenu"),
    { type: "group", label: "폰트색상" },
    color("styles.menuText.color", "폰트색상"),
    px("styles.menuText.size", "폰트크기"),
    color("styles.menuText.hoverColor", "마우스 오버 폰트색상"),
    px("styles.menuText.hoverSize", "마우스 오버 폰트크기"),
    { type: "heading", label: "버튼 디자인 설정" },
    ...buttonFields("button"),
    ...buttonFields("pointButton"),
    ...buttonFields("etcButton"),
    { type: "heading", label: "테이블(게시판) 디자인 설정" },
    ...boxFields("table"),
    ...boxFields("listHeader"),
    ...boxFields("listBody"),
    ...boxFields("formHeader"),
    ...boxFields("formBody"),
    // The mmb skin's parts (로드비 디자인).
    { type: "heading", label: "로드비 디자인 설정" },
    ...backgroundFields("board"),
    ...boxFields("notice"),
    // mmb_counter: shown above a picture board's logs, sanitized as posts are.
    {
      key: "counter",
      label:
        "접속자 카운터 (HTML. 이미지·링크만 보이고 스크립트·스타일은 표시하지 않습니다)",
      type: "textarea",
      max: 2000,
    },
    ...boxFields("logList"),
    ...boxFields("logItem"),
    ...boxFields("logImage"),
    ...boxFields("comments"),
    ...boxFields("comment"),
    ...textFields("author"),
    ...textFields("ownerName"),
    // Shown with 디자인 사용 off too, as the original's skin reads them.
    {
      key: "styles.ownerName.prefix",
      label: "접두문자 (디자인 사용과 상관없이 보입니다)",
      default: "▶",
      max: 20,
    },
    {
      key: "styles.ownerName.suffix",
      label: "접미문자",
      default: "◀",
      max: 20,
    },
    ...textFields("date"),
    ...textFields("link"),
    ...textFields("call"),
    ...textFields("logLink"),
    ...textFields("hashTag"),
    { type: "heading", label: "기타 디자인 설정" },
    {
      key: "font",
      label: "글꼴",
      type: "choice",
      options: [
        ["sans", "고딕"],
        ["serif", "명조"],
        ["mono", "고정폭"],
      ],
    },
    {
      key: "colors.accent",
      label: "강조색",
      type: "color",
      default: "#29c7c9",
    },
    { key: "colors.muted", label: "보조색", type: "color", default: "#bbbbbb" },
    { key: "colors.paper", label: "바탕색", type: "color", default: "#333333" },
    { key: "colors.ink", label: "글자색", type: "color", default: "#ffffff" },
    { key: "colors.line", label: "선 색", type: "color", default: "#555555" },
    {
      key: "colors.surface",
      label: "상자 배경색",
      type: "color",
      default: "#1a1a1a",
    },
    ...panelFields("input"),
    ...panelFields("box"),
    { type: "group", label: "이퀄라이저" },
    color("styles.equalizer.color", "막대색상"),
    color("styles.equalizer.glow", "외부광선"),
    ...boxFields("subMenu"),
  ],
};
models.menus = {
  label: "메뉴",
  help: "상단 메뉴입니다. 연결은 board:게시판ID, content:내용페이지ID, tab:members(멤버목록)·applicants(신청자목록)·couples(커플목록)·shop·mypage(마이페이지)·quests·content·messages·calls·characters·new(최근게시물)·search(전체검색), 또는 https:// 주소입니다. 메뉴를 하나도 만들지 않으면 원본의 기본 메뉴가 보입니다. 상위 메뉴 ID를 적으면 하위 메뉴가 됩니다. 보기 등급 1은 손님에게도 보입니다.",
  fields: [
    { key: "name", label: "메뉴 이름", required: true, max: 40 },
    { key: "link", label: "연결", required: true, max: 2000 },
    { key: "parent", label: "상위 메뉴 ID (빈칸: 최상위)", max: 64 },
    { key: "order", label: "순서", type: "number", default: 0 },
    { key: "level", label: "보기 등급 (1~10)", type: "number", default: 1 },
    { key: "enabled", label: "사용", type: "checkbox", default: true },
    {
      key: "mobile",
      label: "모바일에서 사용",
      type: "checkbox",
      default: true,
    },
    { key: "newWindow", label: "새 창으로 열기", type: "checkbox" },
  ],
};
models.banners = {
  label: "메인 슬라이드·인트로",
  help: "메인 화면 슬라이드와 첫 방문 인트로 화면의 이미지입니다. 기간 밖이거나 사용하지 않는 이미지는 표시되지 않습니다.",
  fields: [
    {
      key: "place",
      label: "위치",
      type: "choice",
      options: [
        ["main", "메인 슬라이드"],
        ["intro", "인트로"],
      ],
    },
    {
      key: "image",
      label: "이미지",
      type: "url",
      image: true,
      required: true,
      max: 2000,
    },
    {
      key: "mobileImage",
      label: "모바일 이미지",
      type: "url",
      image: true,
      max: 2000,
    },
    { key: "alt", label: "대체 문구", max: 200 },
    { key: "url", label: "링크 (HTTPS)", type: "url", max: 2000 },
    { key: "newWindow", label: "새 창으로 열기", type: "checkbox" },
    ...schedule,
    { key: "order", label: "순서", type: "number", default: 0 },
    { key: "level", label: "보기 등급 (1~10)", type: "number", default: 1 },
    { key: "enabled", label: "사용", type: "checkbox", default: true },
  ],
};
models.character_review = {
  label: "캐릭터 신청 심사",
  review: true,
  readOnly: true,
  fields: [],
  help: "캐릭터 이름이나 오너 닉네임으로 찾고, 소속·종족과 상태(인원 수와 함께)로 거르며, 체크한 캐릭터를 선택 승인으로 한 번에 승인합니다. 신청(수정 완료)·수정 중인 캐릭터를 승인하거나 수정을 요청하고, 메인·서브·NPC와 운영자 전용 항목을 정합니다. 승인하면 공식 기록의 승인도 함께 바뀝니다. 수정으로 어느 캐릭터든 이름·소속·종족·프로필·이미지·모든 추가 항목·종류·상태를 고치고(생성·수정 기간과 회원당 캐릭터 수와 상관없이), 삭제하면 관계·옷장·커플·공식 기록을 함께 지우며, 회원 변경으로 닉네임을 적은 회원에게 옮기고(옷장·관계·캐릭터의 아이템·공식 기록도 함께), 새 캐릭터로 회원 대신 등록합니다. 능력치와 포인트는 캐릭터 승인·경험치·능력치·타이틀에서 고칩니다.",
};
models.visits = {
  label: "접속자 집계",
  help: "날짜 범위의 접속을 날짜·시간·요일·월·연도·브라우저·운영체제·기기·접속 경로별로 봅니다. 회원 수는 그 기간에 접속한 서로 다른 회원 수입니다. 시작일 이전 기록은 지울 수 있습니다.",
  report: "visits",
  readOnly: true,
};
// adm/point_list.php (화폐 관리), exp_list.php (경험치 관리) and
// inventory_list.php (아이템 지급): grants with a memo, to one or to
// everyone, and the log of them.
models.grants = {
  label: "아보·경험치·아이템 지급",
  help: "회원 한 명(닉네임) 또는 전체 회원(등급 1 회원 제외)에게 아보를, 캐릭터 하나(이름) 또는 승인된 전체 캐릭터에게 경험치를 주거나 깎고, 아이템을 1~100개 줍니다. 내용은 받는 사람의 기록에 남고, 가진 것보다 많이 깎지는 않습니다. 경험치로 랭킹이 바뀌면 그 랭킹의 추가 능력치 포인트도 함께 바뀝니다.",
  report: "grants",
  readOnly: true,
};
models.activity = {
  label: "활동량 관리",
  help: "게시판과 기간을 골라 회원별 로그·댓글 수와 최종 접속을 봅니다. 누적 경고와 경고 내용은 여기서 바로 고칩니다.",
  report: "activity",
  readOnly: true,
};
models.title_holdings = {
  label: "타이틀 보유·착용 현황",
  help: "캐릭터·타이틀 이름으로 검색하고 개별 지급을 회수합니다. 삭제된 정의나 캐릭터의 기록도 확인할 수 있습니다.",
  holdings: true,
  readOnly: true,
  fields: [],
};
const nonnegative = (value) => {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("숫자는 0 이상의 정수여야 합니다.");
  return value;
};
/** A Korean local datetime-local value as milliseconds; null when blank, NaN when invalid. */
function kstStamp(value) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return NaN;
  const stamp = Date.parse(`${value}+09:00`);
  return Number.isFinite(stamp) &&
    new Date(stamp + 9 * 3600000).toISOString().slice(0, value.length) === value
    ? stamp
    : NaN;
}
/** An HTTPS address with no user name or password in it. */
function plainHttps(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}
export function fieldValue(data, key) {
  return key.split(".").reduce((value, part) => value?.[part], data);
}
function setField(data, key, value) {
  const path = key.split(".");
  let target = data;
  for (const part of path.slice(0, -1)) {
    if (!target[part] || typeof target[part] !== "object") target[part] = {};
    target = target[part];
  }
  if (value === undefined) delete target[path.at(-1)];
  else target[path.at(-1)] = value;
}
/**
 * A pick from one of the owner's lists (references[field.from]): its ID, or
 * its name with valueBy "name"; several with `multiple`. With an empty list
 * and `fallbackText`, any short text.
 */
function picked(field, value, references) {
  const rows = references[field.from] ?? [];
  const choices = rows.map((row) =>
    field.valueBy === "name" ? row.data.name : row.id,
  );
  if (field.multiple) {
    const list = Array.isArray(value) ? value : [];
    if (list.some((entry) => !choices.includes(entry)))
      throw new Error(`${field.label}을(를) 확인하세요.`);
    return [...new Set(list)];
  }
  if (!value) return field.valueBy === "name" ? "" : null;
  if (!choices.length && field.fallbackText) {
    if (typeof value !== "string" || value.length > (field.max ?? 40))
      throw new Error(`${field.label}을(를) 확인하세요.`);
    return value.trim();
  }
  if (!choices.includes(value))
    throw new Error(`${field.label}을(를) 선택하세요.`);
  return value;
}
export function buildRecord(section, values, previous, references) {
  const model = models[section];
  if (!model) throw new Error("알 수 없는 관리 항목입니다.");
  const id = model.fixedId ?? values.id;
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(id))
    throw new Error("ID는 영문·숫자·밑줄·하이픈 1~64자로 입력하세요.");
  // A copy (Naru's runtime has no structuredClone).
  const data = JSON.parse(JSON.stringify(previous?.data ?? {}));
  for (const field of model.fields) {
    // A section title on the form, as the original's settings page has.
    if (field.type === "heading" || field.type === "group") continue;
    const value = values[field.key];
    if (field.transient) {
      if (value === undefined && !field.required) continue;
      if (
        typeof value !== "string" ||
        (field.required && !value.trim()) ||
        value.length > field.max
      )
        throw new Error(`${field.label}을(를) 입력하세요.`);
      continue;
    }
    let result;
    if (field.type === "checkbox") result = Boolean(value);
    else if (field.type === "number" || field.type === "optional-number")
      result =
        field.type === "optional-number" &&
        (value === "" || value === undefined)
          ? undefined
          : nonnegative(Number(value));
    else if (field.type === "decimal") {
      result = Number(value);
      if (!Number.isFinite(result) || result < 0)
        throw new Error("무게는 유한한 0 이상의 수여야 합니다.");
    } else if (field.type === "tokens") {
      if (typeof value !== "string" || value.length > 2000)
        throw new Error("세력·종족 목록을 확인하세요.");
      result = [
        ...new Set(
          value
            .split(",")
            .map((part) => part.trim())
            .filter(Boolean),
        ),
      ];
    } else if (field.type === "ingredients") {
      if (!Array.isArray(value)) throw new Error("재료 목록을 확인하세요.");
      const ids = new Set();
      let total = 0;
      result = value.map((row) => {
        const count = nonnegative(Number(row.count));
        if (
          !count ||
          ids.has(row.item) ||
          !references.items.some((item) => item.id === row.item)
        )
          throw new Error(
            "재료는 존재하는 아이템을 중복 없이 선택하고 개수를 입력하세요.",
          );
        ids.add(row.item);
        total += count;
        return {
          item: row.item,
          count,
          ...(field.consumes ? { consume: row.consume === true } : {}),
        };
      });
      if (total > field.maxCount || (section === "recipes" && !total))
        throw new Error(`재료는 1~${field.maxCount}개로 설정하세요.`);
    } else if (field.type === "pick") {
      result = picked(field, value, references);
    } else if (field.type === "choice" && field.multiple) {
      // Several of a choice's options (design_form.php's 상·하·좌·우).
      const choices = field.options.map(([id]) => id);
      const list = Array.isArray(value) ? value : [];
      if (list.some((entry) => !choices.includes(entry)))
        throw new Error(`${field.label}을(를) 확인하세요.`);
      result = choices.filter((choice) => list.includes(choice));
    } else if (field.type === "css-color") {
      // A colour design_form.php's text fields take, or nothing.
      if (
        typeof value !== "string" ||
        (value.trim() !== "" && colorOf(value) === null)
      )
        throw new Error(
          `${field.label}은(는) #000000, rgba(0, 0, 0, .5) 꼴로 입력하세요.`,
        );
      result = value.trim();
    } else if (
      ["item", "stat", "title", "choice", "profile"].includes(field.type)
    ) {
      if (field.optional && !value)
        result = ["gacha", "explore"].includes(section) ? null : undefined;
      else {
        const choices = field.options
          ? field.options.map(([id]) => id)
          : references[
              field.type === "item"
                ? "items"
                : field.type === "stat"
                  ? "stats"
                  : field.type === "profile"
                    ? "profiles"
                    : "titles"
            ].map((row) => row.id);
        if (!choices.includes(value))
          throw new Error(`${field.label}을(를) 선택하세요.`);
        result = value;
      }
    } else if (field.type === "titles") {
      if (
        !Array.isArray(value) ||
        value.some((id) => !references.titles.some((row) => row.id === id))
      )
        throw new Error("지급할 타이틀을 확인하세요.");
      result = [...new Set(value)];
    } else {
      if (
        typeof value !== "string" ||
        value.length > (field.max ?? 2000) ||
        (field.required && !value.trim())
      )
        throw new Error(`${field.label}을(를) 확인하세요.`);
      result = value.trim();
      if (field.type === "url" && value && !plainHttps(value))
        throw new Error("이미지는 인증 정보 없는 HTTPS 주소여야 합니다.");
      if (field.type === "color" && !/^#[0-9a-fA-F]{6}$/.test(result))
        throw new Error(`${field.label}을(를) 확인하세요.`);
      if (
        field.type === "date" &&
        value &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
          !Number.isFinite(Date.parse(value)) ||
          new Date(value).toISOString().slice(0, 10) !== value)
      )
        throw new Error("날짜를 확인하세요.");
      if (
        field.type === "character" &&
        !(field.optional && !value) &&
        !references.characters.some((row) => row.id === value)
      )
        throw new Error("존재하는 캐릭터를 선택하세요.");
    }
    setField(data, field.key, result);
  }
  if (model.readOnly) throw new Error("기록은 수정할 수 없습니다.");
  if (
    section === "wallets" &&
    !references.profiles.some((row) => row.id === id)
  )
    throw new Error("존재하는 회원을 선택하세요.");
  if (section === "inventory") {
    const character = data.character
      ? references.characters.find((row) => row.id === data.character)
      : null;
    if (
      character &&
      (character.createdBy ?? character.data.owner) !== data.owner
    )
      throw new Error("선택한 회원의 캐릭터가 아닙니다.");
    const item = references.items.find((row) => row.id === data.item);
    data.name = item.data.name;
    data.character = data.character || null;
    if (!previous) data.from = "admin";
  }
  if (section === "recipes") {
    // Only craft materials (adm/recipi_update.php:14-30), and no combination
    // twice (:48-51): which recipe a set of materials makes must be one.
    const unflagged = data.ingredients.find(
      (entry) =>
        references.items.find((item) => item.id === entry.item)?.data
          .craftMaterial !== true,
    );
    if (unflagged)
      throw new Error(
        `${references.items.find((item) => item.id === unflagged.item)?.data.name ?? unflagged.item}은(는) 조합 재료로 사용 가능하게 설정되지 않은 아이템입니다.`,
      );
    const combination = (ingredients) =>
      (Array.isArray(ingredients) ? ingredients : [])
        .flatMap((entry) => Array(Number(entry.count) || 0).fill(entry.item))
        .sort()
        .join("||");
    const key = combination(data.ingredients);
    const same = (references.recipes ?? []).find(
      (row) => row.id !== id && combination(row.data.ingredients) === key,
    );
    if (same)
      throw new Error(
        `이미 등록된 레시피 조합입니다: ${same.data.name ?? same.id}.`,
      );
  }
  if (
    section === "design" &&
    data.backgroundColor &&
    !/^#[0-9a-fA-F]{6}$/.test(data.backgroundColor)
  )
    throw new Error("배경 색상코드는 #000000 꼴로 입력하세요.");
  if (section === "content" && (data.readLevel < 1 || data.readLevel > 10))
    throw new Error("읽기 등급은 1~10입니다.");
  if (section === "quests") {
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
  }
  if (
    ["menus", "banners"].includes(section) &&
    (data.level < 1 || data.level > 10)
  )
    throw new Error("보기 등급은 1~10입니다.");
  if (
    section === "menus" &&
    !/^(?:(?:board|content|tab):[\w-]{1,64}|https:\/\/[^\s@]+)$/.test(data.link)
  )
    throw new Error(
      "연결은 board:ID, content:ID, tab:이름 또는 https:// 주소입니다.",
    );
  if (section === "menus") {
    if (data.parent && !/^[a-zA-Z0-9_-]{1,64}$/.test(data.parent))
      throw new Error("상위 메뉴 ID를 확인하세요.");
    if (data.parent === id)
      throw new Error("자기 자신은 상위 메뉴가 될 수 없습니다.");
    data.parent = data.parent || null;
  }
  if (section === "banners") {
    const start = kstStamp(data.startsAt),
      end = kstStamp(data.endsAt);
    if (Number.isNaN(start) || Number.isNaN(end))
      throw new Error("기간을 확인하세요.");
    if (start !== null && end !== null && start >= end)
      throw new Error("종료는 시작보다 늦어야 합니다.");
  }
  if (section === "members" && (data.level < 1 || data.level > 10))
    throw new Error("회원 등급은 1~10입니다.");
  if (section === "boards") {
    if (
      ["listLevel", "readLevel", "writeLevel", "commentLevel"].some(
        (key) => data[key] < 1 || data[key] > 10,
      )
    )
      throw new Error("게시판 등급은 1~10입니다.");
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
  }
  if (section === "items") {
    if (!data.effect.type) delete data.effect;
    else if (data.effect.type === "restore") {
      if (!data.effect.stat || !data.effect.amount)
        throw new Error("회복할 능력치와 양을 설정하세요.");
    } else data.effect = { type: data.effect.type };
  }
  if (section === "character_fields") {
    if (
      !/^[a-z][a-z0-9_]{0,31}$/.test(id) ||
      ["constructor", "prototype"].includes(id)
    )
      throw new Error(
        "항목 ID는 영문 소문자로 시작하는 영문 소문자·숫자·밑줄 32자 이하입니다.",
      );
    if (data.type === "select" && !data.options.length)
      throw new Error("단일 선택 항목에는 선택지를 입력하세요.");
    if (
      data.options.length > 30 ||
      data.options.some((name) => name.length > 100)
    )
      throw new Error("선택지는 30개 이하, 각 100자 이하입니다.");
    if (data.type !== "select") data.options = [];
  }
  if (section === "couples" && data.first === data.second)
    throw new Error("서로 다른 캐릭터를 선택하세요.");
  if (
    section === "stat_config" &&
    (!/^[a-z][a-z0-9_]{0,31}$/.test(id) ||
      ["constructor", "prototype"].includes(id) ||
      data.initial > data.max)
  )
    throw new Error("능력치 ID와 기본값·최대값을 확인하세요.");
  if (
    section === "stat_config" &&
    !references.stats.some((row) => row.id === id) &&
    references.stats.length >= 20
  )
    throw new Error("능력치는 최대 20개입니다.");
  if (section === "items" && data.display) {
    const { fromHour, untilHour, weekdays } = data.display;
    for (const hour of [fromHour, untilHour])
      if (
        hour !== undefined &&
        hour !== null &&
        !(Number.isInteger(hour) && hour >= 0 && hour <= 23)
      )
        throw new Error("진열 시각은 0~23시로 입력하세요.");
    if (
      Array.isArray(weekdays) &&
      weekdays.some(
        (day) => !["일", "월", "화", "수", "목", "금", "토"].includes(day),
      )
    )
      throw new Error(
        "진열 요일은 일, 월, 화, 수, 목, 금, 토 중에서 적어 주세요.",
      );
  }
  if (section === "character_state") {
    const character = references.characters.find((row) => row.id === id);
    if (!character) throw new Error("존재하는 캐릭터를 선택하세요.");
    data.character = id;
    data.owner = character.createdBy ?? character.data.owner ?? null;
    data.stats = {};
    let total = 0;
    for (const definition of references.stats) {
      const allocated = nonnegative(
        Number(values[`allocated:${definition.id}`]),
      );
      const damage = nonnegative(Number(values[`damage:${definition.id}`]));
      const max = (definition.data.initial ?? 0) + allocated;
      if (!Number.isSafeInteger(max) || max > (definition.data.max ?? 999))
        throw new Error(`${definition.data.name} 최대값을 넘었습니다.`);
      data.stats[definition.id] = {
        allocated,
        max,
        damage,
        current: Math.max(0, max - damage),
      };
      total += allocated;
    }
    if (!Number.isSafeInteger(total) || total > data.points)
      throw new Error("배분한 능력치가 총 포인트를 넘습니다.");
    if (!data.titles.includes(data.activeTitle)) data.activeTitle = null;
  }
  return { id, data };
}

/** The review's states, as the original's 수정중, 신청, 승인. */
export const REVIEW_STATES = ["editing", "submitted", "approved", "deleted"];

/**
 * A record's data as its form shows it (what `buildRecord` reads back): a
 * saved record's values, or a new one's defaults. A save that sends only
 * some fields keeps the others from this. `references.stats` gives a
 * character record's stat fields.
 */
export function formValues(
  section: string,
  data: Record<string, any> | null,
  references: { stats?: { id: string }[] } = {},
): Record<string, unknown> {
  const model = models[section];
  const values: Record<string, unknown> = {};
  for (const field of model?.fields ?? []) {
    if (["heading", "group"].includes(field.type) || field.transient) continue;
    const value =
      section === "quests" && field.key === "images"
        ? Array.isArray(data?.images)
          ? data.images.join("\n")
          : ""
        : (fieldValue(data, field.key) ??
          (data ? field.default : (field.newDefault ?? field.default)));
    values[field.key] =
      field.type === "checkbox"
        ? Boolean(value)
        : field.type === "tokens"
          ? Array.isArray(value)
            ? value.join(", ")
            : (value ?? "")
          : ["ingredients", "titles"].includes(field.type) ||
              (["pick", "choice"].includes(field.type) && field.multiple)
            ? Array.isArray(value)
              ? value
              : []
            : field.type === "choice"
              ? (value ?? field.options[0][0])
              : (value ?? "");
  }
  if (section === "character_state")
    for (const definition of references.stats ?? []) {
      const stat = data?.stats?.[definition.id];
      const initial = (definition as any).data?.initial ?? 0;
      values[`allocated:${definition.id}`] = stat?.allocated ?? 0;
      values[`damage:${definition.id}`] =
        stat?.damage ?? (stat?.max ?? initial) - (stat?.current ?? initial);
    }
  return values;
}
