/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { createHash, randomUUID } from "node:crypto";

import getPool from "@cocalc/database/pool";
import { getConfiguredBayId } from "@cocalc/server/bay-config";
import { getConfiguredClusterSeedBayId } from "@cocalc/server/cluster-config";
import { getInterBayBridge } from "@cocalc/server/inter-bay/bridge";
import { addActivity } from "./store";
import { recordOutreachSuppression } from "./observability";

export function validateOutreachOptOutToken(token: unknown): string {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{32,200}$/.test(token)) {
    throw Error("invalid CRM outreach opt-out token");
  }
  return token;
}

export async function applyOutreachOptOut(token: string): Promise<void> {
  const validatedToken = validateOutreachOptOutToken(token);
  if (getConfiguredBayId() !== getConfiguredClusterSeedBayId()) {
    await getInterBayBridge()
      .bayOps(getConfiguredClusterSeedBayId(), { timeout_ms: 30_000 })
      .applyCrmOutreachOptOutInternal({
        token: validatedToken,
      });
    return;
  }
  const digest = createHash("sha256").update(validatedToken).digest("hex");
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const deliveryResult = await client.query(
      "SELECT * FROM crm_outreach_deliveries WHERE opt_out_token_digest=$1 FOR UPDATE",
      [digest],
    );
    const delivery = deliveryResult.rows[0];
    if (!delivery) {
      await client.query("COMMIT");
      return;
    }
    const suppressionId = randomUUID();
    const suppression = await client.query(
      `INSERT INTO crm_contact_suppressions
        (id,scope,normalized_scope_value,organization_id,person_id,person_email_id,reason,source,source_reference,active)
       VALUES($1,'email',$2,$3,$4,$5,'opt_out','opt_out_link',$6,true)
       ON CONFLICT(scope,normalized_scope_value) WHERE active DO NOTHING RETURNING id`,
      [
        suppressionId,
        delivery.normalized_email,
        delivery.organization_id,
        delivery.person_id,
        delivery.person_email_id,
        `delivery:${delivery.id}`,
      ],
    );
    await client.query(
      `UPDATE crm_outreach_deliveries SET state='suppressed',last_error='Recipient opted out',updated_at=NOW(),version=version+1
        WHERE normalized_email=$1 AND state IN ('draft','approved','queued','failed')`,
      [delivery.normalized_email],
    );
    await client.query(
      `UPDATE crm_tasks t SET state='cancelled',cancelled_at=NOW(),cancelled_by_account_id=$1,
        updated_by_account_id=$1,updated_at=NOW(),version=version+1
       FROM crm_outreach_deliveries d WHERE d.task_id=t.id AND d.normalized_email=$2 AND t.state IN ('open','waiting')`,
      [delivery.created_by_account_id, delivery.normalized_email],
    );
    await addActivity(client, {
      organization_id: delivery.organization_id,
      person_id: delivery.person_id,
      opportunity_id: delivery.opportunity_id,
      task_id: delivery.task_id,
      zendesk_ticket_id: delivery.zendesk_ticket_id,
      source_id: `opt-out:${digest}`,
      summary: "Prospect opted out of CoCalc partnership outreach",
      metadata: { scope: "email", suppression_id: suppressionId },
    });
    await client.query("COMMIT");
    if (suppression.rows[0]) recordOutreachSuppression("add", "email");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
