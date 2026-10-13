import test from "node:test";
import assert from "node:assert/strict";
import {
  registerMedia,
  communityData,
  cleanupMedia,
  mediaCleanup,
  outfit,
  removeOutfit,
} from "../_naru/modules/index.js";
import { retryMemberMedia, retryOwnerMedia } from "../media-cleanup.js";
import { matches } from "./where.mjs";
const P = "neo_avocado_";
const ID = "0190f1a2-0000-7000-8000-000000000001";
const URL = "https://media.naru.pub/image.png";
function fixture() {
  const tables = new Map();
  let n = 0;
  const released = [];
  const table = (name) => {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name);
  };
  const ctx = {
    member: { id: "me" },
    now: 1,
    fail: (code, message, details) => {
      throw Object.assign(new Error(message), { code, details });
    },
    media: { delete: async (id) => released.push(id) },
    broadcast: () => {},
    get: async (name, id) => structuredClone(table(name).get(id) ?? null),
    set: async (name, id, data) => {
      const doc = {
        id,
        data: structuredClone(data),
        createdBy: null,
        revision: `r1.${++n}`,
      };
      table(name).set(id, doc);
      return structuredClone(doc);
    },
    add: async (name, data) => await ctx.set(name, `doc-${++n}`, data),
    delete: async (name, id) => table(name).delete(id),
    list: async (name, { filter = {}, where, size = 50 } = {}) => {
      const docs = [...table(name).values()].filter(
        (doc) =>
          Object.entries(filter).every(([k, v]) => doc.data[k] === v) &&
          matches(doc, where),
      );
      return {
        documents: structuredClone(docs.slice(0, size)),
        nextCursor: docs.length > size ? "more" : null,
      };
    },
  };
  const post = async () =>
    (
      await communityData(ctx, {
        collection: P + "logs",
        operation: "add",
        data: { image: URL, imageId: ID, board: "default", text: "post" },
      })
    ).document;
  return { ctx, table, post, released };
}
test("IDs are attached atomically; shared media is deleted with the last post that used it", async () => {
  const { ctx, post, released } = fixture();
  assert.equal((await registerMedia(ctx, { id: ID, url: URL })).ok, true);
  const first = await post();
  const second = await post();
  assert.equal(first.data.imageId, ID);
  await communityData(ctx, {
    collection: P + "logs",
    operation: "delete",
    id: first.id,
  });
  assert.deepEqual((await ctx.get(P + "media_assets", ID)).data.refs, [
    `${P}logs/${second.id}`,
  ]);
  assert.deepEqual(released, []);
  await communityData(ctx, {
    collection: P + "logs",
    operation: "delete",
    id: second.id,
  });
  // The ledger row goes and the upload's deletion is queued in the same call.
  assert.equal(await ctx.get(P + "media_assets", ID), null);
  assert.deepEqual(released, [ID]);
  await assert.rejects(post, (error) => {
    assert.equal(error.code, "CONFLICT");
    assert.equal(error.details.reason, "media_unavailable");
    return true;
  });
});
test("replacement and outfit removal delete old uploads; external and legacy URLs are never inferred", async () => {
  const { ctx, post, released } = fixture();
  await registerMedia(ctx, { id: ID, url: URL });
  const doc = await post();
  await communityData(ctx, {
    collection: P + "logs",
    operation: "set",
    id: doc.id,
    data: {
      ...doc.data,
      image: "https://external.example/new.png",
      imageId: null,
    },
  });
  assert.deepEqual(released, [ID]);
  await ctx.set(P + "characters", "hero", { owner: "me", name: "hero" });
  const other = "0190f1a2-0000-7000-8000-000000000002";
  await registerMedia(ctx, { id: other, url: URL });
  const clothing = (
    await outfit(ctx, {
      character: "hero",
      name: "new",
      image: URL,
      imageId: other,
    })
  ).document;
  await removeOutfit(ctx, { id: clothing.id });
  assert.deepEqual(released, [ID, other]);
  assert.equal((await mediaCleanup(ctx)).files.length, 0);
});
test("owner recovery refuses referenced media and requires successful deletion before discarding durable work", async () => {
  const { ctx, post } = fixture();
  await registerMedia(ctx, { id: ID, url: URL });
  const doc = await post();
  let fail = true;
  const owner = {
    collection: (name) => ({
      get: async (id) => {
        const value = await ctx.get(name, id);
        if (!value)
          throw Object.assign(new Error("missing"), { code: "NOT_FOUND" });
        return value;
      },
    }),
    batch: async (ops) => {
      for (const op of ops) {
        if (op.set) await ctx.set(op.collection, op.set.id, op.set.data);
        else await ctx.delete(op.collection, op.delete.id);
      }
    },
    media: {
      delete: async () => {
        if (fail) throw new Error("no grant");
      },
    },
  };
  await assert.rejects(retryOwnerMedia(owner, ID), /사용 중/);
  // Owner recovery still handles rows released before transactional deletes.
  const asset = await ctx.get(P + "media_assets", ID);
  await ctx.set(P + "media_assets", ID, {
    ...asset.data,
    refs: [],
    status: "pending",
    cleanup: true,
    cleanupAfter: 0,
  });
  await assert.rejects(retryOwnerMedia(owner, ID), /no grant/);
  assert.equal((await ctx.get(P + "media_assets", ID)).data.status, "deleting");
  fail = false;
  await retryOwnerMedia(owner, ID);
  assert.equal(await ctx.get(P + "media_assets", ID), null);
});

test("unattached uploads have a grace period, then only their uploader's cleanup deletes them", async () => {
  const { ctx, released } = fixture();
  await registerMedia(ctx, { id: ID, url: URL });
  const member = {
    call: async (name) =>
      name.endsWith(":mediaCleanup")
        ? await mediaCleanup(ctx)
        : await cleanupMedia(ctx),
  };
  assert.equal((await mediaCleanup(ctx)).files.length, 0);
  assert.deepEqual(await retryMemberMedia(member), {
    completed: 0,
    remaining: false,
  });
  ctx.now += 11 * 60_000;
  ctx.member.id = "other";
  assert.equal((await cleanupMedia(ctx)).completed, 0);
  ctx.member.id = "me";
  assert.equal((await mediaCleanup(ctx)).files.length, 1);
  assert.deepEqual(await retryMemberMedia(member), {
    completed: 1,
    remaining: false,
  });
  assert.equal(await ctx.get(P + "media_assets", ID), null);
  assert.deepEqual(released, [ID]);
});
test("rows the old claim flow left as deleting are finished by the member's cleanup", async () => {
  const { ctx, released } = fixture();
  await ctx.set(P + "media_assets", ID, {
    owner: "me",
    url: URL,
    refs: [],
    status: "deleting",
    cleanup: true,
    cleanupAfter: 0,
  });
  assert.equal((await cleanupMedia(ctx)).completed, 1);
  assert.deepEqual(released, [ID]);
});
