// A log's comments: their list, replies (wr_comment_reply), secret comments,
// edits and deletes.
import {
  state,
  boardStaff,
  mine,
  edit,
  mutate,
  withGuestPassword,
  run,
} from "./core.js";
import { speakerLabel, diceText, postText, actionItem } from "./posts.js";
import { kindOf, loadEmoticons } from "./logs.js";
import { fullTime } from "./log-item.js";

/** Who wrote a post or comment, as far as the reader is shown. */
export const writerOf = (row) => row.createdBy ?? row.data.owner ?? null;
export async function commentItem(comment, log) {
  const item = document.createElement("li");
  item.className = "comment";
  item.dataset.id = comment.id;
  // 댓글 답변 (wr_comment_reply): a step in for each level.
  if (comment.data.depth) {
    item.classList.add("comment-reply");
    item.style.setProperty("--depth", String(comment.data.depth));
  }
  // The post's own writer commenting (view_comment.skin.php:74-80): not
  // where either is 익명.
  if (
    !log.data.anonymous &&
    !comment.data.anonymous &&
    writerOf(comment) &&
    writerOf(comment) === writerOf(log)
  )
    item.classList.add("owner");
  const author = document.createElement("strong");
  author.className = "author";
  // The site owner's mark (view_comment.skin.php:38's ico_admin).
  // 관리자 아이콘 (ico_admin) in its place, where the owner set one.
  if (comment.data.admin === true && !comment.data.anonymous)
    author.append(
      state.adminIcon
        ? Object.assign(document.createElement("img"), {
            className: "admin-mark admin-icon",
            src: state.adminIcon,
            alt: "관리자",
          })
        : Object.assign(document.createElement("span"), {
            className: "admin-mark",
            textContent: "관리자",
          }),
    );
  author.append(await speakerLabel(comment));
  // 「작성자」 원글 작성자's 접두문자 and 접미문자 (view_comment.skin.php:93-96).
  if (item.classList.contains("owner")) {
    const { prefix = "", suffix = "" } = state.ownerMarks ?? {};
    if (prefix) author.prepend(`${prefix} `);
    if (suffix) author.append(` ${suffix}`);
  }
  item.append(author, " ");
  if (comment.data.dice) {
    const dice = document.createElement("span");
    dice.className = "dice";
    dice.textContent = diceText(comment);
    item.append(dice, " ");
  }
  // 비밀글 (bbs/view_comment.php:39): its text to the staff and the two
  // writers only; they see its mark.
  if (comment.data.hidden)
    item.append(
      Object.assign(document.createElement("span"), {
        className: "secret-comment",
        textContent: "비밀글 입니다.",
      }),
    );
  else {
    if (comment.data.secret)
      item.append(
        Object.assign(document.createElement("span"), {
          className: "secret-mark",
          textContent: "🔒",
          title: "비밀글",
        }),
        " ",
      );
    item.append(
      postText(comment.data.text ?? "", await loadEmoticons(), {
        pictureBoard: kindOf(log.data.board) === "image",
      }),
    );
  }
  // The comment's own address (/post/<id>/comment/<id>).
  const link = document.createElement("a");
  link.className = "permalink";
  link.href = `/post/${encodeURIComponent(comment.data.logId)}/comment/${encodeURIComponent(comment.id)}`;
  link.title = "댓글 링크";
  link.textContent = "#";
  item.append(" ", link);
  for (const action of Array.isArray(comment.data.actions)
    ? comment.data.actions
    : [])
    item.append(actionItem(action));
  // The comment's time in full (view_comment.skin.php's co-footer).
  item.append(
    " ",
    Object.assign(document.createElement("time"), {
      className: "comment-time",
      dateTime: comment.createdAt ?? "",
      textContent: fullTime(comment.createdAt),
    }),
  );
  // basic/view_comment.skin.php:71's 답변, on a plain board, five deep.
  const commentForm = () =>
    item.closest(".log")?.querySelector<HTMLFormElement>(".comment-form");
  const commentBoard = state.boards.find(
    (row) => row.id === (log.data.board ?? "default"),
  );
  if (
    kindOf(log.data.board) === "text" &&
    (comment.data.depth ?? 0) < 5 &&
    commentBoard?.data.enabled !== false &&
    (boardStaff(log.data.board) ||
      state.owner ||
      state.level >= (commentBoard?.data.commentLevel ?? 2))
  ) {
    const answer = document.createElement("button");
    answer.type = "button";
    answer.className = "answer";
    answer.textContent = "답변";
    answer.onclick = () => {
      const form = commentForm();
      if (!form) return;
      form.dataset.replyTo = comment.id;
      const note = form.querySelector<HTMLElement>(".comment-replying");
      note.hidden = false;
      note.querySelector("span").textContent = `${
        item.querySelector(".author")?.textContent ?? ""
      }님께 답변`;
      form.querySelector<HTMLTextAreaElement>(".comment-text").focus();
    };
    item.append(" ", answer);
  }
  const guestComment = !state.member && Boolean(comment.data.guest);
  if (mine(comment) || boardStaff(log.data.board) || guestComment) {
    const change = document.createElement("button");
    change.type = "button";
    change.className = "edit";
    change.textContent = "수정";
    change.onclick = () =>
      edit(
        "댓글 수정",
        [
          ...(guestComment
            ? [
                {
                  name: "password",
                  label: "비밀번호",
                  type: "password",
                  required: true,
                  max: 64,
                },
              ]
            : []),
          {
            name: "text",
            label: "댓글",
            value: comment.data.text,
            multiline: true,
            max: 2000,
          },
          ...(guestComment
            ? []
            : [
                {
                  name: "secret",
                  label: "비밀글",
                  type: "checkbox",
                  value: comment.data.secret === true,
                },
              ]),
        ],
        async ({ text, password, secret = false }) => {
          if (!text && !comment.data.dice)
            throw new Error("댓글을 입력해 주세요.");
          const { document: saved } = await mutate("community/comments:write", {
            id: comment.id,
            data: {
              ...comment.data,
              text,
              ...(guestComment ? {} : { secret }),
            },
            revision: comment.revision,
            ...(guestComment ? { guest: { password } } : {}),
          });
          item.replaceWith(await commentItem(saved, log));
        },
      );
    item.append(" ", change);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "delete";
    remove.textContent = "삭제";
    remove.onclick = () =>
      guestComment
        ? withGuestPassword("댓글 삭제", async (guest) => {
            await mutate("community/comments:remove", {
              id: comment.id,
              guest,
            });
            item.remove();
          })
        : run(async () => {
            await mutate("community/comments:remove", {
              id: comment.id,
            });
            item.remove();
          });
    item.append(" ", remove);
  }
  return item;
}
