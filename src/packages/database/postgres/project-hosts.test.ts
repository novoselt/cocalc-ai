/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import getPool, { initEphemeralDatabase } from "@cocalc/database/pool";
import { testCleanup } from "@cocalc/database/test-utils";
import { upsertProjectHost } from "./project-hosts";

const HOST_ID = "7a1e7841-a2d0-461f-83f0-6f1dcc44174a";

describe("upsertProjectHost", () => {
  beforeAll(async () => {
    await initEphemeralDatabase({});
  }, 15_000);

  afterAll(async () => {
    await testCleanup();
  });

  beforeEach(async () => {
    await getPool().query("DELETE FROM project_hosts WHERE id=$1", [HOST_ID]);
  });

  it("preserves hub-owned runtime deployment metadata across observations", async () => {
    await upsertProjectHost({
      id: HOST_ID,
      status: "running",
      metadata: {
        runtime_health: { status: "starting", ready: false },
        runtime_deployments: {
          planned_project_host_transition: { operation_id: "untrusted" },
        },
      },
    });

    await getPool().query(
      `UPDATE project_hosts
       SET metadata=jsonb_set(
         metadata,
         '{runtime_deployments}',
         $2::jsonb,
         true
       )
       WHERE id=$1`,
      [
        HOST_ID,
        JSON.stringify({
          planned_project_host_transition: {
            operation_id: "control-plane-operation",
          },
          pending_automatic_convergence_retry: { runtime: true },
        }),
      ],
    );

    await upsertProjectHost({
      id: HOST_ID,
      status: "running",
      metadata: {
        runtime_health: { status: "ready", ready: true },
        runtime_deployments: {
          planned_project_host_transition: { operation_id: "stale-host" },
        },
      },
    });

    const { rows } = await getPool().query(
      "SELECT metadata FROM project_hosts WHERE id=$1",
      [HOST_ID],
    );
    expect(rows[0]?.metadata).toMatchObject({
      runtime_health: { status: "ready", ready: true },
      runtime_deployments: {
        planned_project_host_transition: {
          operation_id: "control-plane-operation",
        },
        pending_automatic_convergence_retry: { runtime: true },
      },
    });
  });
});
