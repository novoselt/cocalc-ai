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

  return legacyMigration;
}
