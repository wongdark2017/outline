import { User, JournalEntry } from "@server/models";
import { allow } from "./cancan";
import { and, isOwner, isTeamModel } from "./utils";

allow(User, "read", JournalEntry, (actor, entry) =>
  and(isTeamModel(actor, entry), isOwner(actor, entry))
);

allow(User, ["update", "delete"], JournalEntry, (actor, entry) =>
  and(
    isTeamModel(actor, entry),
    isOwner(actor, entry),
    !actor.isViewer,
    !actor.isGuest
  )
);
