import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import {
  CLONED_PROJECT_RESET_PATHS,
  removeManagedVmSshConfigBlocks,
  resetClonedProjectState,
} from "./clone-state";

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

describe("resetClonedProjectState", () => {
  it("removes copied project cache but keeps other project-local CoCalc data", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "cocalc-clone-state-"));
    try {
      for (const relativePath of CLONED_PROJECT_RESET_PATHS) {
        const target = path.join(root, relativePath);
        if (relativePath.endsWith(".json")) {
          await mkdir(path.dirname(target), { recursive: true });
          await writeFile(target, "{}");
        } else {
          await mkdir(target, { recursive: true });
        }
      }
      const persistDir = path.join(root, ".local/share/cocalc/persist");
      const chatsDir = path.join(root, ".local/share/cocalc/chats");
      await mkdir(persistDir, { recursive: true });
      await mkdir(chatsDir, { recursive: true });
      const keepDir = path.join(root, ".local/share/cocalc/rootfs");
      await mkdir(keepDir, { recursive: true });
      const codexSessionsDir = path.join(root, ".codex/sessions");
      const codexStateDb = path.join(root, ".codex/state_5.sqlite");
      const codexAuth = path.join(root, ".codex/auth.json");
      await mkdir(codexSessionsDir, { recursive: true });
      await writeFile(codexStateDb, "sqlite");
      await writeFile(codexAuth, '{"tokens":{"access_token":"secret"}}');
      const sshConfig = path.join(root, ".ssh/config");
      await mkdir(path.dirname(sshConfig), { recursive: true });
      await writeFile(
        sshConfig,
        `Host keep-me
  HostName example.com

# >>> cocalc managed vm 1234abcd >>>
Host gpu
  HostName vm.example.com
# <<< cocalc managed vm 1234abcd <<<
`,
      );

      await resetClonedProjectState(root);

      for (const relativePath of CLONED_PROJECT_RESET_PATHS) {
        expect(await exists(path.join(root, relativePath))).toBe(false);
      }
      expect(await exists(persistDir)).toBe(true);
      expect(await exists(chatsDir)).toBe(true);
      expect(await exists(keepDir)).toBe(true);
      expect(await exists(codexSessionsDir)).toBe(true);
      expect(await exists(codexStateDb)).toBe(true);
      expect(await readFile(sshConfig, "utf8")).toBe(
        "Host keep-me\n  HostName example.com\n",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("removes every managed VM block without changing user SSH entries", () => {
    expect(
      removeManagedVmSshConfigBlocks(`# user comment
# >>> cocalc managed vm aaaaaaaa >>>
Host one
# <<< cocalc managed vm aaaaaaaa <<<

Host personal
  HostName personal.example

# >>> cocalc managed vm bbbbbbbb >>>
Host two
# <<< cocalc managed vm bbbbbbbb <<<
`),
    ).toBe("# user comment\n\nHost personal\n  HostName personal.example");
  });
});
