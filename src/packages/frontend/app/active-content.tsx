/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { AccountPage } from "@cocalc/frontend/account/account-page";
import { AdminPage } from "@cocalc/frontend/admin";
import { Alert } from "@cocalc/frontend/antd-bootstrap";
import { normalizeAdminRoute } from "@cocalc/frontend/admin/routing";
import {
  CSS,
  React,
  useActions,
  useTypedRedux,
} from "@cocalc/frontend/app-framework";
import { Icon } from "@cocalc/frontend/components/icon";
import { appBasePath } from "@cocalc/frontend/customize/app-base-path";
import { SiteName } from "@cocalc/frontend/customize";
import { DocsLink } from "@cocalc/frontend/docs/link";
import { DocsPage } from "@cocalc/frontend/docs/page";
import { FileUsePage } from "@cocalc/frontend/file-use/page";
import { Connecting } from "@cocalc/frontend/landing-page/connecting";
import { NotificationPage } from "@cocalc/frontend/notifications";
import { ProjectPage } from "@cocalc/frontend/project/page/page";
import { ProjectsPage } from "@cocalc/frontend/projects/projects-page";
import { parseManagedEgressBlockedError } from "@cocalc/frontend/purchases/managed-egress-blocked";
import { PublicDirectorySharePage } from "@cocalc/frontend/share/public-directory-share-page";
import { SshPage } from "@cocalc/frontend/ssh";
import { KioskModeBanner } from "./kiosk-mode-banner";
import { HostsPage } from "@cocalc/frontend/hosts/hosts-page";
import { AuthPage } from "@cocalc/frontend/auth";
import SiteLicenseClaimPage from "@cocalc/frontend/claim/site-license-page";
import { ManagedEgressBlockedScreen } from "./managed-egress-blocked-screen";
import { joinUrlPath } from "@cocalc/util/url-path";
import { CocalcErrorBoundary } from "./error-boundary";
import { recordSignedInSurfaceReady } from "./bootstrap-ux-latency";

const CONNECTIVITY_DOCS_SLUG = "troubleshooting/connectivity";

const STYLE_SIGNIN_WARNING: CSS = {
  textAlign: "center",
  width: "max(300px, 50vw)",
  marginRight: "auto",
  marginLeft: "auto",
  marginTop: "50px",
} as const;

const STACK_CONTAINER_STYLE: CSS = {
  position: "relative",
  flex: 1,
  minHeight: 0,
  overflow: "hidden",
} as const;

const STACK_LAYER_STYLE: CSS = {
  position: "absolute",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
} as const;

const STACK_LAYER_ACTIVE_STYLE: CSS = {
  opacity: 1,
  pointerEvents: "auto",
  visibility: "visible",
  zIndex: 1,
} as const;

const STACK_LAYER_INACTIVE_STYLE: CSS = {
  opacity: 0,
  pointerEvents: "none",
  visibility: "hidden",
  zIndex: 0,
} as const;

function SurfaceReady({ segment }: { segment: string }) {
  React.useEffect(() => recordSignedInSurfaceReady(segment), [segment]);
  return null;
}

export const ActiveContent: React.FC = React.memo(() => {
  const page_actions = useActions("page");

  const active_top_tab = useTypedRedux("page", "active_top_tab");
  const admin_route = useTypedRedux("page", "admin_route");
  const docs_print = useTypedRedux("page", "docs_print");
  const docs_slug = useTypedRedux("page", "docs_slug");
  const fullscreen = useTypedRedux("page", "fullscreen");
  const get_api_key = useTypedRedux("page", "get_api_key");
  const open_projects = useTypedRedux("projects", "open_projects");
  const share_slug = useTypedRedux("page", "share_slug");

  // initially, we assume a user is signed in – most likely case
  const [notSignedIn, setNotSignedIn] = React.useState<boolean>(false);
  const is_logged_in = useTypedRedux("account", "is_logged_in");
  const managed_egress_blocked_error = useTypedRedux(
    "account",
    "managed_egress_blocked_error",
  );
  const managedEgressBlocked = React.useMemo(
    () => parseManagedEgressBlockedError(managed_egress_blocked_error),
    [managed_egress_blocked_error],
  );

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setNotSignedIn(!is_logged_in);
    }, 5 * 1000);
    return () => clearTimeout(timer);
  });

  const showSignInWarning = React.useMemo(() => {
    return !is_logged_in && notSignedIn;
  }, [is_logged_in, notSignedIn]);

  function renderLayer(
    key: string,
    is_active: boolean,
    content: React.ReactNode,
    errorScope = `app.${key}`,
  ): React.JSX.Element {
    return (
      <div
        key={key}
        className="smc-vfill"
        style={{
          ...STACK_LAYER_STYLE,
          ...(is_active
            ? STACK_LAYER_ACTIVE_STYLE
            : STACK_LAYER_INACTIVE_STYLE),
        }}
        aria-hidden={!is_active}
      >
        <CocalcErrorBoundary
          autoRetry={false}
          scope={errorScope}
          resetKeys={[is_active]}
        >
          {content}
        </CocalcErrorBoundary>
      </div>
    );
  }

  function renderSurfaceLayer(
    key: string,
    content: React.ReactNode,
  ): React.JSX.Element {
    return renderLayer(
      key,
      true,
      <>
        <SurfaceReady segment={key} />
        {content}
      </>,
    );
  }

  const project_layers: React.JSX.Element[] = [];
  open_projects?.forEach((project_id: string) => {
    const is_active = project_id === active_top_tab;
    const x = <ProjectPage project_id={project_id} is_active={is_active} />;
    project_layers.push(renderLayer(project_id, is_active, x, "app.project"));
  });

  if (get_api_key) {
    // Only render the account page which has the message for allowing api access:
    return <AccountPage key={"account"} />;
  }

  function renderProjectLoading(): React.ReactNode {
    // This happens upon loading a URL for a project, but the
    // project isn't open yet.  Implicitly, this waits for a
    // websocket connection. To aid users towards signing up earlier
    // we show a warning box about maybe having to sign in.
    // https://github.com/sagemathinc/cocalc/issues/6092
    return (
      <>
        <Connecting />
        {showSignInWarning ? (
          <div style={STYLE_SIGNIN_WARNING}>
            <Alert bsStyle="warning" banner={false}>
              <Icon style={{ fontSize: "150%" }} name="exclamation-triangle" />
              <br />
              Your browser has not yet been able to connect to the <SiteName />{" "}
              service. You probably have to{" "}
              <a
                onClick={() => page_actions.set_active_tab("account")}
                style={{ fontWeight: "bold" }}
              >
                sign in
              </a>{" "}
              first, or otherwise check if you experience{" "}
              <DocsLink
                href={joinUrlPath(appBasePath, "docs", CONNECTIVITY_DOCS_SLUG)}
                slug={CONNECTIVITY_DOCS_SLUG}
              >
                connectivity issues
              </DocsLink>
              .
            </Alert>
          </div>
        ) : null}
      </>
    );
  }

  const layers: React.JSX.Element[] = [...project_layers];
  let overlay: React.JSX.Element | null = null;

  if (managedEgressBlocked != null) {
    overlay = renderLayer(
      "managed-egress-blocked",
      true,
      <ManagedEgressBlockedScreen blocked={managedEgressBlocked} />,
    );
  } else if (fullscreen == "kiosk" && project_layers.length === 0) {
    // in kiosk mode: if no file is opened show a banner
    overlay = renderLayer("kiosk", true, <KioskModeBanner />);
  } else {
    switch (active_top_tab) {
      case "projects":
        overlay = renderLayer("projects", true, <ProjectsPage />);
        break;
      case "account":
        overlay = renderSurfaceLayer("account", <AccountPage />);
        break;
      case "file-use":
        overlay = renderSurfaceLayer("file-use", <FileUsePage />);
        break;
      case "docs":
        overlay = renderSurfaceLayer(
          "docs",
          <DocsPage print={docs_print} slug={docs_slug} />,
        );
        break;
      case "hosts":
        overlay = renderSurfaceLayer("hosts", <HostsPage />);
        break;
      case "share":
        overlay = renderSurfaceLayer(
          "share",
          <PublicDirectorySharePage slug={share_slug} />,
        );
        break;
      case "ssh":
        overlay = renderSurfaceLayer("ssh", <SshPage />);
        break;
      case "auth":
        overlay = renderSurfaceLayer("auth", <AuthPage />);
        break;
      case "claim":
        overlay = renderSurfaceLayer("claim", <SiteLicenseClaimPage />);
        break;
      case "notifications":
        overlay = renderSurfaceLayer("notifications", <NotificationPage />);
        break;
      case "admin":
        overlay = renderSurfaceLayer(
          "admin",
          <AdminPage route={normalizeAdminRoute(admin_route)} />,
        );
        break;
      case undefined:
        overlay = renderLayer(
          "broken",
          true,
          <div>Please click a button on the top tab.</div>,
        );
        break;
    }
  }

  if (overlay == null && project_layers.length === 0) {
    overlay = renderLayer("project-loading", true, renderProjectLoading());
  }

  if (overlay != null) {
    layers.push(overlay);
  }

  return (
    <div className="smc-vfill" style={STACK_CONTAINER_STYLE}>
      {layers}
    </div>
  );
});
