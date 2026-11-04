import {
  CustomizationAsset,
  CustomizationScriptRevision,
  Team,
  User,
} from "@server/models";
import { allow } from "./cancan";
import { isTeamAdmin, isTeamModel } from "./utils";

allow(User, "readCustomizations", Team, isTeamModel);
allow(User, "manageCustomizations", Team, isTeamAdmin);
allow(
  User,
  "updateCustomizations",
  User,
  (actor, user) => !!user && actor.id === user.id
);
allow(User, "read", CustomizationScriptRevision, isTeamModel);
allow(
  User,
  "read",
  CustomizationAsset,
  (actor, asset) =>
    !!asset &&
    actor.teamId === asset.teamId &&
    (asset.scope === "workspace" || asset.userId === actor.id)
);
