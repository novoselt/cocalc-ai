import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const CLONED_PROJECT_RESET_PATHS = [
  // XDG cache directories are disposable and should not be cloned as
  // authoritative project state.
  ".cache",
  ".local/cache",
  // Preserve Codex thread/history state, but do not silently clone persisted
  // auth into a new project.
  ".codex/auth.json",
  // Deploy identities are project-specific capabilities. A cloned private key
  // could otherwise retain access granted only to the source project.
  ".ssh/id_ed25519",
  ".ssh/id_ed25519.pub",
];

export function removeManagedVmSshConfigBlocks(content: string): string {
  return content
    .replace(
      /(?:^|\n)# >>> cocalc managed vm [a-f0-9]{8} >>>\n[\s\S]*?\n# <<< cocalc managed vm [a-f0-9]{8} <<<(?:\n|$)/g,
      "\n",
    )
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

export async function resetClonedProjectState(
  projectRoot: string,
): Promise<void> {
  await Promise.all(
    CLONED_PROJECT_RESET_PATHS.map(async (relativePath) => {
      await rm(join(projectRoot, relativePath), {
        recursive: true,
        force: true,
      });
    }),
  );
  const sshConfig = join(projectRoot, ".ssh/config");
  const current = await readFile(sshConfig, "utf8").catch((err: any) => {
    if (err?.code === "ENOENT") return undefined;
    throw err;
  });
  if (current != null) {
    const next = removeManagedVmSshConfigBlocks(current);
    if (next !== current) {
      await writeFile(sshConfig, next ? `${next}\n` : "", { mode: 0o600 });
    }
  }
}
