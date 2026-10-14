import test from "node:test";
import assert from "node:assert/strict";
import { parseDump, convert } from "../scripts/avocado-import.mjs";
import { importDocuments, runImport } from "../admin-import.js";

const DUMP = `
CREATE TABLE \`avo_member\` (
  \`mb_no\` int(11) NOT NULL,
  \`mb_id\` varchar(20) NOT NULL,
  \`mb_password\` varchar(255) NOT NULL,
  \`mb_nick\` varchar(255) NOT NULL,
  \`mb_level\` tinyint(4) NOT NULL,
  \`mb_point\` int(11) NOT NULL
) ENGINE=MyISAM;
INSERT INTO \`avo_member\` VALUES (1,'alice','*HASH*','앨리스',3,120),(2,'bob','*X*','밥 \\'B\\'',2,0);
CREATE TABLE \`avo_board\` (
  \`bo_table\` varchar(20) NOT NULL,
  \`bo_subject\` varchar(255) NOT NULL,
  \`bo_skin\` varchar(255) NOT NULL,
  \`bo_list_level\` tinyint(4) NOT NULL,
  \`bo_read_level\` tinyint(4) NOT NULL,
  \`bo_write_level\` tinyint(4) NOT NULL,
  \`bo_comment_level\` tinyint(4) NOT NULL,
  \`bo_use_category\` tinyint(4) NOT NULL,
  \`bo_category_list\` text NOT NULL,
  \`bo_use_secret\` tinyint(4) NOT NULL,
  \`bo_use_dhtml_editor\` tinyint(4) NOT NULL
) ENGINE=MyISAM;
INSERT INTO \`avo_board\` VALUES ('log','로그','mmb',1,1,2,2,1,'일상|전투',1,0);
INSERT INTO \`avo_board_file\` (\`bo_table\`, \`wr_id\`, \`bf_no\`, \`bf_file\`) VALUES ('log',1,0,'a.png');
INSERT INTO \`avo_write_log\` (\`wr_id\`,\`wr_num\`,\`wr_parent\`,\`wr_is_comment\`,\`ca_name\`,\`wr_option\`,\`wr_subject\`,\`wr_content\`,\`mb_id\`,\`wr_name\`,\`wr_datetime\`,\`wr_dice1\`,\`wr_dice2\`,\`wr_log\`,\`ch_id\`,\`wr_type\`,\`wr_url\`) VALUES
 (2,-1,1,1,'','','','반가워요 [[앨리스]]','bob','밥','2024-01-01 10:05:00',3,4,'S||S||7||약초||9',5,'',''),
 (1,-1,1,0,'일상','secret','첫 로그','#봄 첫 글\\n둘째 줄','alice','앨리스','2024-01-01 10:00:00',0,0,'',5,'UPLOAD',''),
 (3,-2,3,0,'','','','손님 글','','길손','2024-01-02 09:00:00',0,0,'',0,'URL','http://insecure.example/x.png');
CREATE TABLE \`avo_character\` (
  \`ch_id\` int(11) NOT NULL,
  \`ch_name\` varchar(255) NOT NULL,
  \`ch_head\` varchar(255) NOT NULL,
  \`mb_id\` varchar(255) NOT NULL,
  \`ch_side\` varchar(255) NOT NULL,
  \`ch_class\` varchar(255) NOT NULL,
  \`ch_exp\` int(11) NOT NULL,
  \`ch_point\` int(11) NOT NULL,
  \`ch_type\` varchar(255) NOT NULL,
  \`ch_state\` varchar(255) NOT NULL
) ENGINE=MyISAM;
INSERT INTO \`avo_character\` VALUES (5,'용사','http://old.example/data/character/5.png','alice','1','0',30,2,'main','승인');
INSERT INTO \`avo_character_side\` (\`si_id\`,\`si_name\`) VALUES (1,'동쪽');
INSERT INTO \`avo_article\` (\`ar_id\`,\`ar_code\`,\`ar_name\`,\`ar_type\`,\`ar_text\`,\`ar_help\`,\`ar_order\`,\`ar_secret\`) VALUES (1,'age','나이','text','','',1,''),(2,'ch_pic','전신','file','','',2,'S');
INSERT INTO \`avo_article_value\` (\`ch_id\`,\`ar_code\`,\`av_value\`) VALUES (5,'age','17'),(5,'ch_pic','/data/article/5.png');
INSERT INTO \`avo_menu\` (\`me_id\`,\`me_code\`,\`me_name\`,\`me_link\`,\`me_target\`,\`me_order\`,\`me_use\`,\`me_mobile_use\`) VALUES (1,'10','로그','/bbs/board.php?bo_table=log','self',0,1,1),(2,'1010','소개','/bbs/content.php?co_id=about','blank',1,1,0),(3,'20','옛 링크','/old.php','self',0,1,1);
`;

test("a dump converts to neo-avocado documents with mapped members and stable ids", () => {
  const tables = parseDump(DUMP);
  assert.equal(tables.get("avo_member")[1].mb_nick, "밥 'B'");
  assert.equal(tables.get("avo_write_log")[1].wr_content, "#봄 첫 글\n둘째 줄");
  const { documents, warnings, unmapped } = convert(tables, {
    members: { alice: "naru-alice" },
    mediaBase: "https://files.example.com/",
  });
  const doc = (collection, id) =>
    documents.find(
      (row) => row.collection === `neo_avocado_${collection}` && row.id === id,
    )?.data;
  // No password, e-mail or IP reaches a document.
  assert.equal(JSON.stringify(documents).includes("HASH"), false);
  assert.deepEqual(unmapped, ["bob"]);
  assert.deepEqual(doc("profiles", "naru-alice"), {
    owner: "naru-alice",
    nick: "앨리스",
    acceptMessages: true,
    commentAlerts: true,
  });
  assert.deepEqual(doc("wallets", "naru-alice"), {
    balance: 120,
    lastDaily: null,
  });
  assert.equal(doc("members", "naru-alice").level, 3);
  assert.deepEqual(doc("boards", "log"), {
    name: "로그",
    description: "",
    kind: "image",
    enabled: true,
    listLevel: 1,
    readLevel: 1,
    writeLevel: 2,
    commentLevel: 2,
    categories: ["일상", "전투"],
    secret: "optional",
    html: false,
    actions: true,
  });
  const log = doc("logs", "av-log-1");
  assert.equal(log.owner, "naru-alice");
  assert.equal(log.secret, true);
  assert.equal(log.number, 1);
  assert.equal(log.image, "https://files.example.com/data/file/log/a.png");
  assert.deepEqual(log.tags, ["봄"]);
  assert.equal(log.speaker.name, "용사");
  assert.equal(log.postedAt, Date.parse("2024-01-01T01:00:00Z"));
  const comment = doc("comments", "av-log-2");
  assert.equal(comment.logId, "av-log-1");
  assert.deepEqual(comment.importedAuthor, { name: "밥 'B'" });
  assert.deepEqual(comment.rolls, [3, 4]);
  assert.equal(comment.actions[0].type, "explore");
  const guest = doc("logs", "av-log-3");
  assert.deepEqual(guest.guest, { name: "길손" });
  assert.equal(guest.image, null);
  assert.ok(warnings.some((line) => line.includes("insecure.example")));
  // Logs come out oldest first so createdAt keeps their order.
  const order = documents
    .filter((row) => row.collection.endsWith("_logs"))
    .map((row) => row.id);
  assert.deepEqual(order, ["av-log-1", "av-log-3"]);
  assert.deepEqual(doc("counters", "log"), { next: 3 });
  const character = doc("characters", "av-ch-5");
  assert.equal(character.state, "approved");
  assert.equal(character.side, "동쪽");
  assert.equal(
    character.image,
    "https://files.example.com/data/character/5.png",
  );
  assert.deepEqual(character.fields, {
    age: "17",
    ch_pic: "https://files.example.com/data/article/5.png",
  });
  assert.equal(doc("character_fields", "ch_pic").type, "image");
  assert.equal(doc("character_fields", "ch_pic").visibility, "owner");
  assert.equal(doc("character_state", "av-ch-5").approved, true);
  assert.equal(doc("menus", "av-me-1").link, "board:log");
  assert.equal(doc("menus", "av-me-2").parent, "av-me-1");
  assert.equal(doc("menus", "av-me-2").link, "content:about");
  assert.equal(doc("menus", "av-me-3"), undefined);
});

test("the owner's import writes only absent documents in atomic batches and resumes", async () => {
  const documents = importDocuments({
    format: "neo-avocado-import",
    version: 1,
    documents: Array.from({ length: 30 }, (_, n) => ({
      collection: "neo_avocado_logs",
      id: `av-log-${n}`,
      data: { text: String(n) },
    })),
  });
  assert.throws(() =>
    importDocuments({
      format: "neo-avocado-import",
      version: 1,
      documents: [{ collection: "neo_avocado_secrets", id: "x", data: {} }],
    }),
  );
  const stored = new Map([["av-log-3", {}]]);
  const batches = [];
  const owner = {
    collection: () => ({
      getMany: async (ids) => ids.map((id) => stored.get(id) ?? null),
    }),
    batch: async (writes) => {
      batches.push(writes.length);
      for (const write of writes) {
        assert.deepEqual(write.set.condition, { absent: true });
        stored.set(write.set.id, write.set.data);
      }
    },
  };
  assert.deepEqual(await runImport(owner, documents), {
    written: 29,
    skipped: 1,
  });
  assert.deepEqual(batches, [24, 5]);
  assert.deepEqual(await runImport(owner, documents), {
    written: 0,
    skipped: 30,
  });
});
