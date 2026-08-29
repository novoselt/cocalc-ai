/*
 * This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 * License: MS-RSL – see LICENSE.md for details
 */

import { Command } from "commander";

import type { PublicDirectoryShareSummary } from "@cocalc/conat/hub/api/public-directory-shares";
import { MAX_PUBLIC_SHARE_READER_INSTRUCTIONS_LENGTH } from "@cocalc/util/public-directory-share-labels";
import type { ProjectCommandDeps } from "../project";

type PublishOptions = {
  project?: string;
  slug: string;
  title?: string;
  description?: string;
  readerInstructions?: string;
  license?: string;
  siteLicenseId?: string;
  siteLicensePool?: string;
  siteLicenseDurationDays?: string;
  grantOnCopy?: boolean;
  copyRequiresGrant?: boolean;
};

function encodeShareSlug(slug: string): string {
  return slug
    .split("/")
    .filter((part) => part.length > 0)
    .map(encodeURIComponent)
    .join("/");
}

function parseDurationDays(value?: string): number | undefined {
  if (value == null || value.trim() === "") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error("site-license duration must be a positive number of days");
  }
  return Math.trunc(parsed);
}

function parseReaderInstructions(value?: string): string | null | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > MAX_PUBLIC_SHARE_READER_INSTRUCTIONS_LENGTH) {
    throw new Error(
      `reader instructions must be at most ${MAX_PUBLIC_SHARE_READER_INSTRUCTIONS_LENGTH.toLocaleString()} characters`,
    );
  }
  return normalized;
}

export function registerProjectPublishCommands(
  project: Command,
  deps: ProjectCommandDeps,
): void {
  const { withContext, resolveProjectFromArgOrContext, hubCallByName } = deps;

  project
    .command("publish <path>")
    .description("publish a project directory as an unlisted public share")
    .option("-w, --project <project>", "project id or name")
    .requiredOption(
      "--slug <slug>",
      "public share slug, e.g. Cambridge/book/code",
    )
    .option("--title <title>", "share title")
    .option("--description <description>", "share description")
    .option(
      "--reader-instructions <markdown>",
      "instructions that override the publisher profile for this share",
    )
    .option("--license <license>", "share license")
    .option("--site-license-id <id>", "site license id for copy grants")
    .option("--site-license-pool <id>", "site license pool id for copy grants")
    .option(
      "--site-license-duration-days <days>",
      "temporary site-license grant duration in days",
    )
    .option(
      "--grant-on-copy",
      "grant a temporary site-license membership when the share is copied",
    )
    .option(
      "--no-copy-requires-grant",
      "allow copying even if the temporary site-license grant fails",
    )
    .action(async (path: string, opts: PublishOptions, command: Command) => {
      await withContext(command, "project publish", async (ctx) => {
        const project = await resolveProjectFromArgOrContext(ctx, opts.project);
        const grantOnCopy =
          opts.grantOnCopy === true || opts.siteLicensePool != null;
        const share = (await hubCallByName(
          ctx,
          "publicDirectoryShares.create",
          [
            {
              project_id: project.project_id,
              path,
              slug: opts.slug,
              title: opts.title,
              description: opts.description,
              reader_instructions: parseReaderInstructions(
                opts.readerInstructions,
              ),
              license: opts.license,
              site_license_grant_on_copy: grantOnCopy,
              site_license_copy_requires_grant:
                opts.copyRequiresGrant !== false,
              site_license_id: grantOnCopy ? opts.siteLicenseId : undefined,
              site_license_pool_id: grantOnCopy
                ? opts.siteLicensePool
                : undefined,
              site_license_duration_days: grantOnCopy
                ? parseDurationDays(opts.siteLicenseDurationDays)
                : undefined,
            },
          ],
        )) as PublicDirectoryShareSummary;
        return {
          ...share,
          url_path: `/share/${encodeShareSlug(share.slug)}`,
        };
      });
    });
}
