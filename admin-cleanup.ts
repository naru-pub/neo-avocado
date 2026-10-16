const P = "neo_avocado_";
/** Documents to remove with a deleted one; `detach` keeps them, unlinked. */
interface CleanupTarget {
  collection: string;
  filter: Record<string, unknown>;
  detach?: boolean;
}
// A character is deleted at once by the characters/sheet:remove mutation:
// only a log's comments are left to finish.
export const cleanupTargets = (kind, id): CleanupTarget[] => {
  if (kind === "logs")
    return [{ collection: `${P}comments`, filter: { logId: id } }];
  throw new Error("지원하지 않는 정리 항목입니다.");
};
/**
 * One revision-guarded, bounded batch; retrying never discards money/history.
 * Uploads the deleted documents used stay, marked 참조 없음 in Naru's media
 * library.
 */
export async function resumeCleanup(owner, kind, id) {
  const collection = `${P}${kind}`;
  const parent = await owner.collection(collection).get(id);
  if (!parent.data.deleted)
    throw new Error("삭제 중인 자료만 정리할 수 있습니다.");
  const operations = [];
  let unfinished = false;
  const seen = new Set();
  for (const target of cleanupTargets(kind, id)) {
    if (operations.length >= 20) {
      unfinished = true;
      break;
    }
    const page = await owner.collection(target.collection).list({
      filter: target.filter,
      size: Math.min(5, 20 - operations.length),
    });
    unfinished ||= Boolean(page.nextCursor);
    for (const child of page.documents) {
      const key = `${target.collection}/${child.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      operations.push({
        collection: target.collection,
        ...(target.detach
          ? {
              set: {
                id: child.id,
                data: { ...child.data, character: null },
                condition: { revision: child.revision },
              },
            }
          : {
              delete: { id: child.id, condition: { revision: child.revision } },
            }),
      });
    }
  }
  operations.push({
    collection,
    ...(unfinished
      ? {
          set: {
            id,
            data: parent.data,
            condition: { revision: parent.revision },
          },
        }
      : { delete: { id, condition: { revision: parent.revision } } }),
  });
  await owner.batch(operations);
  return { done: !unfinished, processed: operations.length - 1 };
}
