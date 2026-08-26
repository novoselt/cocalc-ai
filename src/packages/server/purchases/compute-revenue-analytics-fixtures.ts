/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import getPool, {
  getTransactionClient,
  type PoolClient,
} from "@cocalc/database/pool";
import type {
  ComputeRevenueCostComponent,
  ComputeRevenueProduct,
} from "@cocalc/conat/hub/api/purchases";

export const COMPUTE_REVENUE_FIXTURE_BAY = "dev-compute-fixture";
const REPLACE_CONFIRMATION = "replace-compute-fixture";
const REMOVE_CONFIRMATION = "remove-compute-fixture";
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 30;
const DEFAULT_MACHINES = 100;

export interface ComputeRevenueFixtureRevenueRow {
  day: string;
  bay_id: typeof COMPUTE_REVENUE_FIXTURE_BAY;
  product: ComputeRevenueProduct;
  provider: string;
  cost_component: ComputeRevenueCostComponent;
  revenue_cents: number;
  purchase_count: number;
}

export interface ComputeRevenueFixtureUsageRow {
  day: string;
  bay_id: typeof COMPUTE_REVENUE_FIXTURE_BAY;
  product: ComputeRevenueProduct;
  provider: string;
  running_unit_seconds: number;
  distinct_running_units: number;
}

export interface ComputeRevenueFixture {
  start: string;
  end: string;
  machine_count: number;
  revenue: ComputeRevenueFixtureRevenueRow[];
  usage: ComputeRevenueFixtureUsageRow[];
}

interface CliOptions {
  apply: boolean;
  clean: boolean;
  confirmation?: string;
  asOf?: string;
  days: number;
  machines: number;
}

function utcDay(value: Date | string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) {
    throw Error(`invalid fixture date: ${value}`);
  }
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function dayKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw Error(`${name} must be a positive integer`);
  }
  return value;
}

// Stable pseudo-randomness makes screenshots repeatable across workstations.
function noise(machine: number, day: number, salt: number): number {
  let value =
    Math.imul(machine + 1, 73_856_093) ^
    Math.imul(day + 1, 19_349_663) ^
    Math.imul(salt + 1, 83_492_791);
  value = Math.imul(value ^ (value >>> 13), 1_274_126_177);
  return ((value ^ (value >>> 16)) >>> 0) / 0x1_0000_0000;
}

function runningHours(machine: number, day: number, date: Date): number {
  switch (machine % 4) {
    case 0:
      return 20 + 4 * noise(machine, day, 1);
    case 1: {
      const weekday = date.getUTCDay();
      return weekday === 0 || weekday === 6
        ? 2 * noise(machine, day, 2)
        : 8 + 4 * noise(machine, day, 3);
    }
    case 2:
      return (machine + day) % 3 === 0 ? 2 + 6 * noise(machine, day, 4) : 0;
    default:
      return noise(machine, day, 5) < 0.35
        ? 0.5 + 3.5 * noise(machine, day, 6)
        : 0;
  }
}

function addRevenue(
  rows: Map<string, ComputeRevenueFixtureRevenueRow>,
  row: Omit<ComputeRevenueFixtureRevenueRow, "bay_id">,
): void {
  if (row.revenue_cents === 0) return;
  const key = [row.day, row.product, row.provider, row.cost_component].join(
    "\0",
  );
  const aggregate = rows.get(key) ?? {
    ...row,
    bay_id: COMPUTE_REVENUE_FIXTURE_BAY,
    revenue_cents: 0,
    purchase_count: 0,
  };
  aggregate.revenue_cents += row.revenue_cents;
  aggregate.purchase_count += row.purchase_count;
  rows.set(key, aggregate);
}

function addUsage(
  rows: Map<string, ComputeRevenueFixtureUsageRow>,
  row: Omit<ComputeRevenueFixtureUsageRow, "bay_id">,
): void {
  const key = [row.day, row.product, row.provider].join("\0");
  const aggregate = rows.get(key) ?? {
    ...row,
    bay_id: COMPUTE_REVENUE_FIXTURE_BAY,
    running_unit_seconds: 0,
    distinct_running_units: 0,
  };
  aggregate.running_unit_seconds += row.running_unit_seconds;
  aggregate.distinct_running_units += row.distinct_running_units;
  rows.set(key, aggregate);
}

export function generateComputeRevenueFixture({
  asOf = new Date(),
  days = DEFAULT_DAYS,
  machines = DEFAULT_MACHINES,
}: {
  asOf?: Date | string;
  days?: number;
  machines?: number;
} = {}): ComputeRevenueFixture {
  positiveInteger(days, "days");
  positiveInteger(machines, "machines");
  const end = utcDay(asOf);
  const start = new Date(end.valueOf() - days * DAY_MS);
  const revenue = new Map<string, ComputeRevenueFixtureRevenueRow>();
  const usage = new Map<string, ComputeRevenueFixtureUsageRow>();

  for (let machine = 0; machine < machines; machine += 1) {
    const product: ComputeRevenueProduct =
      machine < Math.round(machines * 0.6)
        ? "dedicated-host"
        : "virtual-machine";
    const provider = machine % 10 < 7 ? "gcp" : "nebius";
    const hasGpu = machine % 5 === 0;
    const firstDay = machine % 9;
    const lastDay = machine % 11 === 0 ? days - 1 - (machine % 6) : days - 1;
    for (let day = firstDay; day <= lastDay; day += 1) {
      const date = new Date(start.valueOf() + day * DAY_MS);
      const dateString = dayKey(date);
      const hours = runningHours(machine, day, date);
      if (hours > 0) {
        addUsage(usage, {
          day: dateString,
          product,
          provider,
          running_unit_seconds: Math.round(hours * 3600),
          distinct_running_units: 1,
        });
        const hourlyCents =
          product === "dedicated-host"
            ? hasGpu
              ? 180
              : 35
            : hasGpu
              ? 120
              : 18;
        const component: ComputeRevenueCostComponent = hasGpu
          ? "gpu"
          : "compute";
        const refunded =
          (machine === 13 && day === 10) ||
          (machine === 47 && day === 18) ||
          (machine === 82 && day === 23);
        addRevenue(revenue, {
          day: dateString,
          product,
          provider,
          cost_component: component,
          revenue_cents: refunded ? 0 : Math.round(hours * hourlyCents),
          purchase_count: refunded ? 0 : 1,
        });
        const egressCents = Math.round(
          hours * (0.15 + noise(machine, day, 7) * 0.45),
        );
        const spike =
          (machine === 7 && day === 12) || (machine === 71 && day === 25)
            ? 7_500
            : 0;
        addRevenue(revenue, {
          day: dateString,
          product,
          provider,
          cost_component: "network-egress",
          revenue_cents: egressCents + spike,
          purchase_count: egressCents + spike > 0 ? 1 : 0,
        });
      }
      addRevenue(revenue, {
        day: dateString,
        product,
        provider,
        cost_component: "storage",
        revenue_cents: product === "dedicated-host" ? 25 : 10,
        purchase_count: 1,
      });
      if (product === "virtual-machine" && machine % 3 === 0) {
        addRevenue(revenue, {
          day: dateString,
          product,
          provider,
          cost_component: "storage",
          revenue_cents: 8,
          purchase_count: 1,
        });
      }
    }
  }

  return {
    start: dayKey(start),
    end: dayKey(end),
    machine_count: machines,
    revenue: [...revenue.values()].sort((a, b) =>
      [a.day, a.product, a.provider, a.cost_component]
        .join("\0")
        .localeCompare(
          [b.day, b.product, b.provider, b.cost_component].join("\0"),
        ),
    ),
    usage: [...usage.values()].sort((a, b) =>
      [a.day, a.product, a.provider]
        .join("\0")
        .localeCompare([b.day, b.product, b.provider].join("\0")),
    ),
  };
}

async function assertLocalDatabase(client: Pick<PoolClient, "query">) {
  const { rows } = await client.query<{
    database_name: string;
    server_address: string | null;
  }>(
    `SELECT current_database() AS database_name,
            inet_server_addr()::text AS server_address`,
  );
  const { database_name, server_address } = rows[0];
  if (
    server_address != null &&
    server_address !== "127.0.0.1" &&
    server_address !== "::1"
  ) {
    throw Error(
      `refusing to replace fixtures on non-local database ${database_name} at ${server_address}`,
    );
  }
}

export async function removeComputeRevenueFixture(
  client: Pick<PoolClient, "query">,
): Promise<void> {
  await client.query("DELETE FROM compute_revenue_daily WHERE bay_id=$1", [
    COMPUTE_REVENUE_FIXTURE_BAY,
  ]);
  await client.query("DELETE FROM compute_usage_daily WHERE bay_id=$1", [
    COMPUTE_REVENUE_FIXTURE_BAY,
  ]);
  await client.query(
    "DELETE FROM compute_revenue_analytics_state WHERE bay_id=$1",
    [COMPUTE_REVENUE_FIXTURE_BAY],
  );
}

export async function replaceComputeRevenueFixture({
  fixture,
  client,
}: {
  fixture: ComputeRevenueFixture;
  client: Pick<PoolClient, "query">;
}): Promise<void> {
  await removeComputeRevenueFixture(client);
  for (const row of fixture.revenue) {
    await client.query(
      `INSERT INTO compute_revenue_daily
        (day,bay_id,product,provider,cost_component,revenue_cents,
         purchase_count,updated_at)
       VALUES ($1::date,$2,$3,$4,$5,$6,$7,NOW())`,
      [
        row.day,
        row.bay_id,
        row.product,
        row.provider,
        row.cost_component,
        row.revenue_cents,
        row.purchase_count,
      ],
    );
  }
  for (const row of fixture.usage) {
    await client.query(
      `INSERT INTO compute_usage_daily
        (day,bay_id,product,provider,running_unit_seconds,
         distinct_running_units,updated_at)
       VALUES ($1::date,$2,$3,$4,$5,$6,NOW())`,
      [
        row.day,
        row.bay_id,
        row.product,
        row.provider,
        row.running_unit_seconds,
        row.distinct_running_units,
      ],
    );
  }
  await client.query(
    `INSERT INTO compute_revenue_analytics_state
      (bay_id,complete_through,last_scanned_at,updated_at)
     VALUES ($1,$2::date,NOW(),NOW())`,
    [
      COMPUTE_REVENUE_FIXTURE_BAY,
      dayKey(new Date(utcDay(fixture.end).valueOf() - DAY_MS)),
    ],
  );
}

function usage(): never {
  process.stdout.write(`Usage:
  node packages/server/dist/purchases/compute-revenue-analytics-fixtures.js [options]

Options:
  --apply                         Replace reserved development fixture rows.
  --clean                         Remove only reserved development fixture rows.
  --confirm ${REPLACE_CONFIRMATION}  Required with --apply.
  --confirm ${REMOVE_CONFIRMATION}   Required with --clean.
  --as-of <YYYY-MM-DD>            First excluded/current UTC day. Default: today.
  --days <count>                  Complete historical days. Default: 30.
  --machines <count>              Simulated machines. Default: 100.
  --help                          Show this help.

Without --apply or --clean, the script prints a deterministic dry-run summary.
`);
  process.exit(0);
}

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    apply: false,
    clean: false,
    days: DEFAULT_DAYS,
    machines: DEFAULT_MACHINES,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") usage();
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    if (arg === "--clean") {
      options.clean = true;
      continue;
    }
    const value = argv[++index];
    if (value == null || value.startsWith("--")) {
      throw Error(`missing value for ${arg}`);
    }
    if (arg === "--confirm") {
      options.confirmation = value;
    } else if (arg === "--as-of") {
      options.asOf = dayKey(utcDay(value));
    } else if (arg === "--days") {
      options.days = positiveInteger(Number(value), arg);
    } else if (arg === "--machines") {
      options.machines = positiveInteger(Number(value), arg);
    } else {
      throw Error(`unknown argument ${arg}`);
    }
  }
  if (options.apply && options.clean) {
    throw Error("--apply and --clean cannot be combined");
  }
  if (options.apply && options.confirmation !== REPLACE_CONFIRMATION) {
    throw Error(`--apply requires --confirm ${REPLACE_CONFIRMATION}`);
  }
  if (options.clean && options.confirmation !== REMOVE_CONFIRMATION) {
    throw Error(`--clean requires --confirm ${REMOVE_CONFIRMATION}`);
  }
  if (
    (options.apply || options.clean) &&
    process.env.NODE_ENV === "production"
  ) {
    throw Error("compute revenue analytics fixtures cannot run in production");
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const client = await getTransactionClient();
  try {
    await assertLocalDatabase(client);
    if (options.clean) {
      await removeComputeRevenueFixture(client);
      await client.query("COMMIT");
      process.stdout.write("Development compute revenue fixture removed.\n");
      return;
    }
    const fixture = generateComputeRevenueFixture({
      asOf: options.asOf,
      days: options.days,
      machines: options.machines,
    });
    const totalRevenue = fixture.revenue.reduce(
      (sum, { revenue_cents }) => sum + revenue_cents,
      0,
    );
    process.stdout.write(
      `${options.apply ? "Replacing" : "Would replace"} ${fixture.revenue.length.toLocaleString()} revenue rows and ${fixture.usage.length.toLocaleString()} usage rows\n` +
        `Range: ${fixture.start} through ${dayKey(new Date(utcDay(fixture.end).valueOf() - DAY_MS))}\n` +
        `Machines: ${fixture.machine_count.toLocaleString()}\n` +
        `Recognized revenue: $${(totalRevenue / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n`,
    );
    if (options.apply) {
      await replaceComputeRevenueFixture({ fixture, client });
      await client.query("COMMIT");
      process.stdout.write("Development compute revenue fixture replaced.\n");
    } else {
      await client.query("ROLLBACK");
    }
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  main()
    .catch((err) => {
      process.stderr.write(`${err instanceof Error ? err.stack : err}\n`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await getPool().end();
    });
}
