/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { detectCryptominingCommand } from "./cryptomining-detector";

describe("project-host high-confidence abuse command detector", () => {
  it.each([
    "/usr/bin/qemu-system-x86_64 -m 16000 -smp 16",
    "qemu-system-aarch64 -machine virt -nographic",
    "./qemu-kvm -m 4096",
  ])("detects an executed QEMU system emulator: %s", (command) => {
    expect(detectCryptominingCommand({ pid: 42, command })).toEqual([
      expect.objectContaining({
        kind: "qemu_execution",
        pattern: "qemu-system-executable",
        pid: 42,
      }),
    ]);
  });

  it.each([
    "bash -c echo qemu-system-x86_64",
    "grep qemu-system-x86_64 process.log",
    "python build.py qemu-system-aarch64",
    "qemu-img create -f qcow2 disk.img 10G",
    "apt-get install qemu-system-x86",
  ])("does not treat a QEMU reference as execution: %s", (command) => {
    expect(detectCryptominingCommand({ pid: 42, command })).toEqual([]);
  });
});
