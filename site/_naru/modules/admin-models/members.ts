// 회원관리 (adm/admin.menu200.php): members, and the activity and visit reports.
import type { Model } from "./shared.js";

export const membersModels: Record<string, Model> = {
  members: {
    label: "회원 등급·운영 역할",
    help: "가입 승인과 로그인 차단은 나루 데이터베이스의 사이트 회원 관리에서 변경합니다. 여기서는 회원 번호별 게시판 등급과 운영 역할, 커뮤니티의 접근차단일을 정합니다. 목록은 최근 접속 순으로 등급·역할·경고·탈퇴일·차단일·최종 접속을 보여 주고, 닉네임이나 회원 번호로 찾습니다. 회원 삭제는 원본처럼 닉네임은 남기고 그 회원의 쪽지·관심로그·화폐 내역·잔액·운영 역할·게시판 관리자 지정을 지웁니다(글·댓글·캐릭터는 남음). 나루 계정은 사이트가 지울 수 없으니, 로그인까지 막으려면 나루에서 차단하세요.",
    fields: [
      // member_form.php's 닉네임 and 생년 (mb_name, mb_birth): the profile's,
      // once the member has joined.
      { key: "nick", label: "닉네임 (가입한 회원)", max: 20 },
      {
        key: "birthYear",
        label: "출생년도 (빈칸: 없음)",
        type: "optional-number",
      },
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
    check(data) {
      if (data.level < 1 || data.level > 10)
        throw new Error("회원 등급은 1~10입니다.");
      if (
        data.birthYear !== undefined &&
        data.birthYear !== null &&
        (!Number.isInteger(data.birthYear) ||
          data.birthYear < 1900 ||
          data.birthYear > 2100)
      )
        throw new Error("출생년도는 1900~2100년입니다.");
    },
  },
  activity: {
    label: "활동량 관리",
    help: "게시판과 기간을 골라 회원별 로그·댓글 수와 최종 접속을 봅니다. 누적 경고와 경고 내용은 여기서 바로 고칩니다.",
    report: "activity",
    readOnly: true,
  },
  visits: {
    label: "접속자 집계",
    help: "날짜 범위의 접속을 날짜·시간·요일·월·연도·브라우저·운영체제·기기·접속 경로별로 봅니다. 회원 수는 그 기간에 접속한 서로 다른 회원 수입니다. 시작일 이전 기록은 지울 수 있습니다.",
    report: "visits",
    readOnly: true,
  },
};
