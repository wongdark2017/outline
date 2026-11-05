// Run from the repository root with the same database/storage environment as the acceptance server.
const { createRequire } = require("node:module");
const { resolve } = require("node:path");
const { existsSync, readFileSync, writeFileSync, unlinkSync } = require("node:fs");
const { randomUUID } = require("node:crypto");
const fromRepo = createRequire(resolve(process.cwd(), "package.json"));
fromRepo("reflect-metadata");
fromRepo("./build/server/scripts/bootstrap");
const { sequelize } = fromRepo("./build/server/storage/database");
const { Team, User, Document, Attachment, Share, Event } = fromRepo("./build/server/models");
const privateFile = process.env.TIKZ_FIXTURE_PATH || "/tmp/outline-tikz-acceptance-private.json";

async function main() {
  if (process.argv[2] !== "cleanup") {
    if (existsSync(privateFile)) {
      throw new Error("Fixture credentials already exist; clean up that fixture first.");
    }
    const { buildTeam, buildAdmin, buildViewer, buildCollection, buildDocument } = fromRepo("./build/server/test/factories");
    const tag = randomUUID().slice(0, 8);
    const team = await buildTeam({ name: `TikZ acceptance ${tag}` });
    const admin = await buildAdmin({ teamId: team.id, email: `tikz-admin-${tag}@example.invalid`, name: "TikZ Acceptance", language: "zh_CN" });
    const reader = await buildViewer({ teamId: team.id, email: `tikz-reader-${tag}@example.invalid`, name: "TikZ Reader", language: "zh_CN" });
    const collection = await buildCollection({ teamId: team.id, userId: admin.id, name: "TikZ 验收" });
    const document = await buildDocument({ teamId: team.id, userId: admin.id, collectionId: collection.id, title: "TikZ 浏览器验收", text: "TikZ browser acceptance fixture.\n\nInsert a diagram below." });
    writeFileSync(privateFile, JSON.stringify({ teamId: team.id, adminId: admin.id, readerId: reader.id, collectionId: collection.id, documentId: document.id, documentPath: document.path, adminToken: admin.getSessionToken(), readerToken: reader.getSessionToken() }), { mode: 0o600, flag: "wx" });
    console.log("Isolated fixture created. Credentials remain in the private file.");
    return;
  }
  const fixture = JSON.parse(readFileSync(privateFile, "utf8"));
  const team = await Team.findByPk(fixture.teamId);
  const admin = await User.findByPk(fixture.adminId);
  if (!team?.name.startsWith("TikZ acceptance ") || admin?.teamId !== team.id || !admin.email.startsWith("tikz-admin-")) {
    throw new Error("Refusing to clean up an unrecognized fixture.");
  }
  await Attachment.destroy({ where: { teamId: team.id }, individualHooks: true, force: true });
  await Event.destroy({ where: { teamId: team.id }, force: true });
  await Share.destroy({ where: { teamId: team.id }, force: true });
  for (const table of ["authentications", "groups", "search_queries", "authentication_providers", "imports"]) {
    await sequelize.query('DELETE FROM "' + table + '" WHERE "teamId" = :teamId', { replacements: { teamId: team.id } });
  }
  await Team.destroy({ where: { id: team.id }, force: true });
  if (await Team.findByPk(fixture.teamId, { paranoid: false }) || await Document.findByPk(fixture.documentId, { paranoid: false })) {
    throw new Error("Fixture cleanup incomplete.");
  }
  unlinkSync(privateFile);
  console.log("Isolated fixture and private credentials removed.");
}
main().then(async () => { await sequelize.close(); process.exit(0); }).catch((error) => { console.error(error.message); process.exit(1); });
