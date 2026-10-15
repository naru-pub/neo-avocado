// Pure forms/validation shared with tests. Only an SDK owner handle writes these.
const P = "neo_avocado_";
export const models = {
  content: {
    label: "내용 페이지",
    help: "안내·소개 페이지를 만듭니다. 모바일 본문이 비어 있으면 기본 본문을 표시합니다. 읽기 등급은 회원 등급 기준입니다.",
    fields: [
      { key: "name", label: "제목", required: true, max: 120 },
      { key: "enabled", label: "공개 중", type: "checkbox", default: true },
      {
        key: "readLevel",
        label: "읽기 등급 (1~10)",
        type: "number",
        default: 2,
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
      { key: "side", label: "세력 (빈칸: 공통)", max: 40 },
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
      { key: "description", label: "설명", type: "textarea", max: 2000 },
      {
        key: "kind",
        label: "글 형식",
        type: "choice",
        options: [
          ["image", "그림 로그"],
          ["text", "일반 글"],
        ],
      },
      { key: "enabled", label: "운영 중", type: "checkbox", default: true },
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
        label: "댓글 행동 허용 (탐색·아이템 사용)",
        type: "checkbox",
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
    help: "가입 승인·차단은 나루 데이터베이스의 사이트 회원 관리에서 변경합니다. 여기서는 회원 번호별 게시판 등급과 운영 역할만 정합니다.",
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
        key: "left",
        label: "탈퇴일 (빈칸: 이용 중. 지우면 다시 이용할 수 있습니다)",
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
      { key: "lastDaily", label: "최근 출석일 (빈칸: 초기화)", type: "date" },
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
    help: "회원별 경제 활동 기록입니다. 기록은 읽기만 가능합니다.",
    readOnly: true,
    fields: [],
  },
  items: {
    label: "아이템·상점",
    help: "상점 가격·재고와 사용 효과, 구매 조건을 설정합니다. 빈 재고는 무제한입니다. 개인 제작 아이템도 여기에서 관리합니다.",
    fields: [
      { key: "name", label: "이름", required: true, max: 80 },
      { key: "description", label: "설명", type: "textarea", max: 2000 },
      { key: "image", label: "이미지", type: "url", image: true, max: 2000 },
      {
        key: "shopCategory",
        label: "상점 분류 (기본 설정의 분류 중 하나, 빈칸: 첫 분류)",
        max: 40,
      },
      { key: "price", label: "구매 가격", type: "number", default: 0 },
      { key: "stock", label: "재고 (빈칸: 무제한)", type: "optional-number" },
      {
        key: "sellPrice",
        label: "판매 보상 (빈칸: 판매 불가)",
        type: "optional-number",
      },
      { key: "hidden", label: "상점에서 숨기기", type: "checkbox" },
      { key: "sellable", label: "판매 허용", type: "checkbox", default: true },
      { key: "giftable", label: "선물 허용", type: "checkbox", default: true },
      { key: "usable", label: "사용 허용", type: "checkbox", default: true },
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
    label: "캐릭터 승인·경험치·능력치·타이틀",
    help: "공식 세력·종족은 회원이 적은 프로필과 별도로 관리합니다. 포인트는 기본 능력치 외에 배분할 총 포인트입니다. 승인은 ‘캐릭터 신청 심사’에서 바꾸면 신청 상태와 함께 바뀝니다.",
    characterKey: true,
    fields: [
      { key: "approved", label: "승인", type: "checkbox" },
      { key: "side", label: "공식 세력", max: 40 },
      { key: "class", label: "공식 종족", max: 40 },
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
    ],
  },
  levels: {
    label: "등급",
    help: "경험치가 기준 이상인 가장 높은 등급을 표시합니다.",
    fields: [
      { key: "name", label: "등급 이름", required: true, max: 40 },
      { key: "exp", label: "필요 경험치", type: "number", default: 0 },
    ],
  },
  settings: {
    label: "기본 설정",
    help: "새 캐릭터가 받을 기본 배분 포인트입니다. 기존 캐릭터 값은 따로 변경하세요.",
    fixedId: "community",
    fields: [
      {
        key: "messageCost",
        label: "쪽지 발송 비용 (회원 한 명당)",
        type: "number",
        default: 0,
      },
      {
        key: "initialStatPoints",
        label: "새 캐릭터 배분 포인트",
        type: "number",
        default: 0,
      },
      {
        key: "exploreLimit",
        label: "캐릭터별 하루 탐색 횟수 (0: 탐색 끄기, 한국 시간 기준)",
        type: "number",
        default: 0,
      },
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
      {
        key: "bgm",
        label: "배경음악 (유튜브 재생목록·영상 주소, 빈칸: 끄기)",
        max: 300,
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
models.design = {
  label: "디자인",
  help: "사이트 이름, 로고, 배경과 색을 정합니다. 디자인 사용을 끄면 원본처럼 꾸미지 않은 기본 화면이고, 켜면 아래 배경·글꼴·색이 적용됩니다. 이미지는 파일로 올리거나 HTTPS 주소로 입력합니다. 회원과 손님 모두에게 적용됩니다.",
  fixedId: "site",
  fields: [
    { key: "enabled", label: "디자인 사용", type: "checkbox" },
    { key: "title", label: "사이트 이름", max: 60 },
    { key: "logo", label: "로고 이미지", type: "url", image: true, max: 2000 },
    {
      key: "background",
      label: "배경 이미지",
      type: "url",
      image: true,
      max: 2000,
    },
    {
      key: "headerBackground",
      label: "상단 배경 이미지",
      type: "url",
      image: true,
      max: 2000,
    },
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
  ],
};
models.menus = {
  label: "메뉴",
  help: "상단 메뉴입니다. 연결은 board:게시판ID, content:내용페이지ID, tab:members(멤버목록)·applicants(신청자목록)·couples(커플목록)·shop·mypage(마이페이지)·quests·content·messages·calls·characters, 또는 https:// 주소입니다. 메뉴를 하나도 만들지 않으면 원본의 기본 메뉴가 보입니다. 상위 메뉴 ID를 적으면 하위 메뉴가 됩니다. 보기 등급 1은 손님에게도 보입니다.",
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
  collection: `${P}characters`,
  review: true,
  readOnly: true,
  fields: [],
  help: "신청(수정 완료)·수정 중인 캐릭터를 승인하거나 수정을 요청하고, 메인·서브·NPC와 운영자 전용 항목을 정합니다. 승인하면 공식 기록의 승인도 함께 바뀝니다.",
};
models.log_cleanup = {
  label: "삭제 중인 로그 정리",
  collection: `${P}logs`,
  cleanup: "logs",
  readOnly: true,
  fields: [],
  help: "중단된 댓글 정리를 이어갑니다. 완료될 때까지 정리 계속을 누르세요.",
};
models.character_cleanup = {
  label: "삭제 중인 캐릭터 정리",
  collection: `${P}characters`,
  cleanup: "characters",
  readOnly: true,
  fields: [],
  help: "관계·옷장·커플을 정리하고 구매 아이템은 회원 인벤토리로 돌려놓습니다. 잔액과 활동 기록은 보존합니다.",
};
models.title_holdings = {
  label: "타이틀 보유·착용 현황",
  help: "캐릭터·타이틀 이름으로 검색하고 개별 지급을 회수합니다. 삭제된 정의나 캐릭터의 기록도 확인할 수 있습니다.",
  collection: `${P}character_state`,
  holdings: true,
  readOnly: true,
  fields: [],
};
for (const [name, model] of Object.entries(models))
  model.collection ??= `${P}${name}`;
// The collections the owner's sign-in asks for. Their settings (access, rules,
// unique fields) are declared in _naru/collections.json, which Naru installs
// when the site's files arrive.
export const scopes = [
  ...new Set([
    ...Object.values(models).map((model) => model.collection),
    `${P}characters`,
    `${P}profiles`,
    `${P}comments`,
    `${P}relations`,
    `${P}wardrobe`,
    // Written only by site functions.
    `${P}messages`,
    `${P}counters`,
    `${P}calls`,
  ]),
];

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
export function buildRecord(section, values, previous, references) {
  const model = models[section];
  if (!model) throw new Error("알 수 없는 관리 항목입니다.");
  const id = model.fixedId ?? values.id;
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(id))
    throw new Error("ID는 영문·숫자·밑줄·하이픈 1~64자로 입력하세요.");
  const data = structuredClone(previous?.data ?? {});
  for (const field of model.fields) {
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
      if (
        field.type === "url" &&
        value &&
        (!/^https:\/\//.test(value) ||
          new URL(value).username ||
          new URL(value).password)
      )
        throw new Error("이미지는 인증 정보 없는 HTTPS 주소여야 합니다.");
      if (field.type === "color" && !/^#[0-9a-fA-F]{6}$/.test(result))
        throw new Error(`${field.label}을(를) 확인하세요.`);
      if (
        field.type === "date" &&
        value &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
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
      data.images.some((value) => {
        try {
          const url = new URL(value);
          return url.protocol !== "https:" || url.username || url.password;
        } catch {
          return true;
        }
      })
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

/**
 * A character's official record, and when its experience changed, a line in
 * its owner's experience history (adm/exp_list.php, member/exp.php), in one
 * batch.
 */
export function characterStateWrites(record, previous, note, at, historyId) {
  const writes = [
    {
      collection: "neo_avocado_character_state",
      set: {
        id: record.id,
        data: record.data,
        condition: previous
          ? { revision: previous.revision }
          : { absent: true },
      },
    },
  ];
  const before = previous?.data.exp ?? 0;
  const after = record.data.exp ?? 0;
  if (after !== before && record.data.owner)
    writes.push({
      collection: "neo_avocado_history",
      set: {
        id: historyId,
        data: {
          owner: record.data.owner,
          kind: "exp",
          at,
          character: record.id,
          expDelta: after - before,
          exp: after,
          memo: (note ?? "").trim(),
          actor: "site-owner",
        },
        condition: { absent: true },
      },
    });
  return writes;
}

export function walletWrites(record, previous, note, at, historyId) {
  const before = nonnegative(previous?.data.balance ?? 0);
  return [
    {
      collection: "neo_avocado_wallets",
      set: {
        id: record.id,
        data: record.data,
        condition: previous
          ? { revision: previous.revision }
          : { absent: true },
      },
    },
    {
      collection: "neo_avocado_history",
      set: {
        id: historyId,
        data: {
          owner: record.id,
          kind: "adjust",
          at,
          delta: record.data.balance - before,
          balance: record.data.balance,
          memo: note.trim(),
          actor: "site-owner",
        },
        condition: { absent: true },
      },
    },
  ];
}

export function titleHoldings(states, characters, titles, query = "") {
  const needle = query.trim().toLocaleLowerCase();
  return states
    .flatMap((row) =>
      [
        ...new Set([
          ...(row.data.titles ?? []),
          ...(row.data.activeTitle ? [row.data.activeTitle] : []),
        ]),
      ].map((titleId) => {
        const character = characters.find((value) => value.id === row.id);
        const title = titles.find((value) => value.id === titleId);
        return {
          state: row,
          titleId,
          title: title?.data.name ?? `${titleId} (삭제된 타이틀)`,
          character: character?.data.name ?? `${row.id} (삭제된 캐릭터)`,
          image: title?.data.image,
          active: row.data.activeTitle === titleId,
        };
      }),
    )
    .filter(
      (row) =>
        !needle ||
        `${row.character} ${row.title} ${row.state.id} ${row.titleId}`
          .toLocaleLowerCase()
          .includes(needle),
    );
}
