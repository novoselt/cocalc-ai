/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import express, { type Request, type Response, type Router } from "express";

import { applyOutreachOptOut } from "@cocalc/server/crm/outreach/opt-out";
import outreachZendeskWebhookHandler from "@cocalc/server/crm/outreach/webhook";

function preferencePage(
  res: Response,
  { recorded, token }: { recorded: boolean; token?: string },
): void {
  const content = recorded
    ? "<h1>Outreach preference recorded</h1><p>CoCalc will not send further partnership outreach to this address. This page does not disclose whether any other customer record exists.</p>"
    : `<h1>Stop partnership outreach?</h1><p>Confirm that you do not want CoCalc to send further partnership outreach to this address.</p><form method="post"><input type="hidden" name="token" value="${token ?? ""}"><button type="submit" style="font:inherit;padding:.65rem 1rem;cursor:pointer">Confirm opt-out</button></form>`;
  res
    .status(200)
    .type("html")
    .send(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CoCalc outreach preferences</title></head><body style="font-family:Georgia,serif;max-width:42rem;margin:10vh auto;padding:2rem;line-height:1.6;color:#1d2b32">${content}</body></html>`,
    );
}

export default function initCrmOutreach(router: Router): void {
  router.post(
    "/webhooks/zendesk/crm-outreach",
    express.raw({ type: "application/json", limit: "256kb" }),
    outreachZendeskWebhookHandler,
  );
  router.get("/crm/outreach/opt-out/:token", (req: Request, res: Response) => {
    preferencePage(res, {
      recorded: false,
      token: `${req.params.token ?? ""}`.replace(/[^A-Za-z0-9_-]/g, ""),
    });
  });
  router.post(
    "/crm/outreach/opt-out/:token",
    express.urlencoded({ extended: false, limit: "4kb" }),
    async (req: Request, res: Response) => {
      try {
        await applyOutreachOptOut(`${req.params.token ?? ""}`);
      } catch {
        // The public response is deliberately indistinguishable.
      }
      preferencePage(res, { recorded: true });
    },
  );
}
