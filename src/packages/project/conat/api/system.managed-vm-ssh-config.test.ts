/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { updateManagedVmSshConfig } from "./system";

const vmId = "12345678-aaaa-bbbb-cccc-0123456789ab";

describe("managed VM SSH config", () => {
  it("adds an exact, stable v2 block without changing existing config", () => {
    const original = `Host personal
  HostName personal.example.com
  User alice
`;
    const result = updateManagedVmSshConfig({
      content: original,
      vm_id: vmId,
      vm_name: "Build Machine!",
      hostname: "vm-0123456789abcdef0123456789abcdef.example.com",
      enabled: true,
    });

    expect(result.alias).toBe("vm-build-machine-12345678");
    expect(result.content).toContain(original.trim());
    expect(result.content).toContain("# >>> cocalc managed vm 12345678 >>>");
    expect(result.content).toContain("Host vm-build-machine-12345678");
    expect(result.content).toContain("  User user");
    expect(result.content).toContain("  BatchMode yes");
    expect(result.content).toContain("# <<< cocalc managed vm 12345678 <<<");
  });

  it("updates one managed block idempotently and preserves other blocks", () => {
    const first = updateManagedVmSshConfig({
      content: "Host personal\n  HostName personal.example.com\n",
      vm_id: vmId,
      vm_name: "build",
      hostname: "vm-old.example.com",
      enabled: true,
    });
    const second = updateManagedVmSshConfig({
      content: `${first.content}\n# unrelated tail\n`,
      vm_id: vmId,
      vm_name: "build",
      hostname: "vm-new.example.com",
      enabled: true,
    });
    const third = updateManagedVmSshConfig({
      content: second.content,
      vm_id: vmId,
      vm_name: "build",
      hostname: "vm-new.example.com",
      enabled: true,
    });

    expect(second.content).not.toContain("vm-old.example.com");
    expect(second.content).toContain("vm-new.example.com");
    expect(second.content).toContain("# unrelated tail");
    expect(
      second.content.match(/# >>> cocalc managed vm 12345678 >>>/g),
    ).toHaveLength(1);
    expect(third).toEqual(second);
  });

  it("removes only the matching managed block", () => {
    const enabled = updateManagedVmSshConfig({
      content: "Include .cocalc/config\n",
      vm_id: vmId,
      vm_name: "build",
      hostname: "vm-build.example.com",
      enabled: true,
    });
    const disabled = updateManagedVmSshConfig({
      content: `${enabled.content}Host another\n  HostName another.example.com\n`,
      vm_id: vmId,
      vm_name: "build",
      hostname: "vm-build.example.com",
      enabled: false,
    });

    expect(disabled.content).toBe(
      "Include .cocalc/config\n\nHost another\n  HostName another.example.com\n",
    );
  });
});
