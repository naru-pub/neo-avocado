// 환경설정 (adm/admin.menu100.php): the site's settings, its design, menus and banners.
import { BACKGROUNDS, BOXES, BUTTONS, PANELS, TEXTS } from "../design.js";
import {
  kstStamp,
  type Model,
  type ModelField,
  schedule,
  viewLevel,
} from "./shared.js";

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

export const configModels: Record<string, Model> = {
  // adm/index.php (관리자메인): where the admin opens, the header's title
  // leads back to it, and it sits in no group of the menu.
  main: {
    label: "관리자메인",
    help: "커뮤니티의 시스템 페이지와 관리자 메뉴 전체입니다. 원본의 관리자메인과 같습니다.",
    report: "main",
    readOnly: true,
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
      // cf_twitter (community_form_update.php:72): the account
      // {{TWITTER}} shows (templete/txt.twitter.php).
      {
        key: "twitter",
        label: "트위터(X) 계정 ({{TWITTER}}가 보일 계정, @ 없이)",
        max: 15,
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
      // cf_4 탐색사용 and cf_6 탐색 수행 가능 (extend/community.config.php:10):
      // exploration needs both, so the owner may set it up before members
      // can explore. Off as the original installs them; a site saved
      // before keeps exploring by its daily count alone.
      {
        key: "exploring",
        label: "탐색 사용",
        type: "checkbox",
        default: true,
        newDefault: false,
      },
      {
        key: "exploreOpen",
        label:
          "탐색 수행 가능 (끄면 탐색을 준비만 하고 회원은 아직 탐색할 수 없음)",
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
      // cf_use_point: off, nothing the site pays or charges moves money
      // (insert_point does nothing); the shop keeps its prices.
      {
        key: "usePoint",
        label:
          "포인트 사용 (끄면 가입·로그인·글·댓글·읽기·다운로드·추천·쪽지로 화폐가 오가지 않음)",
        type: "checkbox",
        default: true,
      },
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
      // Not the original's: caculate lets any admin pay any amount. Here a
      // moderator or a board's 게시판·그룹 관리자 pays a settlement at most
      // these; more is the site owner's to pay.
      {
        key: "settlementMoneyLimit",
        label:
          "정산 지급 한도: 화폐 (운영진·게시판 관리자가 정산글 하나에 줄 수 있는 최대, 0이면 운영자만 지급)",
        type: "number",
        default: 0,
      },
      {
        key: "settlementExpLimit",
        label:
          "정산 지급 한도: 경험치 (운영진·게시판 관리자가 정산글 하나에 줄 수 있는 최대, 0이면 운영자만 지급)",
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
      // bbs/db_table.optimize.php's cleanups, once a day as the owner opens
      // the admin. The original installs 180, 180 and 30 days; here each is
      // off (0) until the owner asks, as nothing is deleted unasked.
      { type: "heading", label: "자동 정리" },
      {
        key: "visitDays",
        label:
          "접속자로그 삭제 (일, 이보다 지난 접속자 집계를 지움, 0이면 지우지 않음)",
        type: "number",
        default: 0,
      },
      {
        key: "memoDays",
        label: "쪽지 삭제 (일, 이보다 지난 쪽지를 지움, 0이면 지우지 않음)",
        type: "number",
        default: 0,
      },
      {
        key: "leaveDays",
        label:
          "회원탈퇴후 삭제일 (일, 탈퇴한 지 이보다 지난 회원을 회원 삭제처럼 지움, 0이면 지우지 않음)",
        type: "number",
        default: 0,
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
      // cf_item_category: the names the item form's 아이템 기능 takes.
      {
        key: "itemTypes",
        label: "아이템 기능 (쉼표로 구분, 아이템을 분류해 찾을 때 씀)",
        type: "textarea",
        max: 1000,
      },
      { type: "heading", label: "캐릭터 보기" },
      {
        key: "viewerInventory",
        label: "캐릭터 보기에 인벤토리 보이기",
        type: "checkbox",
      },
      {
        // ad_use_money (금액 사용): also 마이페이지's 화폐관리.
        key: "viewerMoney",
        label: "금액 사용 (화폐 관리, 캐릭터 보기의 오너 소지금)",
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
  design: {
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
      {
        key: "logo",
        label: "로고 이미지",
        type: "url",
        image: true,
        max: 2000,
      },
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
      {
        key: "colors.muted",
        label: "보조색",
        type: "color",
        default: "#bbbbbb",
      },
      {
        key: "colors.paper",
        label: "바탕색",
        type: "color",
        default: "#333333",
      },
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
      // The owner's own CSS, kept with the settings so a template update
      // leaves it: beating the template's and 디자인's styles (app/site.ts),
      // with 디자인 사용 or not.
      { type: "heading", label: "사용자 CSS" },
      {
        key: "customCss",
        label:
          "사용자 CSS (디자인 사용과 상관없이 모든 화면에 적용되며, 기본 모양과 위의 디자인 설정보다 먼저입니다. 색은 --avocado(강조), --paper(바탕), --ink(글자), --line(선), --surface(상자), --pit(흐린 글자) 변수로 바꿀 수 있고, 변수와 바꿀 만한 부분의 클래스는 README의 「꾸미기」에 있습니다)",
        type: "textarea",
        max: 50000,
      },
      // Naru's _owner/ folder, which no template update touches.
      {
        key: "ownerFiles",
        label:
          "사이트 주인 파일 불러오기 (사이트의 /_owner/style.css와 /_owner/script.js를 템플릿 뒤에 불러옵니다. 템플릿을 업데이트해도 나루가 건드리지 않는 폴더이니, 파일을 올린 뒤 켜세요)",
        type: "checkbox",
      },
    ],
    check(data) {
      if (
        data.backgroundColor &&
        !/^#[0-9a-fA-F]{6}$/.test(data.backgroundColor)
      )
        throw new Error("배경 색상코드는 #000000 꼴로 입력하세요.");
    },
  },
  menus: {
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
    check(data, { id }) {
      viewLevel(data);
      if (
        !/^(?:(?:board|content|tab):[\w-]{1,64}|https:\/\/[^\s@]+)$/.test(
          data.link,
        )
      )
        throw new Error(
          "연결은 board:ID, content:ID, tab:이름 또는 https:// 주소입니다.",
        );
      if (data.parent && !/^[a-zA-Z0-9_-]{1,64}$/.test(data.parent))
        throw new Error("상위 메뉴 ID를 확인하세요.");
      if (data.parent === id)
        throw new Error("자기 자신은 상위 메뉴가 될 수 없습니다.");
      data.parent = data.parent || null;
    },
  },
  banners: {
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
    check(data) {
      viewLevel(data);
      const start = kstStamp(data.startsAt),
        end = kstStamp(data.endsAt);
      if (Number.isNaN(start) || Number.isNaN(end))
        throw new Error("기간을 확인하세요.");
      if (start !== null && end !== null && start >= end)
        throw new Error("종료는 시작보다 늦어야 합니다.");
    },
  },
};
