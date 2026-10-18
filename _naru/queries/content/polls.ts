// 설문조사 (poll.skin.php, poll_result.php): the newest poll in use, read
// again after a vote (the site frame carries it on arrival).
import { latestPoll } from "../../modules/polls.js";
import type { QueryCtx } from "../../modules/naru-types.js";

export const latest = (ctx: QueryCtx) => latestPoll(ctx);
