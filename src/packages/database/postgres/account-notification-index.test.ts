/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import getPool, { initEphemeralDatabase } from "@cocalc/database/pool";
import { testCleanup } from "@cocalc/database/test-utils";
import {
  getProjectedNotificationCounts,
  listProjectedNotificationSnapshotForAccount,
  listProjectedNotificationsForAccount,
  markProjectedNotificationsReadThrough,
  rebuildAccountNotificationIndex,
  setProjectedNotificationArchivedState,
  setProjectedNotificationReadState,
  setProjectedNotificationSavedState,
} from "./account-notification-index";

const LOCAL_BAY_ID = "bay-local";
const OTHER_BAY_ID = "bay-other";
const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE_ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_A = "33333333-3333-4333-8333-333333333333";
const PROJECT_B = "44444444-4444-4444-8444-444444444444";

describe("account_notification_index rebuild", () => {
  beforeAll(async () => {
    await initEphemeralDatabase({});
  }, 15000);

  afterEach(async () => {
    await getPool().query(
      "TRUNCATE account_notification_index, mentions, projects, accounts CASCADE",
    );
  });

  afterAll(async () => {
    await testCleanup();
  });

  async function seedBaseRows(home_bay_id = LOCAL_BAY_ID): Promise<void> {
    const unreadTime = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const savedTime = new Date(Date.now() - 60 * 60 * 1000);
    await getPool().query(
      `INSERT INTO accounts
         (account_id, first_name, last_name, created, email_address, home_bay_id)
       VALUES
         ($1, 'Target', 'User', NOW(), 'target@example.com', $4),
         ($2, 'Source', 'User', NOW(), 'source@example.com', $4),
         ($3, 'Other', 'User', NOW(), 'other@example.com', $5)`,
      [
        ACCOUNT_ID,
        SOURCE_ACCOUNT_ID,
        "55555555-5555-4555-8555-555555555555",
        home_bay_id,
        OTHER_BAY_ID,
      ],
    );
    await getPool().query(
      `INSERT INTO projects
         (project_id, title, users, owning_bay_id, created, last_edited, deleted)
       VALUES
         ($1, 'Project A', $3::JSONB, $4, NOW(), NOW(), FALSE),
         ($2, 'Project B', $3::JSONB, $4, NOW(), NOW(), FALSE)`,
      [
        PROJECT_A,
        PROJECT_B,
        JSON.stringify({
          [SOURCE_ACCOUNT_ID]: { group: "owner" },
          [ACCOUNT_ID]: { group: "collaborator" },
        }),
        LOCAL_BAY_ID,
      ],
    );
    await getPool().query(
      `INSERT INTO mentions
         (time, project_id, path, source, target, description, fragment_id, priority, users)
       VALUES
         ($1, $3, 'chat/a.md', $2, $4, 'unread mention', 'chat=true,id=a', 1,
          $5::JSONB),
         ($6, $7, 'chat/b.md', $2, $4, 'saved mention', 'chat=true,id=b', 2,
          $8::JSONB)`,
      [
        unreadTime,
        SOURCE_ACCOUNT_ID,
        PROJECT_A,
        ACCOUNT_ID,
        JSON.stringify({
          [ACCOUNT_ID]: { read: false, saved: false },
        }),
        savedTime,
        PROJECT_B,
        JSON.stringify({
          [ACCOUNT_ID]: { read: true, saved: true },
        }),
      ],
    );
  }

  it("rebuilds projected mention notifications for a home-bay account", async () => {
    await seedBaseRows();

    await expect(
      rebuildAccountNotificationIndex({
        account_id: ACCOUNT_ID,
        bay_id: LOCAL_BAY_ID,
      }),
    ).resolves.toMatchObject({
      bay_id: LOCAL_BAY_ID,
      target_account_id: ACCOUNT_ID,
      dry_run: true,
      existing_rows: 0,
      source_rows: 2,
      unread_rows: 1,
      saved_rows: 1,
      deleted_rows: 0,
      inserted_rows: 0,
    });

    await expect(
      rebuildAccountNotificationIndex({
        account_id: ACCOUNT_ID,
        bay_id: LOCAL_BAY_ID,
        dry_run: false,
      }),
    ).resolves.toMatchObject({
      bay_id: LOCAL_BAY_ID,
      target_account_id: ACCOUNT_ID,
      dry_run: false,
      existing_rows: 0,
      source_rows: 2,
      unread_rows: 1,
      saved_rows: 1,
      deleted_rows: 0,
      inserted_rows: 2,
    });

    await expect(
      listProjectedNotificationsForAccount({
        account_id: ACCOUNT_ID,
        limit: 10,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        kind: "mention",
        project_id: PROJECT_B,
        summary: expect.objectContaining({
          path: "chat/b.md",
          description: "saved mention",
        }),
        read_state: {
          read: true,
          saved: true,
        },
      }),
      expect.objectContaining({
        kind: "mention",
        project_id: PROJECT_A,
        summary: expect.objectContaining({
          path: "chat/a.md",
          description: "unread mention",
        }),
        read_state: {
          read: false,
          saved: false,
        },
      }),
    ]);
  });

  it("rejects accounts homed in another bay", async () => {
    await seedBaseRows(OTHER_BAY_ID);

    await expect(
      rebuildAccountNotificationIndex({
        account_id: ACCOUNT_ID,
        bay_id: LOCAL_BAY_ID,
      }),
    ).rejects.toThrow(
      `account '${ACCOUNT_ID}' is not homed in bay '${LOCAL_BAY_ID}'`,
    );
  });

  it("supports inbox state filters, counts, and markRead updates", async () => {
    await seedBaseRows();
    await rebuildAccountNotificationIndex({
      account_id: ACCOUNT_ID,
      bay_id: LOCAL_BAY_ID,
      dry_run: false,
    });

    const allRows = await listProjectedNotificationsForAccount({
      account_id: ACCOUNT_ID,
      limit: 10,
      state: "all",
    });
    expect(allRows).toHaveLength(2);

    await expect(
      listProjectedNotificationsForAccount({
        account_id: ACCOUNT_ID,
        state: "unread",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        project_id: PROJECT_A,
        read_state: {
          read: false,
          saved: false,
        },
      }),
    ]);

    await expect(
      listProjectedNotificationsForAccount({
        account_id: ACCOUNT_ID,
        state: "saved",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        project_id: PROJECT_B,
        read_state: {
          read: true,
          saved: true,
        },
      }),
    ]);

    await expect(
      getProjectedNotificationCounts({
        account_id: ACCOUNT_ID,
      }),
    ).resolves.toEqual({
      total: 2,
      unread: 1,
      saved: 1,
      archived: 0,
      by_kind: {
        mention: {
          total: 2,
          unread: 1,
          saved: 1,
          archived: 0,
        },
      },
    });

    await expect(
      setProjectedNotificationReadState({
        account_id: ACCOUNT_ID,
        notification_ids: [
          allRows[0].notification_id,
          allRows[1].notification_id,
        ],
        read: true,
      }),
    ).resolves.toEqual({
      updated_count: 2,
      notification_ids: [
        allRows[0].notification_id,
        allRows[1].notification_id,
      ].sort(),
    });

    await expect(
      getProjectedNotificationCounts({
        account_id: ACCOUNT_ID,
      }),
    ).resolves.toEqual({
      total: 2,
      unread: 0,
      saved: 1,
      archived: 0,
      by_kind: {
        mention: {
          total: 2,
          unread: 0,
          saved: 1,
          archived: 0,
        },
      },
    });

    await expect(
      setProjectedNotificationSavedState({
        account_id: ACCOUNT_ID,
        notification_ids: [allRows[1].notification_id],
        saved: true,
      }),
    ).resolves.toEqual({
      updated_count: 1,
      notification_ids: [allRows[1].notification_id],
    });

    await expect(
      listProjectedNotificationsForAccount({
        account_id: ACCOUNT_ID,
        state: "saved",
      }),
    ).resolves.toHaveLength(2);

    await expect(
      setProjectedNotificationArchivedState({
        account_id: ACCOUNT_ID,
        notification_ids: [allRows[1].notification_id],
        archived: true,
      }),
    ).resolves.toEqual({
      updated_count: 1,
      notification_ids: [allRows[1].notification_id],
    });

    await expect(
      listProjectedNotificationsForAccount({
        account_id: ACCOUNT_ID,
        state: "archived",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        notification_id: allRows[1].notification_id,
      }),
    ]);

    await expect(
      getProjectedNotificationCounts({
        account_id: ACCOUNT_ID,
      }),
    ).resolves.toEqual({
      total: 2,
      unread: 0,
      saved: 1,
      archived: 1,
      by_kind: {
        mention: {
          total: 2,
          unread: 0,
          saved: 1,
          archived: 1,
        },
      },
    });
  });

  it("marks an entire project read without clearing notifications after the snapshot", async () => {
    await seedBaseRows();

    const notificationIds = Array.from(
      { length: 301 },
      (_, i) => `90000000-0000-4000-8000-${`${i}`.padStart(12, "0")}`,
    );
    for (let start = 0; start < notificationIds.length; start += 100) {
      const chunk = notificationIds.slice(start, start + 100);
      const params: unknown[] = [ACCOUNT_ID, PROJECT_A];
      const values = chunk.map((notification_id) => {
        params.push(notification_id);
        return `($1, $${params.length}::UUID, 'mention', $2, '{}'::JSONB,
                 '{}'::JSONB, NOW(), NOW())`;
      });
      await getPool().query(
        `INSERT INTO account_notification_index
           (account_id, notification_id, kind, project_id, summary, read_state,
            created_at, updated_at)
         VALUES ${values.join(", ")}`,
        params,
      );
    }
    await getPool().query(
      `UPDATE account_notification_index
          SET revision = NULL
        WHERE account_id = $1
          AND notification_id = $2`,
      [ACCOUNT_ID, notificationIds[0]],
    );
    await getPool().query(
      `INSERT INTO account_notification_index
         (account_id, notification_id, kind, project_id, summary, read_state,
          created_at, updated_at)
       VALUES
         ($1, '91000000-0000-4000-8000-000000000001', 'account_notice', NULL,
          '{}'::JSONB, '{}'::JSONB, NOW(), NOW()),
         ($1, '91000000-0000-4000-8000-000000000002', 'mention', $2,
          '{}'::JSONB, '{}'::JSONB, NOW(), NOW()),
         ($1, '91000000-0000-4000-8000-000000000003', 'mention', $3,
          '{}'::JSONB, '{"archived":true}'::JSONB, NOW(), NOW())`,
      [ACCOUNT_ID, PROJECT_B, PROJECT_A],
    );

    const snapshot = await listProjectedNotificationSnapshotForAccount({
      account_id: ACCOUNT_ID,
      project_id: PROJECT_A,
      state: "unread",
      limit: 300,
    });
    expect(snapshot.rows).toHaveLength(300);

    const lateNotificationId = "92000000-0000-4000-8000-000000000001";
    await getPool().query(
      `INSERT INTO account_notification_index
         (account_id, notification_id, kind, project_id, summary, read_state,
          created_at, updated_at)
       VALUES ($1, $2, 'mention', $3, '{}'::JSONB, '{}'::JSONB, NOW(), NOW())`,
      [ACCOUNT_ID, lateNotificationId, PROJECT_A],
    );

    await expect(
      markProjectedNotificationsReadThrough({
        account_id: ACCOUNT_ID,
        project_id: PROJECT_A,
        read_through_revision: snapshot.read_through_revision,
      }),
    ).resolves.toEqual({ updated_count: 301 });

    const { rows } = await getPool().query<{
      initial_unread: number;
      late_unread: boolean;
      general_unread: boolean;
      other_project_unread: boolean;
      archived_read: boolean;
      legacy_row_read: boolean;
      late_revision: string;
    }>(
      `SELECT
         COUNT(*) FILTER (
           WHERE project_id = $2
             AND notification_id <> $3
             AND COALESCE((read_state ->> 'archived')::BOOLEAN, FALSE) IS NOT TRUE
             AND COALESCE((read_state ->> 'read')::BOOLEAN, FALSE) IS NOT TRUE
         )::INT AS initial_unread,
         BOOL_OR(
           notification_id = $3
           AND COALESCE((read_state ->> 'read')::BOOLEAN, FALSE) IS NOT TRUE
         ) AS late_unread,
         BOOL_OR(
           project_id IS NULL
           AND COALESCE((read_state ->> 'read')::BOOLEAN, FALSE) IS NOT TRUE
         ) AS general_unread,
         BOOL_OR(
           project_id = $4
           AND COALESCE((read_state ->> 'read')::BOOLEAN, FALSE) IS NOT TRUE
         ) AS other_project_unread,
         BOOL_OR(
           notification_id = '91000000-0000-4000-8000-000000000003'
           AND COALESCE((read_state ->> 'read')::BOOLEAN, FALSE) IS TRUE
         ) AS archived_read,
         BOOL_OR(
           notification_id = $5
           AND COALESCE((read_state ->> 'read')::BOOLEAN, FALSE) IS TRUE
         ) AS legacy_row_read,
         MAX(revision) FILTER (WHERE notification_id = $3)::TEXT AS late_revision
       FROM account_notification_index
      WHERE account_id = $1`,
      [
        ACCOUNT_ID,
        PROJECT_A,
        lateNotificationId,
        PROJECT_B,
        notificationIds[0],
      ],
    );
    expect(rows[0]).toEqual({
      initial_unread: 0,
      late_unread: true,
      general_unread: true,
      other_project_unread: true,
      archived_read: false,
      legacy_row_read: true,
      late_revision: expect.any(String),
    });
    expect(BigInt(rows[0].late_revision)).toBeGreaterThan(
      BigInt(snapshot.read_through_revision),
    );
  });

  it("waits for an in-flight projection before taking the snapshot boundary", async () => {
    await seedBaseRows();
    const notificationId = "93000000-0000-4000-8000-000000000001";
    const writer = await getPool().connect();
    try {
      await writer.query("BEGIN");
      await writer.query(
        `INSERT INTO account_notification_index
           (account_id, notification_id, kind, project_id, summary, read_state,
            created_at, updated_at)
         VALUES ($1, $2, 'mention', $3, '{}'::JSONB, '{}'::JSONB, NOW(), NOW())`,
        [ACCOUNT_ID, notificationId, PROJECT_A],
      );

      let snapshotSettled = false;
      const snapshotPromise = listProjectedNotificationSnapshotForAccount({
        account_id: ACCOUNT_ID,
        project_id: PROJECT_A,
      }).finally(() => {
        snapshotSettled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(snapshotSettled).toBe(false);

      await writer.query("COMMIT");
      const snapshot = await snapshotPromise;
      expect(snapshot.rows).toEqual([
        expect.objectContaining({ notification_id: notificationId }),
      ]);
    } catch (err) {
      await writer.query("ROLLBACK");
      throw err;
    } finally {
      writer.release();
    }
  });
});
