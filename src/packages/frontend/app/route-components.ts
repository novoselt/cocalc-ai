/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { lazyWithRetry } from "./lazy-with-retry";

export const AccountPage = lazyWithRetry(
  async () => ({
    default: (await import("@cocalc/frontend/account/account-page"))
      .AccountPage,
  }),
  "account route",
);

export const AdminPage = lazyWithRetry(
  async () => ({
    default: (await import("@cocalc/frontend/admin")).AdminPage,
  }),
  "admin route",
);

export const AuthPage = lazyWithRetry(
  async () => ({
    default: (await import("@cocalc/frontend/auth")).AuthPage,
  }),
  "authentication route",
);

export const DocsPage = lazyWithRetry(
  async () => ({
    default: (await import("@cocalc/frontend/docs/page")).DocsPage,
  }),
  "docs route",
);

export const FileUsePage = lazyWithRetry(
  async () => ({
    default: (await import("@cocalc/frontend/file-use/page")).FileUsePage,
  }),
  "file-use route",
);

export const HostsPage = lazyWithRetry(
  async () => ({
    default: (await import("@cocalc/frontend/hosts/hosts-page")).HostsPage,
  }),
  "hosts route",
);

export const NotificationPage = lazyWithRetry(async () => {
  const [{ ensureNotificationsInitialized }, notifications] = await Promise.all(
    [
      import("@cocalc/frontend/notifications/ensure-init"),
      import("@cocalc/frontend/notifications"),
    ],
  );
  await ensureNotificationsInitialized();
  return { default: notifications.NotificationPage };
}, "notifications route");

interface ProjectPageProps {
  is_active: boolean;
  project_id: string;
}

export const ProjectPage = lazyWithRetry<ProjectPageProps>(
  async () => ({
    default: (await import("@cocalc/frontend/project/page/page")).ProjectPage,
  }),
  "project route",
);

export const ProjectsPage = lazyWithRetry(
  async () => ({
    default: (await import("@cocalc/frontend/projects/projects-page"))
      .ProjectsPage,
  }),
  "projects route",
);

export const PublicDirectorySharePage = lazyWithRetry(
  async () => ({
    default: (
      await import("@cocalc/frontend/share/public-directory-share-page")
    ).PublicDirectorySharePage,
  }),
  "public directory share route",
);

export const SiteLicenseClaimPage = lazyWithRetry(
  async () => ({
    default: (await import("@cocalc/frontend/claim/site-license-page")).default,
  }),
  "site license claim route",
);

export const SshPage = lazyWithRetry(
  async () => ({
    default: (await import("@cocalc/frontend/ssh")).SshPage,
  }),
  "SSH route",
);
