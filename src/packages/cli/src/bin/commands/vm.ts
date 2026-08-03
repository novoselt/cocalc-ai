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

function parseTtlMinutes(value: string) {
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
  while (Date.now() < deadline) {
    last = await hub.compute.getVm({ id_or_name: idOrName });
    if (desired.has(last.state)) return last;
    if (last.state === "failed") {
      throw new Error(last.error || `compute VM '${idOrName}' failed`);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 2000));
  }
  throw new Error(
    `timed out waiting for compute VM '${idOrName}'; last state=${last?.state ?? "unknown"}`,
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

export function vmListSummary(rows: any[]) {
  return rows.map((row) => ({
    name: row.name,
    state: row.state,
    machine: row.machine_type,
    pricing: row.effective_pricing_model,
    zone: row.zone,
    ip: row.public_ip ?? "",
    expires: row.expires_at,
    project: row.project_id,
  }));
}

export function registerVmCommand(program: Command, deps: VmCommandDeps) {
  const { withContext, runSsh = defaultRunSsh } = deps;
  const vm = program
    .command("vm")
    .description("short-lived account-owned managed compute VMs");

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
    .description("create a bounded staging compute VM lease")
    .requiredOption("--project <project_id>", "attached CoCalc project")
    .option("--zone <zone>", "GCP zone", "us-central1-a")
    .option(
      "--machine <machine_type>",
      "allowlisted machine type",
      "e2-standard-2",
    )
    .option("--spot", "use interruptible Spot capacity", false)
    .option(
      "--allow-on-demand-fallback",
      "authorize 24-hour project-host-compatible fallback",
      false,
    )
    .option("--ttl <duration>", "hard lease deadline, e.g. 30m or 8h", "30m")
    .option("--boot-disk-gb <gb>", "persistent root disk size", "20")
    .requiredOption(
      "--authorized-cost <usd>",
      "maximum fixed compute cost authorization",
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
          allow_on_demand_fallback: opts.allowOnDemandFallback === true,
          ttl_minutes: parseTtlMinutes(opts.ttl),
          boot_disk_gb: Number(opts.bootDiskGb),
          authorized_cost: opts.authorizedCost,
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
          return {
            id: row.id,
            name: row.name,
            status: remoteCommand.length ? "completed" : "connected",
          };
        });
      },
    );

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
