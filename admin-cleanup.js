import { retryOwnerMedia, releaseMediaReferences } from "./media-cleanup.js";
const P = "neo_avocado_";
export const cleanupTargets = (kind, id) => {
  if (kind === "logs")
    return [{ collection: `${P}comments`, filter: { logId: id } }];
  if (kind !== "characters") throw new Error("지원하지 않는 정리 항목입니다.");
  return [
    { collection: `${P}relations`, filter: { character: id } },
    { collection: `${P}relations`, filter: { target: id } },
    { collection: `${P}wardrobe`, filter: { character: id } },
    { collection: `${P}inventory`, filter: { character: id }, detach: true },
    { collection: `${P}couples`, filter: { first: id } },
    { collection: `${P}couples`, filter: { second: id } },
  ];
};
/** One revision-guarded, bounded batch; retrying never discards money/history. */
export async function resumeCleanup(owner, kind, id) {
  if (kind === "media") return retryOwnerMedia(owner, id);
  const collection = `${P}${kind}`;
  const parent = await owner.collection(collection).get(id);
  if (!parent.data.deleted)
    throw new Error("삭제 중인 자료만 정리할 수 있습니다.");
  const operations = [];
  const mediaDocuments = [];
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
      if (!target.detach)
        mediaDocuments.push({ collection: target.collection, document: child });
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
  if (kind === "characters") {
    let state;
    try {
      state = await owner.collection(`${P}character_state`).get(id);
    } catch (error) {
      if (error.code !== "NOT_FOUND") throw error;
    }
    if (state)
      operations.push({
        collection: `${P}character_state`,
        delete: { id, condition: { revision: state.revision } },
      });
    let profile;
    try {
      profile = await owner
        .collection(`${P}profiles`)
        .get(parent.data.owner ?? parent.createdBy);
    } catch (error) {
      if (error.code !== "NOT_FOUND") throw error;
    }
    if (profile?.data.mainCharacter === id)
      operations.push({
        collection: `${P}profiles`,
        set: {
          id: profile.id,
          data: { ...profile.data, mainCharacter: null },
          condition: { revision: profile.revision },
        },
      });
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
  if (!unfinished) mediaDocuments.push({ collection, document: parent });
  await releaseMediaReferences(owner, mediaDocuments, operations);
  await owner.batch(operations);
  return { done: !unfinished, processed: operations.length - 1 };
}
