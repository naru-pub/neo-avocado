// What the admin's forms pick from, in one read: characters, titles, stats,
// items, members (by nickname), 소속, 종족, board groups, boards and the
// profile fields, each as { id, data }.

import { ownerOnly } from "../../modules/access.js";
import { catalogues } from "../../modules/admin.js";
import {
  definitionDocument,
  fieldCatalogue,
} from "../../modules/characters.js";
import type { QueryCtx } from "../../modules/naru-types.js";

export const references = ownerOnly(async function references(ctx: QueryCtx) {
  return {
    ...(await catalogues(ctx, [
      "characters",
      "titles",
      "stats",
      "items",
      "profiles",
      "sides",
      "classes",
      "groups",
      "boards",
    ])),
    fields: (await fieldCatalogue(ctx)).map(definitionDocument),
  };
});
