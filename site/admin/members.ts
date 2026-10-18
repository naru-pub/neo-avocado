// 회원관리's own: daily maintenance and the members' bulk actions.
import { $, owner, run } from "./core.js";
import { load } from "./list.js";

/**
 * The day's cleanup (admin/maintenance:run) where 커뮤니티 설정 asks for it,
 * called again while members who left remain to delete; what it did shows.
 */
export async function maintain() {
  const total = { visits: 0, messages: 0, members: 0 };
  for (let calls = 0; calls < 50; calls += 1) {
    const result = await owner.mutate("admin/maintenance:run");
    if (!result.ran) break;
    total.visits += result.visits;
    total.messages += result.messages;
    total.members += result.members;
    if (!result.remaining) break;
  }
  const done = [
    total.visits && `접속자로그 ${total.visits}일`,
    total.messages && `쪽지 ${total.messages}통`,
    total.members && `탈퇴 회원 ${total.members}명`,
  ].filter(Boolean);
  if (done.length)
    $("adminStatus").textContent =
      `설정한 기간이 지난 ${done.join(", ")}을(를) 정리했습니다.`;
}
/** The members ticked in 회원 관리's list. */
export const pickedMembers = () =>
  [
    ...$("adminRows").querySelectorAll<HTMLInputElement>(
      "input[data-member]:checked",
    ),
  ].map((box) => ({ id: box.dataset.member, nick: box.dataset.nick }));
export const memberBulk = (action) =>
  run(async () => {
    const picked = pickedMembers();
    if (!picked.length)
      return ($("adminStatus").textContent =
        "하나 이상의 회원을 선택해 주세요.");
    const level = Number($<HTMLSelectElement>("memberLevel").value);
    if (
      !confirm(
        action === "level"
          ? `선택한 ${picked.length}명의 등급을 ${level}(으)로 바꿀까요?`
          : `선택한 ${picked.length}명을 탈퇴 처리할까요? 탈퇴일을 지우면 되돌릴 수 있습니다.`,
      )
    )
      return;
    const { changed } = await owner.mutate("admin/members:bulk", {
      ids: picked.map((member) => member.id),
      action,
      ...(action === "level" ? { level } : {}),
    });
    $("adminStatus").textContent = `${changed}명을 바꿨습니다.`;
    await load();
  });
$("membersLevel").onclick = () => memberBulk("level");
$("membersLeave").onclick = () => memberBulk("leave");
$("membersDelete").onclick = () =>
  run(async () => {
    const picked = pickedMembers();
    if (!picked.length)
      return ($("adminStatus").textContent =
        "하나 이상의 회원을 선택해 주세요.");
    if (
      !confirm(
        `선택한 ${picked.length}명을 삭제할까요? 닉네임은 남고, 쪽지·관심로그·화폐 내역과 잔액·운영 역할을 지우며 되돌릴 수 없습니다. 글·댓글·캐릭터는 남습니다.`,
      )
    )
      return;
    // One call a member: each deletion is a dozen statements.
    let deleted = 0;
    for (const member of picked) {
      $("adminStatus").textContent = `${member.nick} 삭제 중…`;
      const result = await owner.mutate("admin/members:deleteMember", {
        id: member.id,
      });
      if (result.deleted) deleted += 1;
    }
    $("adminStatus").textContent = `${deleted}명을 삭제했습니다.`;
    await load();
  });
