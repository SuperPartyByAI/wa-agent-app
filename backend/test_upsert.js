const { upsertSessionStatus } = require("./sessions.js");

async function test() {
  console.log("Testing upsert...");
  await upsertSessionStatus("wa_test_123", "AWAITING_QR", "40712345678");
  console.log("Done.");
}

test();
