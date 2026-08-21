/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { Client } from "@cocalc/database/pool";

type DatabaseClient = Pick<Client, "query">;

export async function backfillComputeVmProjectAccess(
  db: DatabaseClient,
): Promise<void> {
  await db.query(`
    INSERT INTO compute_vm_project_access (
      vm_id, project_id, owner_account_id, owning_bay_id, access_level,
      ssh_public_key, state, created_by_account_id, created_at, updated_at,
      revoked_at, error, metadata
    )
    SELECT
      vm.id,
      vm.project_id,
      vm.owner_account_id,
      vm.owning_bay_id,
      'connect',
      CASE
        WHEN COALESCE((vm.metadata->>'configure_project_ssh')::boolean, FALSE)
          THEN NULLIF(BTRIM(vm.ssh_public_key), '')
        ELSE NULL
      END,
      CASE
        WHEN vm.metadata#>>'{project_ssh_config,state}' = 'ready' THEN 'ready'
        WHEN COALESCE((vm.metadata->>'configure_project_ssh')::boolean, FALSE)
          THEN 'pending'
        ELSE 'degraded'
      END,
      vm.owner_account_id,
      vm.created_at,
      NOW(),
      NULL,
      CASE
        WHEN COALESCE((vm.metadata->>'configure_project_ssh')::boolean, FALSE)
          THEN NULL
        ELSE 'Legacy project attachment has no verified project SSH key'
      END,
      jsonb_build_object('backfilled_from_legacy_project_id', TRUE)
    FROM compute_vms vm
    WHERE vm.project_id IS NOT NULL
      AND vm.deleted_at IS NULL
    ON CONFLICT (vm_id, project_id) DO NOTHING
  `);
  await db.query(`
    UPDATE compute_vms vm
       SET ssh_public_key=''
     WHERE vm.project_id IS NOT NULL
       AND vm.deleted_at IS NULL
       AND COALESCE((vm.metadata->>'configure_project_ssh')::boolean, FALSE)
       AND EXISTS (
         SELECT 1
           FROM compute_vm_project_access access
          WHERE access.vm_id=vm.id
            AND access.project_id=vm.project_id
            AND access.ssh_public_key=vm.ssh_public_key
            AND access.revoked_at IS NULL
       )
  `);
}
