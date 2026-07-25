import type { WorkspaceSshConnectionInfo } from "@cocalc/conat/hub/api/projects";
import {
  INSTALL_CLOUDFLARED_SCRIPT,
  parseSshPublicKey,
  projectSshConfigBlock,
  removeProjectSshConfigBlock,
  upsertProjectSshConfigBlock,
} from "./project-to-project-ssh-config";

const ROUTE: WorkspaceSshConnectionInfo = {
  workspace_id: "target-project",
  host_id: "host-1",
  transport: "cloudflare-tcp",
  ssh_username: "target-project",
  ssh_server: null,
  cloudflare_hostname: "ssh-host-1.example.com",
};

describe("project-to-project SSH config", () => {
  it("builds a Cloudflare route using the source project deploy key", () => {
    const block = projectSshConfigBlock({
      alias: "target-project",
      route: ROUTE,
    });
    expect(block).toContain(
      'ProxyCommand "$HOME/.local/share/cocalc/bin/cloudflared" access ssh --hostname %h',
    );
    expect(block).toContain("StrictHostKeyChecking accept-new");
    expect(block).toContain("ServerAliveInterval 15");
    expect(block).toContain("ServerAliveCountMax 2");
    expect(block).toContain("IdentityFile ~/.ssh/id_ed25519");
  });

  it("replaces only the matching managed block", () => {
    const first = projectSshConfigBlock({
      alias: "target-project",
      route: ROUTE,
    });
    const updated = upsertProjectSshConfigBlock({
      content: `Host personal\n  HostName example.com\n\n${first}`,
      alias: "target-project",
      block: first.replace("ssh-host-1", "ssh-host-2"),
    });
    expect(updated).toContain("Host personal");
    expect(updated).toContain("ssh-host-2.example.com");
    expect(updated).not.toContain("ssh-host-1.example.com");
    expect(updated.match(/Host target-project/g)).toHaveLength(1);
  });

  it("normalizes and validates OpenSSH public keys", () => {
    expect(
      parseSshPublicKey(" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA test\n"),
    ).toEqual({
      value: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA test",
      base64: "AAAAC3NzaC1lZDI1NTE5AAAA",
    });
    expect(() => parseSshPublicKey("not-a-key")).toThrow(
      "SSH public key is invalid",
    );
  });

  it("removes only the matching managed block", () => {
    const first = projectSshConfigBlock({
      alias: "target-project",
      route: ROUTE,
    });
    const content = `Host personal\n  HostName example.com\n\n${first}`;
    expect(
      removeProjectSshConfigBlock({
        content,
        alias: "target-project",
      }),
    ).toBe("Host personal\n  HostName example.com\n");
  });

  it("keeps shell variable expansion in the cloudflared installer", () => {
    expect(INSTALL_CLOUDFLARED_SCRIPT).toContain(
      'tmp="$' + '{destination}.tmp.$$"',
    );
    expect(INSTALL_CLOUDFLARED_SCRIPT).toContain("download/$" + "{artifact}");
  });
});
