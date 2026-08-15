/*
 * This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 * License: MS-RSL - see LICENSE.md for details
 */

import type { AccountProjectListWindowRow } from "@cocalc/conat/hub/api/projects";
import callHub from "@cocalc/conat/hub/call-hub";
import { connect, type Client } from "@cocalc/conat/core/client";
import { initHubApi, type HubApi } from "@cocalc/conat/hub/api";
import { inboxPrefix } from "@cocalc/conat/names";
import {
  ProjectHostClientManager,
  type ProjectHostClientLease,
} from "@cocalc/conat/project-host/client-manager";
import {
  fsClient,
  fsSubject,
  type FilesystemClient,
} from "@cocalc/conat/files/fs";
import type { AuthBootstrap } from "./api";

const CONNECT_TIMEOUT_MS = 15_000;
const START_TIMEOUT_MS = 2 * 60_000;

export interface ProjectFiles {
  filesystem: FilesystemClient;
  lease: ProjectHostClientLease;
}

export class UltraliteSession {
  readonly accountId: string;
  readonly hubApi: HubApi;
  private readonly hubClient: Client;
  private readonly projectHosts: ProjectHostClientManager;

  private constructor({
    accountId,
    hubClient,
    hubApi,
    projectHosts,
  }: {
    accountId: string;
    hubClient: Client;
    hubApi: HubApi;
    projectHosts: ProjectHostClientManager;
  }) {
    this.accountId = accountId;
    this.hubClient = hubClient;
    this.hubApi = hubApi;
    this.projectHosts = projectHosts;
  }

  static async open(bootstrap: AuthBootstrap): Promise<UltraliteSession> {
    const accountId = bootstrap.account_id;
    const homeBayUrl = bootstrap.home_bay_url?.replace(/\/+$/, "");
    if (!accountId || !homeBayUrl) {
      throw new Error("The signed-in account has no home bay route.");
    }
    const hubClient = connect({
      address: homeBayUrl,
      inboxPrefix: inboxPrefix({ account_id: accountId }),
      forceNew: true,
      noCache: true,
      reconnection: true,
    });
    try {
      await hubClient.waitUntilSignedIn({ timeout: CONNECT_TIMEOUT_MS });
      const call = async ({
        name,
        args,
        timeout,
      }: {
        name: string;
        args?: any[];
        timeout?: number;
      }) =>
        await callHub({
          client: hubClient,
          account_id: accountId,
          name,
          args,
          timeout,
        });
      const hubApi = initHubApi(call);
      const projectHosts = new ProjectHostClientManager({
        account_id: accountId,
        api: hubApi.hosts,
        createClient: async ({ address, bearer_token }) => {
          const client = connect({
            address,
            inboxPrefix: inboxPrefix({ account_id: accountId }),
            auth: (callback) => callback({ bearer: bearer_token }),
            forceNew: true,
            noCache: true,
            reconnection: true,
          });
          try {
            await client.waitUntilSignedIn({ timeout: CONNECT_TIMEOUT_MS });
            return client;
          } catch (err) {
            client.close();
            throw err;
          }
        },
        resolveAddress: ({ connection, project_id }) => {
          const direct = connection.connect_url?.trim();
          if (direct) return direct;
          if (connection.local_proxy) return `${homeBayUrl}/${project_id}`;
          return;
        },
      });
      return new UltraliteSession({
        accountId,
        hubClient,
        hubApi,
        projectHosts,
      });
    } catch (err) {
      hubClient.close();
      throw err;
    }
  }

  async listProjects({
    limit = 50,
    offset = 0,
    search,
  }: {
    limit?: number;
    offset?: number;
    search?: string;
  } = {}): Promise<AccountProjectListWindowRow[]> {
    return await this.hubApi.projects.listAccountProjectWindow({
      hidden: false,
      limit,
      offset,
      search: search?.trim() || undefined,
      sort: "last_edited",
    });
  }

  async openProjectHost(
    project_id: string,
    host_id: string,
  ): Promise<ProjectHostClientLease> {
    return await this.projectHosts.getClient({ project_id, host_id });
  }

  async openProjectFiles(
    project_id: string,
    host_id: string,
  ): Promise<ProjectFiles> {
    const lease = await this.openProjectHost(project_id, host_id);
    return {
      lease,
      filesystem: fsClient({
        client: lease.client,
        subject: fsSubject({ project_id }),
      }),
    };
  }

  async ensureProjectRunning(
    projectId: string,
    onState?: (state: string) => void,
  ): Promise<void> {
    let state = await this.hubApi.projects.getProjectState({
      project_id: projectId,
    });
    if (state.state === "running") return;
    if (state.error) throw new Error(state.error);
    onState?.("Starting project...");
    await this.hubApi.projects.start({
      project_id: projectId,
      autostart: true,
      wait: false,
    });
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 750));
      state = await this.hubApi.projects.getProjectState({
        project_id: projectId,
      });
      if (state.state === "running") return;
      if (state.error) throw new Error(state.error);
      onState?.(`Project is ${state.state || "starting"}...`);
    }
    throw new Error("Timed out waiting for the project to start.");
  }

  close(): void {
    this.projectHosts.close();
    this.hubClient.close();
  }
}
