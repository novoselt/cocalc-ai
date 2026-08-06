/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { Command } from "commander";

export type VmCommandDeps = {
  withContext: any;
  runSsh?: (args: string[]) => void;
  runRsync?: (args: string[]) => void;
};

function expandHome(path: string) {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  return resolve(path);
}

function readPublicKey(path?: string) {
  const candidates = path
    ? [expandHome(path)]
    : [
        resolve(homedir(), ".ssh/id_ed25519.pub"),
        resolve(homedir(), ".ssh/id_rsa.pub"),
        resolve(homedir(), ".ssh/id_ecdsa.pub"),
      ];
  const selected = candidates.find(existsSync);
  if (!selected) {
    throw new Error(
      "no SSH public key found; create ~/.ssh/id_ed25519.pub or pass --ssh-public-key",
    );
  }
  return { path: selected, key: readFileSync(selected, "utf8").trim() };
}

function normalizeSshConfigAlias(value: string) {
  const alias = `${value ?? ""}`.trim();
  if (!/^[a-zA-Z0-9._-]+$/.test(alias)) {
    throw new Error(`ssh config alias '${alias}' must match [a-zA-Z0-9._-]+`);
  }
  return alias;
}

function sshConfigPath(path?: string) {
  return path ? expandHome(path) : resolve(homedir(), ".ssh/config");
}

function defaultIdentityPath(path?: string) {
  if (path) {
    const selected = expandHome(path);
    if (!existsSync(selected))
      throw new Error(`SSH identity not found: ${selected}`);
    return selected;
  }
  return ["id_ed25519", "id_rsa", "id_ecdsa"]
    .map((name) => resolve(homedir(), `.ssh/${name}`))
    .find(existsSync);
}

function sshConfigMarkers(alias: string) {
  return {
    start: `# >>> cocalc vm ssh ${alias} >>>`,
    end: `# <<< cocalc vm ssh ${alias} <<<`,
  };
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function removeVmSshConfigBlock(content: string, alias: string) {
  const { start, end } = sshConfigMarkers(alias);
  const pattern = new RegExp(
    `(?:^|\\n)${escapeRegExp(start)}\\n[\\s\\S]*?\\n${escapeRegExp(end)}(?:\\n|$)`,
    "g",
  );
  const next = content.replace(pattern, "\n").replace(/\n{3,}/g, "\n\n");
  return { content: next, removed: next !== content };
}

export function buildVmSshConfigBlock(opts: {
  alias: string;
  hostname: string;
  username: string;
  identity?: string;
}) {
  const markers = sshConfigMarkers(opts.alias);
  const lines = [
    markers.start,
    `Host ${opts.alias}`,
    `  HostName ${opts.hostname}`,
    `  User ${opts.username}`,
    "  ForwardAgent no",
    "  StrictHostKeyChecking accept-new",
    "  ServerAliveInterval 15",
    "  ServerAliveCountMax 2",
  ];
  if (opts.identity) {
    lines.push(`  IdentityFile ${opts.identity}`, "  IdentitiesOnly yes");
  }
  lines.push(
    "  BatchMode yes",
    "  PreferredAuthentications publickey",
    "  PasswordAuthentication no",
    "  KbdInteractiveAuthentication no",
    markers.end,
  );
  return `${lines.join("\n")}\n`;
}

export function parseTtlMinutes(value: string) {
  const match = `${value ?? ""}`.trim().match(/^(\d+)(m|h|d)$/i);
  if (!match)
    throw new Error("--ttl must use minutes, hours, or days, e.g. 30m or 8h");
  const count = Number(match[1]);
  const multiplier =
    match[2].toLowerCase() === "m"
      ? 1
      : match[2].toLowerCase() === "h"
        ? 60
        : 1440;
  return count * multiplier;
}

async function waitForState(
  hub: any,
  idOrName: string,
  desired: Set<string>,
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs;
  let last: any;
  let lastProgress = "";
  while (Date.now() < deadline) {
    last = await hub.compute.getVm({ id_or_name: idOrName });
    if (desired.has(last.state)) return last;
    if (last.state === "failed") {
      throw new Error(last.error || `compute VM '${idOrName}' failed`);
    }
    const progress = vmWaitProgress(last);
    if (progress && progress !== lastProgress) {
      process.stderr.write(`[vm wait] ${progress}\n`);
      lastProgress = progress;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 2000));
  }
  throw new Error(
    `timed out waiting for compute VM '${idOrName}'; last state=${last?.state ?? "unknown"}`,
  );
}

export function vmWaitProgress(vm: any): string | undefined {
  if (vm?.state !== "recovering") return;
  const error = `${vm?.error ?? ""}`.toUpperCase();
  const retryAt = vm?.spot_recovery_state?.next_retry_at;
  if (
    error.includes("ZONE_RESOURCE_POOL_EXHAUSTED") ||
    error.includes("RESOURCE_POOL_EXHAUSTED") ||
    error.includes("INSUFFICIENT CAPACITY")
  ) {
    const when = retryAt
      ? `; next attempt ${new Date(retryAt).toLocaleTimeString()}`
      : "";
    return `Spot capacity is unavailable in ${vm.zone}; retrying automatically${when}`;
  }
  return "VM recovery is in progress; waiting for SSH readiness";
}

async function waitForVolumeState(
  hub: any,
  idOrName: string,
  desired: Set<string>,
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs;
  let last: any;
  while (Date.now() < deadline) {
    last = await hub.compute.getVolume({ id_or_name: idOrName });
    if (desired.has(last.state)) return last;
    if (last.state === "failed") {
      throw new Error(last.error || `compute volume '${idOrName}' failed`);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 2000));
  }
  throw new Error(
    `timed out waiting for compute volume '${idOrName}'; last state=${last?.state ?? "unknown"}`,
  );
}

function sshArgs(vm: any, opts: { identity?: string }, command?: string[]) {
  if (!vm.public_ip || vm.state !== "ready") {
    throw new Error(
      `compute VM '${vm.name}' is not SSH-ready (state=${vm.state})`,
    );
  }
  const args = [
    "-o",
    "ForwardAgent=no",
    "-o",
    "StrictHostKeyChecking=accept-new",
  ];
  if (opts.identity) args.push("-i", expandHome(opts.identity));
  args.push(`${vm.ssh_user || "ubuntu"}@${vm.public_ip}`);
  if (command?.length) args.push(...command);
  return args;
}

function defaultRunSsh(args: string[]) {
  const result = spawnSync("ssh", args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if ((result.status ?? 0) !== 0) {
    throw new Error(`ssh exited with code ${result.status}`);
  }
}

function defaultRunRsync(args: string[]) {
  const result = spawnSync("rsync", args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if ((result.status ?? 0) !== 0) {
    throw new Error(`rsync exited with code ${result.status}`);
  }
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function resolveVmRsyncEndpoint(args: string[]) {
  const candidates = args.flatMap((arg, index) => {
    if (arg.startsWith("-")) return [];
    const match = arg.match(/^([a-z][a-z0-9-]{0,31}):(.*)$/);
    return match ? [{ index, vm: match[1], path: match[2] }] : [];
  });
  if (candidates.length !== 1) {
    throw new Error(
      "rsync requires exactly one VM endpoint, e.g. vm-name:/work/data",
    );
  }
  return candidates[0];
}

export function vmRsyncArgs(
  vm: any,
  args: string[],
  opts: { identity?: string },
) {
  if (!vm.public_ip || vm.state !== "ready") {
    throw new Error(
      `compute VM '${vm.name}' is not SSH-ready (state=${vm.state})`,
    );
  }
  if (args.some((arg) => arg === "-e" || arg.startsWith("--rsh"))) {
    throw new Error(
      "use --identity instead of overriding rsync's SSH transport",
    );
  }
  const endpoint = resolveVmRsyncEndpoint(args);
  if (endpoint.vm !== vm.name && endpoint.vm !== vm.id) {
    throw new Error(`resolved VM '${vm.name}' does not match '${endpoint.vm}'`);
  }
  const ssh = [
    "ssh",
    "-o",
    "ForwardAgent=no",
    "-o",
    "StrictHostKeyChecking=accept-new",
  ];
  if (opts.identity) ssh.push("-i", expandHome(opts.identity));
  const next = [...args];
  next[endpoint.index] =
    `${vm.ssh_user || "ubuntu"}@${vm.public_ip}:${endpoint.path}`;
  return ["-e", ssh.map(shellQuote).join(" "), ...next];
}

export function vmListSummary(rows: any[]) {
  return rows.map((row) => ({
    name: row.name,
    state: row.state,
    machine: row.machine_type,
    pricing: row.effective_pricing_model === "spot" ? "Spot" : "Standard",
    zone: row.zone,
    ip: row.public_ip ?? "",
    expires: row.expires_at ?? "never",
    project: row.project_id,
  }));
}

export function volumeListSummary(rows: any[]) {
  return rows.map((row) => ({
    name: row.name,
    state: row.state,
    size_gb: row.size_gb,
    zone: row.zone,
    attachment: row.attachment_state,
    vm: row.attached_vm_id ?? "",
    monthly_usd: Number(row.size_gb) * Number(row.monthly_price_per_gb),
  }));
}

export function registerVmCommand(program: Command, deps: VmCommandDeps) {
  const {
    withContext,
    runSsh = defaultRunSsh,
    runRsync = defaultRunRsync,
  } = deps;
  const vm = program
    .command("vm")
    .description("account-owned managed compute VMs");

  vm.command("list")
    .description("list compute VMs owned by the current account")
    .option("--project <project_id>", "filter by attached project")
    .option("--include-deleted", "include deleted lease records", false)
    .option("--long", "show the full durable VM records", false)
    .action(
      async (
        opts: {
          project?: string;
          includeDeleted?: boolean;
          long?: boolean;
        },
        command: Command,
      ) => {
        await withContext(command, "vm list", async (ctx) => {
          const rows = await ctx.hub.compute.listVms({
            project_id: opts.project,
            include_deleted: opts.includeDeleted === true,
          });
          return opts.long ? rows : vmListSummary(rows);
        });
      },
    );

  vm.command("get <vm>")
    .description("inspect an owned compute VM")
    .action(async (idOrName: string, command: Command) => {
      await withContext(command, "vm get", async (ctx) => {
        return await ctx.hub.compute.getVm({ id_or_name: idOrName });
      });
    });

  vm.command("create <name>")
    .description("create a managed compute VM")
    .requiredOption("--project <project_id>", "attached CoCalc project")
    .option("--zone <zone>", "GCP zone", "us-central1-a")
    .option(
      "--machine <machine_type>",
      "allowlisted machine type",
      "e2-standard-2",
    )
    .option("--spot", "use interruptible Spot capacity", false)
    .option(
      "--allow-standard-fallback",
      "authorize 24-hour Standard fallback when Spot is unavailable",
      false,
    )
    .option("--ttl <duration>", "optional deletion deadline, e.g. 30m or 8h")
    .option("--boot-disk-gb <gb>", "persistent root disk size", "20")
    .option("--volume <name>", "existing persistent volume mounted at /work")
    .option(
      "--funding-mode <mode>",
      "account-prepaid or account-postpaid; auto-detected when omitted",
    )
    .option("--ssh-public-key <path>", "OpenSSH public key file")
    .option("--wait", "wait until SSH-ready", false)
    .action(async (name: string, opts: any, command: Command) => {
      await withContext(command, "vm create", async (ctx) => {
        const key = readPublicKey(opts.sshPublicKey);
        const created = await ctx.hub.compute.createVm({
          project_id: opts.project,
          name,
          zone: opts.zone,
          machine_type: opts.machine,
          pricing_model: opts.spot ? "spot" : "on_demand",
          allow_on_demand_fallback: opts.allowStandardFallback === true,
          ttl_minutes: opts.ttl ? parseTtlMinutes(opts.ttl) : null,
          boot_disk_gb: Number(opts.bootDiskGb),
          volume: opts.volume,
          funding_mode: opts.fundingMode,
          ssh_public_key: key.key,
          idempotency_key: randomUUID(),
        });
        if (!opts.wait) return { ...created, ssh_public_key_path: key.path };
        return {
          ...(await waitForState(
            ctx.hub,
            created.id,
            new Set(["ready"]),
            5 * 60_000,
          )),
          ssh_public_key_path: key.path,
        };
      });
    });

  vm.command("wait <vm>")
    .description("wait for a VM to become SSH-ready")
    .option("--timeout <seconds>", "maximum wait", "300")
    .action(
      async (idOrName: string, opts: { timeout: string }, command: Command) => {
        await withContext(command, "vm wait", async (ctx) => {
          return await waitForState(
            ctx.hub,
            idOrName,
            new Set(["ready"]),
            Number(opts.timeout) * 1000,
          );
        });
      },
    );

  vm.command("ttl <vm>")
    .description("show, set, extend, or clear a VM deletion deadline")
    .option("--set <duration>", "set a deadline from now, e.g. 8h")
    .option("--extend <duration>", "extend the current deadline, e.g. 2h")
    .option("--clear", "remove the optional deletion deadline")
    .action(async (idOrName: string, opts: any, command: Command) => {
      await withContext(command, "vm ttl", async (ctx) => {
        const selected = [
          opts.set != null,
          opts.extend != null,
          opts.clear,
        ].filter(Boolean).length;
        if (selected === 0) {
          const current = await ctx.hub.compute.getVm({
            id_or_name: idOrName,
          });
          return {
            id: current.id,
            name: current.name,
            expires_at: current.expires_at ?? null,
          };
        }
        if (selected !== 1) {
          throw new Error("specify exactly one of --set, --extend, or --clear");
        }
        return await ctx.hub.compute.setVmTtl({
          id_or_name: idOrName,
          ...(opts.extend != null
            ? { extend_minutes: parseTtlMinutes(opts.extend) }
            : {
                ttl_minutes:
                  opts.set != null ? parseTtlMinutes(opts.set) : null,
              }),
          idempotency_key: randomUUID(),
        });
      });
    });

  for (const action of ["start", "stop"] as const) {
    vm.command(`${action} <vm>`)
      .description(`${action} an owned compute VM inside its existing lease`)
      .option(
        "--wait",
        `wait for ${action === "start" ? "ready" : "stopped"}`,
        false,
      )
      .action(
        async (
          idOrName: string,
          opts: { wait?: boolean },
          command: Command,
        ) => {
          await withContext(command, `vm ${action}`, async (ctx) => {
            const result = await ctx.hub.compute[`${action}Vm`]({
              id_or_name: idOrName,
              idempotency_key: randomUUID(),
            });
            if (!opts.wait) return result;
            return await waitForState(
              ctx.hub,
              result.id,
              new Set([action === "start" ? "ready" : "stopped"]),
              5 * 60_000,
            );
          });
        },
      );
  }

  vm.command("delete <vm>")
    .description("delete a VM lease and its persistent root disk")
    .option("--wait", "wait for provider deletion", false)
    .action(
      async (idOrName: string, opts: { wait?: boolean }, command: Command) => {
        await withContext(command, "vm delete", async (ctx) => {
          const result = await ctx.hub.compute.deleteVm({
            id_or_name: idOrName,
            idempotency_key: randomUUID(),
          });
          if (!opts.wait) return result;
          return await waitForState(
            ctx.hub,
            result.id,
            new Set(["deleted"]),
            5 * 60_000,
          );
        });
      },
    );

  vm.command("ssh <vm> [remote_command...]")
    .description(
      "connect directly to a compute VM, or run a remote command after the VM name",
    )
    .option("--identity <path>", "SSH private key")
    .option("--print", "print the SSH command instead of running it", false)
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action(
      async (
        idOrName: string,
        remoteCommand: string[],
        opts: { identity?: string; print?: boolean },
        command: Command,
      ) => {
        await withContext(command, "vm ssh", async (ctx) => {
          const row = await ctx.hub.compute.getVm({ id_or_name: idOrName });
          const args = sshArgs(row, opts, remoteCommand);
          const rendered = `ssh ${args.map((arg) => JSON.stringify(arg)).join(" ")}`;
          if (opts.print || ctx.globals.json || ctx.globals.output === "json") {
            return { id: row.id, name: row.name, command: rendered };
          }
          runSsh(args);
          // SSH owns stdout/stderr. Returning data here would add a CLI result
          // table after the interactive session or remote command completes.
          return undefined;
        });
      },
    );

  vm.command("rsync <rsync_args...>")
    .description(
      "copy files with rsync; exactly one endpoint must be vm-name:/path",
    )
    .option("--identity <path>", "SSH private key")
    .option("--print", "print the rsync command instead of running it", false)
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action(
      async (
        rsyncArgs: string[],
        opts: { identity?: string; print?: boolean },
        command: Command,
      ) => {
        await withContext(command, "vm rsync", async (ctx) => {
          const endpoint = resolveVmRsyncEndpoint(rsyncArgs);
          const row = await ctx.hub.compute.getVm({
            id_or_name: endpoint.vm,
          });
          const args = vmRsyncArgs(row, rsyncArgs, opts);
          const rendered = `rsync ${args.map(shellQuote).join(" ")}`;
          if (opts.print || ctx.globals.json || ctx.globals.output === "json") {
            return { id: row.id, name: row.name, command: rendered };
          }
          runRsync(args);
          return undefined;
        });
      },
    );

  const volume = vm
    .command("volume")
    .description("manage persistent account-owned /work volumes");

  volume
    .command("list")
    .description("list persistent compute volumes")
    .option("--include-deleted", "include deleted volume records", false)
    .option("--long", "show full durable volume records", false)
    .action(async (opts: any, command: Command) => {
      await withContext(command, "vm volume list", async (ctx) => {
        const rows = await ctx.hub.compute.listVolumes({
          include_deleted: opts.includeDeleted === true,
        });
        return opts.long ? rows : volumeListSummary(rows);
      });
    });

  volume
    .command("get <volume>")
    .description("inspect a persistent compute volume")
    .action(async (idOrName: string, command: Command) => {
      await withContext(command, "vm volume get", async (ctx) => {
        return await ctx.hub.compute.getVolume({ id_or_name: idOrName });
      });
    });

  volume
    .command("create <name>")
    .description("create a persistent pd-balanced /work volume")
    .requiredOption("--project <project_id>", "attached CoCalc project")
    .option("--zone <zone>", "GCP zone", "us-central1-a")
    .option("--size-gb <gb>", "volume size", "50")
    .option(
      "--funding-mode <mode>",
      "account-prepaid or account-postpaid; auto-detected when omitted",
    )
    .option("--wait", "wait until the volume is ready", false)
    .action(async (name: string, opts: any, command: Command) => {
      await withContext(command, "vm volume create", async (ctx) => {
        const created = await ctx.hub.compute.createVolume({
          project_id: opts.project,
          name,
          zone: opts.zone,
          size_gb: Number(opts.sizeGb),
          funding_mode: opts.fundingMode,
          idempotency_key: randomUUID(),
        });
        if (!opts.wait) return created;
        return await waitForVolumeState(
          ctx.hub,
          created.id,
          new Set(["ready"]),
          5 * 60_000,
        );
      });
    });

  volume
    .command("resize <volume>")
    .description("grow a persistent compute volume")
    .requiredOption("--size-gb <gb>", "new grow-only volume size")
    .option(
      "--funding-mode <mode>",
      "account-prepaid or account-postpaid; auto-detected when omitted",
    )
    .option("--wait", "wait until provider resize completes", false)
    .action(async (idOrName: string, opts: any, command: Command) => {
      await withContext(command, "vm volume resize", async (ctx) => {
        const resized = await ctx.hub.compute.resizeVolume({
          id_or_name: idOrName,
          size_gb: Number(opts.sizeGb),
          funding_mode: opts.fundingMode,
          idempotency_key: randomUUID(),
        });
        if (!opts.wait) return resized;
        return await waitForVolumeState(
          ctx.hub,
          resized.id,
          new Set(["ready"]),
          5 * 60_000,
        );
      });
    });

  volume
    .command("delete <volume>")
    .description("permanently delete a detached persistent volume")
    .requiredOption("--confirm <name>", "type the exact volume name")
    .option("--wait", "wait for provider deletion", false)
    .action(async (idOrName: string, opts: any, command: Command) => {
      await withContext(command, "vm volume delete", async (ctx) => {
        const deleted = await ctx.hub.compute.deleteVolume({
          id_or_name: idOrName,
          confirm_name: opts.confirm,
          idempotency_key: randomUUID(),
        });
        if (!opts.wait) return deleted;
        return await waitForVolumeState(
          ctx.hub,
          deleted.id,
          new Set(["deleted"]),
          5 * 60_000,
        );
      });
    });

  const sshConfig = vm
    .command("ssh-config")
    .description("manage local OpenSSH config entries for compute VMs");

  sshConfig
    .command("add <vm>")
    .description("add or update a managed ~/.ssh/config entry")
    .option("--alias <alias>", "SSH Host alias (defaults to the VM name)")
    .option("--identity <path>", "SSH private key")
    .option("--config <path>", "SSH config path (default: ~/.ssh/config)")
    .action(async (idOrName: string, opts: any, command: Command) => {
      await withContext(command, "vm ssh-config add", async (ctx) => {
        const row = await ctx.hub.compute.getVm({ id_or_name: idOrName });
        if (!row.public_ip || row.state !== "ready") {
          throw new Error(
            `compute VM '${row.name}' is not SSH-ready (state=${row.state})`,
          );
        }
        const alias = normalizeSshConfigAlias(opts.alias ?? row.name);
        const configPath = sshConfigPath(opts.config);
        const identity = defaultIdentityPath(opts.identity);
        const existing = existsSync(configPath)
          ? readFileSync(configPath, "utf8")
          : "";
        const stripped = removeVmSshConfigBlock(
          existing,
          alias,
        ).content.trimEnd();
        const block = buildVmSshConfigBlock({
          alias,
          hostname: row.public_ip,
          username: row.ssh_user || "ubuntu",
          identity,
        });
        mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
        writeFileSync(
          configPath,
          stripped ? `${stripped}\n\n${block}` : block,
          {
            encoding: "utf8",
            mode: 0o600,
          },
        );
        return {
          id: row.id,
          name: row.name,
          alias,
          config_path: configPath,
          identity: identity ?? null,
          command: `ssh ${alias}`,
        };
      });
    });

  sshConfig
    .command("remove <alias>")
    .description("remove a managed compute VM entry from ~/.ssh/config")
    .option("--config <path>", "SSH config path (default: ~/.ssh/config)")
    .action(async (aliasValue: string, opts: any, command: Command) => {
      await withContext(command, "vm ssh-config remove", async () => {
        const alias = normalizeSshConfigAlias(aliasValue);
        const configPath = sshConfigPath(opts.config);
        if (!existsSync(configPath)) {
          return { alias, config_path: configPath, removed: false };
        }
        const stripped = removeVmSshConfigBlock(
          readFileSync(configPath, "utf8"),
          alias,
        );
        if (stripped.removed) {
          writeFileSync(configPath, `${stripped.content.trimEnd()}\n`, {
            encoding: "utf8",
            mode: 0o600,
          });
        }
        return { alias, config_path: configPath, removed: stripped.removed };
      });
    });

  return vm;
}
