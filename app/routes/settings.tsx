import { Redirect, Switch } from "react-router-dom";
import Error404 from "~/scenes/Errors/Error404";
import { createLazyComponent as lazy } from "~/components/LazyLoad";
import Route from "~/components/ProfiledRoute";
import useCurrentTeam from "~/hooks/useCurrentTeam";
import usePolicy from "~/hooks/usePolicy";
import useSettingsConfig from "~/hooks/useSettingsConfig";
import { settingsPath } from "~/utils/routeHelpers";
import { observer } from "mobx-react";

const Application = lazy(() => import("~/scenes/Settings/Application"));
const GroupMembers = lazy(() => import("~/scenes/Settings/GroupMembers"), {
  exportName: "GroupMembersScene",
});
const Template = lazy(() => import("~/scenes/Settings/Template"));
const TemplateNew = lazy(() => import("~/scenes/Settings/TemplateNew"));

function SettingsRoutes() {
  const configs = useSettingsConfig();
  const team = useCurrentTeam();
  const can = usePolicy(team);

  return (
    <Switch>
      {configs.map((config) => (
        <Route
          exact
          key={config.path}
          path={config.path}
          component={config.component}
        />
      ))}
      <Route
        exact
        path={[settingsPath("theme"), settingsPath("themes")]}
        render={({ location }) => (
          <Redirect
            push={false}
            to={{
              pathname: settingsPath(
                can.update ? "workspace-appearance" : "appearance"
              ),
              search: location.search,
              hash: location.hash,
            }}
          />
        )}
      />
      {/* Members was renamed to Users, redirect for backwards compatibility */}
      <Redirect
        exact
        from={settingsPath("members")}
        to={settingsPath("users")}
      />
      {/* TODO: Refactor these exceptions into config? */}
      <Route
        exact
        path={settingsPath("groups", ":id", "members")}
        component={GroupMembers.Component}
      />
      <Route
        exact
        path={settingsPath("applications", ":id")}
        component={Application.Component}
      />
      <Route
        exact
        path={settingsPath("templates", "new")}
        component={TemplateNew.Component}
      />
      <Route
        exact
        path={settingsPath("templates", ":id")}
        component={Template.Component}
      />
      <Route component={Error404} />
    </Switch>
  );
}

export default observer(SettingsRoutes);
