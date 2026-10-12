import test from "node:test";
import assert from "node:assert/strict";
import {
  registerMedia,
  communityData,
  claimMedia,
  completeMedia,
  mediaCleanup,
  outfit,
  removeOutfit,
} from "../_naru/functions/neo-avocado.js";
import { retryMemberMedia, retryOwnerMedia } from "../media-cleanup.js";
const P = "neo_avocado_";
const ID = "0190f1a2-0000-7000-8000-000000000001";
const URL = "https://media.naru.pub/image.png";
function fixture() {
  const tables = new Map();
  let n = 0;
  const table = (name) => {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name);
  };
  const ctx = {
    member: { id: "me" },
    now: 1,
    get: (name, id) => structuredClone(table(name).get(id) ?? null),
    set: (name, id, data) => {
      const doc = {
        id,
        data: structuredClone(data),
        createdBy: null,
        revision: `r1.${++n}`,
      };
      table(name).set(id, doc);
      return structuredClone(doc);
    },
    add: (name, data) => ctx.set(name, `doc-${++n}`, data),
    delete: (name, id) => table(name).delete(id),
    list: (name, { filter = {}, size = 50 } = {}) => {
      const docs = [...table(name).values()].filter((doc) =>
        Object.entries(filter).every(([k, v]) => doc.data[k] === v),
      );
      return {
        documents: structuredClone(docs.slice(0, size)),
        nextCursor: docs.length > size ? "more" : null,
      };
    },
  };
  const post = () =>
    communityData(ctx, {
      collection: P + "logs",
      operation: "add",
      data: { image: URL, imageId: ID, board: "default", text: "post" },
    }).document;
  return { ctx, table, post };
}
test("IDs are attached atomically; shared media is queued only after the last post is removed", () => {
  const { ctx, post } = fixture();
  assert.equal(registerMedia(ctx, { id: ID, url: URL }).ok, true);
  const first = post();
  const second = post();
  assert.equal(first.data.imageId, ID);
  assert.equal(mediaCleanup(ctx).files.length, 0);
  communityData(ctx, {
    collection: P + "logs",
    operation: "delete",
    id: first.id,
  });
  assert.equal(mediaCleanup(ctx).files.length, 0);
  assert.equal(claimMedia(ctx, { id: ID }).reason, "media_in_use");
  communityData(ctx, {
    collection: P + "logs",
    operation: "delete",
    id: second.id,
  });
  assert.equal(mediaCleanup(ctx).files.length, 1);
  assert.equal(claimMedia(ctx, { id: ID }).ok, true);
  assert.throws(post, /unavailable/);
  assert.equal(completeMedia(ctx, { id: ID }).ok, true);
});
test("replacement and outfit removal queue old uploads; external and legacy URLs are never inferred", () => {
  const { ctx, post } = fixture();
  registerMedia(ctx, { id: ID, url: URL });
  const doc = post();
  communityData(ctx, {
    collection: P + "logs",
    operation: "set",
    id: doc.id,
    data: {
      ...doc.data,
      image: "https://external.example/new.png",
      imageId: null,
    },
  });
  assert.equal(mediaCleanup(ctx).files.length, 1);
  ctx.set(P + "characters", "hero", { owner: "me", name: "hero" });
  const other = "0190f1a2-0000-7000-8000-000000000002";
  registerMedia(ctx, { id: other, url: URL });
  const clothing = outfit(ctx, {
    character: "hero",
    name: "new",
    image: URL,
    imageId: other,
  }).document;
  removeOutfit(ctx, { id: clothing.id });
  assert.equal(mediaCleanup(ctx).files.length, 2);
});
test("a failed media delete stays claimed and a later visit retries; another member cannot claim it", async () => {
  const { ctx, post } = fixture();
  registerMedia(ctx, { id: ID, url: URL });
  const doc = post();
  communityData(ctx, {
    collection: P + "logs",
    operation: "delete",
    id: doc.id,
  });
  ctx.member.id = "other";
  assert.equal(claimMedia(ctx, { id: ID }).reason, "not_owned");
  ctx.member.id = "me";
  let fail = true;
  let deletes = 0;
  const member = {
    read: async () => mediaCleanup(ctx),
    call: async (name, args) =>
      name.endsWith("claimMedia")
        ? claimMedia(ctx, args)
        : completeMedia(ctx, args),
    media: {
      delete: async () => {
        deletes++;
        if (fail) throw new Error("offline");
      },
    },
  };
  await assert.rejects(retryMemberMedia(member), /offline/);
  assert.equal(ctx.get(P + "media_assets", ID).data.status, "deleting");
  fail = false;
  await retryMemberMedia(member);
  assert.equal(ctx.get(P + "media_assets", ID), null);
  assert.equal(deletes, 2);
});
test("owner recovery refuses referenced media and requires successful deletion before discarding durable work", async () => {
  const { ctx, post } = fixture();
  registerMedia(ctx, { id: ID, url: URL });
  const doc = post();
  let fail = true;
  const owner = {
    collection: (name) => ({
      get: async (id) => {
        const value = ctx.get(name, id);
        if (!value)
          throw Object.assign(new Error("missing"), { code: "NOT_FOUND" });
        return value;
      },
    }),
    batch: async (ops) => {
      for (const op of ops) {
        if (op.set) ctx.set(op.collection, op.set.id, op.set.data);
        else ctx.delete(op.collection, op.delete.id);
      }
    },
    media: {
      delete: async () => {
        if (fail) throw new Error("no grant");
      },
    },
  };
  await assert.rejects(retryOwnerMedia(owner, ID), /사용 중/);
  communityData(ctx, {
    collection: P + "logs",
    operation: "delete",
    id: doc.id,
  });
  await assert.rejects(retryOwnerMedia(owner, ID), /no grant/);
  assert.equal(ctx.get(P + "media_assets", ID).data.status, "deleting");
  fail = false;
  await retryOwnerMedia(owner, ID);
  assert.equal(ctx.get(P + "media_assets", ID), null);
});

test("unattached new uploads have a grace period, so another tab cannot delete an in-progress post image", () => {
  const { ctx } = fixture();
  registerMedia(ctx, { id: ID, url: URL });
  assert.equal(mediaCleanup(ctx).files.length, 0);
  assert.equal(claimMedia(ctx, { id: ID }).reason, "media_in_use");
  ctx.now += 11 * 60_000;
  assert.equal(mediaCleanup(ctx).files.length, 1);
  assert.equal(claimMedia(ctx, { id: ID }).ok, true);
});
