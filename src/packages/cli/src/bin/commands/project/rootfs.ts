/**
 * Project RootFS inspection and selection commands.
 */
import { Command } from "commander";

import type { ProjectCommandDeps } from "../project";

export function registerProjectRootfsCommands(
  project: Command,
  deps: ProjectCommandDeps,
): void {
  const { withContext, resolveProjectFromArgOrContext } = deps;
  const rootfs = project
    .command("rootfs")
    .description("inspect or change a project's RootFS image");

  rootfs
    .command("get")
    .description("show the current and rollback RootFS images")
    .option("-w, --project <project>", "project id or name")
    .action(async (opts: { project?: string }, command: Command) => {
      await withContext(command, "project rootfs get", async (ctx) => {
        const resolved = await resolveProjectFromArgOrContext(
          ctx,
          opts.project,
        );
        return {
          project_id: resolved.project_id,
          states: await ctx.hub.system.getProjectRootfsStates({
            project_id: resolved.project_id,
          }),
        };
      });
    });

  rootfs
    .command("set <image>")
    .description("select a RootFS image while preserving rollback state")
    .option("-w, --project <project>", "project id or name")
    .option("--image-id <uuid>", "managed RootFS catalog image id")
    .action(
      async (
        image: string,
        opts: { project?: string; imageId?: string },
        command: Command,
      ) => {
        await withContext(command, "project rootfs set", async (ctx) => {
          const resolved = await resolveProjectFromArgOrContext(
            ctx,
            opts.project,
          );
          const normalizedImage = image.trim();
          if (!normalizedImage) {
            throw new Error("RootFS image must be non-empty");
          }
          const states = await ctx.hub.system.setProjectRootfsImage({
            project_id: resolved.project_id,
            image: normalizedImage,
            image_id: opts.imageId?.trim() || undefined,
          });
          return { project_id: resolved.project_id, states };
        });
      },
    );
}
