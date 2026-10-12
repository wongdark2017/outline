import { Memo, User } from "@server/models";
import { allow } from "./cancan";
import { and, isOwner, isTeamModel } from "./utils";
import { MemoVisibility } from "@server/models/Memo";

allow(User, "create", Memo, (actor, memo) => and(isTeamModel(actor, memo)));

allow(User, "read", Memo, (actor, memo) => {
  if (!memo) {
    return false;
  }

  if (!isTeamModel(actor, memo)) {
    return false;
  }

  if (isOwner(actor, memo)) {
    return true;
  }

  return memo.visibility === MemoVisibility.Workspace;
});

allow(User, ["update", "delete", "archive"], Memo, (actor, memo) =>
  and(
    isTeamModel(actor, memo),
    isOwner(actor, memo),
    !actor.isViewer,
    !actor.isGuest
  )
);
