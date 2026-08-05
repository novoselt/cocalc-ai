import { Command } from "commander";

export type LegacyMigrationCommandDeps = {
  withContext: any;
  hubCallByName: any;
  isValidUUID: (value: string) => boolean;
};

export function registerLegacyMigrationCommand(
  program: Command,
  deps: LegacyMigrationCommandDeps,
): Command {
  const { withContext, hubCallByName, isValidUUID } = deps;

  const legacyMigration = program
    .command("legacy-migration")
    .description("legacy cocalc.com migration operations");

  const remediation = legacyMigration
    .command("remediation")
    .description("final archive remediation operations");

  remediation
    .command("prepare <project_id>")
    .description(
      "admin: create the final cocalc.com archive snapshot and diff metadata for a restored project",
    )
    .option("--snapshot-name <name>", "snapshot name to create")
    .action(
      async (
        project_id: string,
        opts: { snapshotName?: string },
        command: Command,
      ) => {
        await withContext(
          command,
          "legacy-migration remediation prepare",
          async (ctx: any) => {
            if (!isValidUUID(project_id)) {
              throw new Error(`invalid project_id: ${project_id}`);
            }
            return await hubCallByName(
              ctx,
              "legacyMigration.adminPrepareProjectRemediation",
              [
                {
                  project_id,
                  snapshot_name:
                    `${opts.snapshotName ?? ""}`.trim() || undefined,
                },
              ],
              ctx.timeoutMs,
            );
          },
        );
      },
    );

  const publicShares = legacyMigration
    .command("public-shares")
    .description("legacy public file and directory share operations");

  publicShares
    .command("replay <legacy_project_id>")
    .description(
      "admin: preview or replay retained public_paths records for an explicitly imported project",
    )
    .requiredOption("--reason <reason>", "required audit reason")
    .option("--support-reference <reference>", "support ticket or incident")
    .option("--commit", "apply the replay; otherwise only preview", false)
    .action(
      async (
        legacy_project_id: string,
        opts: {
          reason: string;
          supportReference?: string;
          commit?: boolean;
        },
        command: Command,
      ) => {
        await withContext(
          command,
          "legacy-migration public-shares replay",
          async (ctx: any) => {
            if (!isValidUUID(legacy_project_id)) {
              throw new Error(
                `invalid legacy_project_id: ${legacy_project_id}`,
              );
            }
            return await hubCallByName(
              ctx,
              "legacyMigration.adminReplayPublicPaths",
              [
                {
                  legacy_project_id,
                  reason: opts.reason.trim(),
                  support_reference:
                    `${opts.supportReference ?? ""}`.trim() || undefined,
                  commit: opts.commit === true,
                },
              ],
              ctx.timeoutMs,
            );
          },
        );
      },
    );

  return legacyMigration;
}
