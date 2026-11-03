import { Team, Theme, User } from "@server/models";
import { allow } from "./cancan";
import { and, isOwner, isTeamAdmin, isTeamModel, or } from "./utils";

allow(User, "createTheme", Team, (actor, team) =>
  and(isTeamModel(actor, team), !actor.isGuest)
);

allow(User, "read", Theme, isTeamModel);

allow(User, ["update", "delete"], Theme, (actor, theme) =>
  or(isOwner(actor, theme), isTeamAdmin(actor, theme))
);
