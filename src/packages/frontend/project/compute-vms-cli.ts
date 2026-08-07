/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

export interface VmCreateCliValues {
  name: string;
  zone: string;
  machine_type: string;
  pricing_model: "spot" | "on_demand";
  allow_on_demand_fallback: boolean;
  ttl_minutes?: number | null;
  boot_disk_gb: number;
  volume?: string;
  ssh_public_key?: string;
}

export interface VolumeCreateCliValues {
  name: string;
  zone: string;
  size_gb: number;
}

function shellQuote(value: string): string {
  if (/^[a-zA-Z0-9_./:@=-]+$/.test(value)) return value;
  return `'${value.split("'").join(`'\\''`)}'`;
}

function ttlArgument(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

export function vmCreateCli(opts: {
  api: string;
  project_id: string;
  values: Partial<VmCreateCliValues>;
}): string {
  const { values } = opts;
  const args = [
    "cocalc",
    "--api",
    shellQuote(opts.api),
    "vm",
    "create",
    "--project",
    opts.project_id,
    "--zone",
    values.zone ?? "us-central1-a",
    "--machine",
    values.machine_type ?? "e2-standard-2",
  ];
  if (values.ttl_minutes != null) {
    args.push(`--ttl=${ttlArgument(values.ttl_minutes)}`);
  }
  args.push(`--boot-disk-gb=${values.boot_disk_gb ?? 20}`);
  if (values.pricing_model === "spot") args.push("--spot");
  if (values.allow_on_demand_fallback) {
    args.push("--allow-standard-fallback");
  }
  if (values.volume) args.push("--volume", shellQuote(values.volume));
  if (values.ssh_public_key?.trim()) {
    args.push(
      "--ssh-public-key-value",
      shellQuote(values.ssh_public_key.trim()),
    );
  } else {
    args.push("--no-ssh-key");
  }
  args.push("--wait", shellQuote(values.name || "vm-name"));
  return args.join(" ");
}

export function volumeCreateCli(opts: {
  api: string;
  project_id: string;
  values: Partial<VolumeCreateCliValues>;
}): string {
  return [
    "cocalc",
    "--api",
    shellQuote(opts.api),
    "vm",
    "volume",
    "create",
    "--project",
    opts.project_id,
    "--zone",
    opts.values.zone ?? "us-central1-a",
    `--size-gb=${opts.values.size_gb ?? 50}`,
    "--wait",
    shellQuote(opts.values.name || "volume-name"),
  ].join(" ");
}
