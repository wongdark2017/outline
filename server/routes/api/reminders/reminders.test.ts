import { addDays, subDays } from "date-fns";
import {
    buildDocument,
    buildReminder,
    buildUser,
} from "@server/test/factories";
import { getTestServer } from "@server/test/support";

const server = getTestServer();

describe("#reminders.create", () => {
    it("should create a reminder", async () => {
        const user = await buildUser();
        const document = await buildDocument({
            userId: user.id,
            teamId: user.teamId,
        });

        const res = await server.post("/api/reminders.create", user, {
            body: {
                documentId: document.id,
                remindAt: addDays(new Date(), 1).toISOString(),
                note: "Review before the launch",
            },
        });
        const body = await res.json();

        expect(res.status).toEqual(200);
        expect(body.data.documentId).toEqual(document.id);
        expect(body.data.note).toEqual("Review before the launch");
        expect(body.policies[0].abilities.delete).toBeTruthy();
    });

    it("should reject a time in the past", async () => {
        const user = await buildUser();
        const document = await buildDocument({
            userId: user.id,
            teamId: user.teamId,
        });

        const res = await server.post("/api/reminders.create", user, {
            body: { documentId: document.id, remindAt: subDays(new Date(), 1) },
        });

        expect(res.status).toEqual(400);
    });

    it("should not allow a document in another team", async () => {
        const user = await buildUser();
        const document = await buildDocument(); // a different team

        const res = await server.post("/api/reminders.create", user, {
            body: { documentId: document.id, remindAt: addDays(new Date(), 1) },
        });

        expect(res.status).toEqual(403);
    });

    it("should require authentication", async () => {
        const res = await server.post("/api/reminders.create");
        expect(res.status).toEqual(401);
    });
});

describe("#reminders.delete", () => {
    it("should delete your own reminder", async () => {
        const user = await buildUser();
        const reminder = await buildReminder({ userId: user.id });

        const res = await server.post("/api/reminders.delete", user, {
            body: { id: reminder.id },
        });

        expect(res.status).toEqual(200);
    });

    it("should not delete another user's reminder in the same team", async () => {
        const user = await buildUser();
        const reminder = await buildReminder({ teamId: user.teamId });

        const res = await server.post("/api/reminders.delete", user, {
            body: { id: reminder.id },
        });

        expect(res.status).toEqual(403);
    });
});