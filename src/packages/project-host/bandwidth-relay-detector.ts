/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { readFile } from "node:fs/promises";
import type {
  ProjectBandwidthRelayEvidence,
  ProjectBandwidthRelaySignal,
  ProjectBandwidthRelaySignalKind,
} from "@cocalc/conat/hub/api/system";

const DETECTOR_VERSION = "project-host-bandwidth-relay-v1";
const MAX_COMMAND_LENGTH = 500;
const MAX_PROCESSES = 256;
const MAX_SIGNALS = 8;

type ReadFileLike = (path: string, encoding: BufferEncoding) => Promise<string>;

type CommandPattern = {
  id: string;
  kind: ProjectBandwidthRelaySignalKind;
  matches: (command: string, executable: string) => boolean;
  matched: (command: string, executable: string) => string;
};

function normalizeCommand(command: string): string {
  return command
    .replace(/\0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_COMMAND_LENGTH);
}

function executableName(command: string): string {
  const argv0 = `${command.split(/\s+/, 1)[0] ?? ""}`.replace(
    /^['"]|['"]$/g,
    "",
  );
  return argv0.split("/").pop()?.toLowerCase() ?? "";
}

function commandHasWord(command: string, word: string): boolean {
  return new RegExp(`(?:^|\\s)${word}(?:$|\\s)`, "i").test(command);
}

function uploaderScriptIndicator(command: string): string | undefined {
  const token = command
    .split(/\s+/)
    .map((part) => part.replace(/^['"]|['"]$/g, ""))
    .find((part) =>
      /(?:^|[/_.-])(?:uploader|streamer)[_-]?bot(?:[/_.-]|$)/i.test(part),
    );
  if (!token) return;
  return token.split("/").slice(-2).join("/").slice(0, 120);
}

const COMMAND_PATTERNS: CommandPattern[] = [
  {
    id: "cloudflared-tunnel",
    kind: "tunnel_process",
    matches: (command, executable) =>
      executable === "cloudflared" && commandHasWord(command, "tunnel"),
    matched: (_command, executable) => `${executable} tunnel`,
  },
  {
    id: "ngrok-tunnel",
    kind: "tunnel_process",
    matches: (command, executable) =>
      executable === "ngrok" &&
      /(?:^|\s)(?:http|tcp|tls|start)(?:$|\s)/i.test(command),
    matched: (_command, executable) => executable,
  },
  {
    id: "frp-client",
    kind: "tunnel_process",
    matches: (_command, executable) => executable === "frpc",
    matched: (_command, executable) => executable,
  },
  {
    id: "chisel-client",
    kind: "tunnel_process",
    matches: (command, executable) =>
      executable === "chisel" && commandHasWord(command, "client"),
    matched: (_command, executable) => `${executable} client`,
  },
  {
    id: "bore-client",
    kind: "tunnel_process",
    matches: (command, executable) =>
      executable === "bore" && commandHasWord(command, "local"),
    matched: (_command, executable) => `${executable} local`,
  },
  {
    id: "aria2-bulk-transfer",
    kind: "bulk_transfer_process",
    matches: (_command, executable) => executable === "aria2c",
    matched: (_command, executable) => executable,
  },
  {
    id: "rclone-bulk-transfer",
    kind: "bulk_transfer_process",
    matches: (command, executable) =>
      executable === "rclone" &&
      /(?:^|\s)(?:copy|copyto|move|moveto|sync|serve)(?:$|\s)/i.test(command),
    matched: (_command, executable) => executable,
  },
  {
    id: "media-bulk-downloader",
    kind: "bulk_transfer_process",
    matches: (_command, executable) =>
      executable === "yt-dlp" || executable === "youtube-dl",
    matched: (_command, executable) => executable,
  },
  {
    id: "automated-uploader-script",
    kind: "automated_uploader_process",
    matches: (command) => uploaderScriptIndicator(command) != null,
    matched: (command) => uploaderScriptIndicator(command) ?? "uploader bot",
  },
];

export function detectBandwidthRelayCommand({
  pid,
  command,
}: {
  pid: number;
  command: string;
}): ProjectBandwidthRelaySignal[] {
  const normalized = normalizeCommand(command);
  if (!normalized) return [];
  const executable = executableName(normalized);
  if (!executable) return [];
  const signals: ProjectBandwidthRelaySignal[] = [];
  for (const pattern of COMMAND_PATTERNS) {
    if (!pattern.matches(normalized, executable)) continue;
    signals.push({
      kind: pattern.kind,
      pattern: pattern.id,
      matched: pattern.matched(normalized, executable).slice(0, 160),
      pid,
      executable,
    });
  }
  return signals;
}

export function buildBandwidthRelayEvidence(
  signals: ProjectBandwidthRelaySignal[],
): ProjectBandwidthRelayEvidence | undefined {
  const tunnel = signals.find((signal) => signal.kind === "tunnel_process");
  const transfer = signals.find(
    (signal) =>
      signal.kind === "bulk_transfer_process" ||
      signal.kind === "automated_uploader_process",
  );
  if (!tunnel || !transfer) return;
  // Keep the conjunctive evidence intact even if one process class produced
  // enough matches to fill the bounded signal list by itself.
  const selected = [tunnel, transfer];
  for (const signal of signals) {
    if (selected.includes(signal)) continue;
    selected.push(signal);
    if (selected.length >= MAX_SIGNALS) break;
  }
  return {
    confidence: "high",
    detector_version: DETECTOR_VERSION,
    detected_at: new Date().toISOString(),
    signals: selected,
  };
}

async function readProcessCommand({
  pid,
  readFileFn,
}: {
  pid: number;
  readFileFn: ReadFileLike;
}): Promise<string | undefined> {
  try {
    const command = (await readFileFn(`/proc/${pid}/cmdline`, "utf8"))
      .replace(/\0/g, " ")
      .trim();
    if (command) return command;
  } catch {
    // Processes can exit while the detector walks the tree.
  }
  try {
    return (await readFileFn(`/proc/${pid}/comm`, "utf8")).trim();
  } catch {
    return;
  }
}

async function readProcessChildren({
  pid,
  readFileFn,
}: {
  pid: number;
  readFileFn: ReadFileLike;
}): Promise<number[]> {
  try {
    return (await readFileFn(`/proc/${pid}/task/${pid}/children`, "utf8"))
      .trim()
      .split(/\s+/)
      .map(Number)
      .filter((child) => Number.isInteger(child) && child > 0);
  } catch {
    return [];
  }
}

export async function detectProjectBandwidthRelayEvidence({
  rootPid,
  readFileFn = readFile,
}: {
  rootPid: number;
  readFileFn?: ReadFileLike;
}): Promise<ProjectBandwidthRelayEvidence | undefined> {
  const signals: ProjectBandwidthRelaySignal[] = [];
  const seen = new Set<number>();
  const queue = [rootPid];
  while (queue.length > 0 && seen.size < MAX_PROCESSES) {
    const pid = queue.shift()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    const [command, children] = await Promise.all([
      readProcessCommand({ pid, readFileFn }),
      readProcessChildren({ pid, readFileFn }),
    ]);
    if (command) {
      signals.push(...detectBandwidthRelayCommand({ pid, command }));
    }
    for (const child of children) {
      if (!seen.has(child) && seen.size + queue.length < MAX_PROCESSES) {
        queue.push(child);
      }
    }
  }
  return buildBandwidthRelayEvidence(signals);
}

export const __test__ = {
  executableName,
  normalizeCommand,
  uploaderScriptIndicator,
};
