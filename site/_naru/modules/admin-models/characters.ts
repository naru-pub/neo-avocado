// 캐릭터관리: profile fields and images, the review, each character's record, titles, ranks, stats, couples, 소속 and 종족.
import { nonnegative, type Model } from "./shared.js";

export const charactersModels: Record<string, Model> = {
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
      // ar_size: the input's width, or a textarea's height (character_form.php:283).
      {
        key: "size",
        label: "입력칸 크기 (px, 한 줄은 폭·여러 줄은 높이, 빈칸이면 기본)",
        type: "optional-number",
      },
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
    check(data, { id }) {
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
    },
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
      // ad_text_name, ad_help_name: the name is always asked for.
      { type: "heading", label: "이름" },
      { key: "nameLabel", label: "항목 이름", default: "이름", max: 20 },
      { key: "nameHelp", label: "도움말", max: 200 },
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
  character_review: {
    label: "캐릭터 신청 심사",
    review: true,
    readOnly: true,
    fields: [],
    help: "캐릭터 이름이나 오너 닉네임으로 찾고, 소속·종족과 상태(인원 수와 함께)로 거르며, 체크한 캐릭터를 선택 승인으로 한 번에 승인합니다. 신청(수정 완료)·수정 중인 캐릭터를 승인하거나 수정을 요청하고, 메인·서브·NPC와 운영자 전용 항목을 정합니다. 승인하면 공식 기록의 승인도 함께 바뀝니다. 수정으로 어느 캐릭터든 이름·소속·종족·프로필·이미지·모든 추가 항목·종류·상태를 고치고(생성·수정 기간과 회원당 캐릭터 수와 상관없이), 삭제하면 관계·옷장·커플·공식 기록을 함께 지우며, 회원 변경으로 닉네임을 적은 회원에게 옮기고(옷장·관계·캐릭터의 아이템·공식 기록도 함께), 새 캐릭터로 회원 대신 등록합니다. 능력치와 포인트는 캐릭터 승인·경험치·능력치·타이틀에서 고칩니다.",
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
    check(data, { id, values, references }) {
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
    },
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
  title_holdings: {
    label: "타이틀 보유·착용 현황",
    help: "캐릭터·타이틀 이름으로 검색하고 개별 지급을 회수합니다. 삭제된 정의나 캐릭터의 기록도 확인할 수 있습니다.",
    holdings: true,
    readOnly: true,
    fields: [],
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
      // st_use_max: shown against 최대값, not the character's own maximum.
      {
        key: "useMax",
        label:
          "최대값 기준으로 출력 (캐릭터의 최대치 대신 위 최대값과 비교해 보임)",
        type: "checkbox",
      },
    ],
    check(data, { id, references }) {
      if (
        !/^[a-z][a-z0-9_]{0,31}$/.test(id) ||
        ["constructor", "prototype"].includes(id) ||
        data.initial > data.max
      )
        throw new Error("능력치 ID와 기본값·최대값을 확인하세요.");
      if (
        !references.stats.some((row) => row.id === id) &&
        references.stats.length >= 20
      )
        throw new Error("능력치는 최대 20개입니다.");
    },
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
    check(data) {
      if (data.first === data.second)
        throw new Error("서로 다른 캐릭터를 선택하세요.");
    },
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
};
