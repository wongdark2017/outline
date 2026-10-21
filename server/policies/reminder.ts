import { Reminder, User } from "@server/models";
import { allow } from "./cancan";
import { and, isOwner, isTeamModel } from "./utils";

allow(User, ["read", "update", "delete"], Reminder, (actor, reminder) =>
    and(isTeamModel(actor, reminder), isOwner(actor, reminder))
);