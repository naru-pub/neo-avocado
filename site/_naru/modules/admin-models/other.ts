// 기타관리 (adm/admin.menu900.php): popups, polls and backups.
import { type Model, schedule } from "./shared.js";

export const otherModels: Record<string, Model> = {
  // 팝업레이어관리 (adm/newwinlist.php, newwinform.php).
  popups: {
    label: "팝업레이어",
    help: "원본의 팝업레이어관리처럼 메인 화면 위에 띄울 알림을 기간·기기·위치·크기와 함께 만듭니다. 내용은 HTML로 쓰며 게시글처럼 정리해 보입니다. 읽는 사람이 'N시간 동안 다시 열람하지 않습니다'를 누르면 그 시간 동안 다시 뜨지 않습니다.",
    fields: [
      { key: "subject", label: "제목", required: true, max: 200 },
      {
        key: "content",
        label: "내용 (HTML)",
        type: "textarea",
        required: true,
        max: 20000,
      },
      {
        key: "device",
        label: "접속기기",
        type: "choice",
        default: "both",
        options: [
          ["both", "PC와 모바일"],
          ["pc", "PC"],
          ["mobile", "모바일"],
        ],
      },
      ...schedule,
      {
        key: "disableHours",
        label: "다시 열람하지 않을 시간 (시간)",
        type: "number",
        default: 24,
      },
      { key: "left", label: "좌측 위치 (px)", type: "number", default: 10 },
      { key: "top", label: "상단 위치 (px)", type: "number", default: 10 },
      { key: "width", label: "폭 (px)", type: "number", default: 450 },
      { key: "height", label: "높이 (px)", type: "number", default: 500 },
      { key: "enabled", label: "사용", type: "checkbox", default: true },
    ],
  },
  // 투표관리 (adm/poll_list.php, poll_form.php).
  polls: {
    label: "설문조사",
    help: "원본의 투표관리처럼 질문과 답(한 줄에 하나, 9개까지)을 정합니다. 사용 중인 가장 최근 설문이 메인 화면에 보입니다. 정한 등급 이상의 회원이 한 번 투표하고, 투표하면 정한 만큼 화폐를 받습니다. 기타의견 질문을 적으면 회원이 의견을 남깁니다.",
    fields: [
      { key: "subject", label: "질문", required: true, max: 200 },
      {
        key: "options",
        label: "답 (한 줄에 하나, 2~9개)",
        type: "textarea",
        required: true,
        max: 2000,
      },
      { key: "level", label: "투표 가능 등급", type: "number", default: 2 },
      { key: "point", label: "투표 포인트 (화폐)", type: "number", default: 0 },
      { key: "etc", label: "기타의견 질문 (빈칸: 받지 않음)", max: 200 },
      { key: "enabled", label: "사용", type: "checkbox", default: true },
    ],
    check(data) {
      const answers = String(data.options ?? "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      if (answers.length < 2 || answers.length > 9)
        throw new Error("답은 2~9개를 한 줄에 하나씩 적어 주세요.");
      if (answers.some((line) => line.length > 255))
        throw new Error("답은 255자까지 적을 수 있습니다.");
      data.options = answers.join("\n");
      if (data.level < 1 || data.level > 10)
        throw new Error("투표 가능 등급은 1~10입니다.");
      if (!data.createdAt) data.createdAt = Date.now();
    },
  },
  // adm/data_backup.php and data_restore.php (기타관리): the original's
  // categories of rows, kept as a file and put back.
  backup: {
    label: "데이터 백업·복원",
    help: "원본의 데이터 백업지점 설정·데이터 복원하기처럼 디자인, 메뉴·메인 화면, 캐릭터, 능력치 정의, 경험치 내역, 화폐를 하나씩 파일로 내려받아 두고, 그 파일로 되돌립니다. 되돌리면 그 항목의 지금 행을 지우고 파일의 행을 넣습니다. 사이트 데이터베이스 전체는 나루 제어판의 데이터베이스 → 복원 지점에서 되돌립니다.",
    report: "backup",
    readOnly: true,
  },
};
