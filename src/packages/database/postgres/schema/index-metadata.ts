/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { createHash } from "node:crypto";

export type SchemaIndexDefinition = {
  name: string;
  query: string;
  unique: boolean;
};

const INDEX_MARKER_PREFIX = "[cocalc-db-schema-index:v1:";
const INDEX_MARKER_SUFFIX = "]";
export const STALE_INDEX_MARKER = "stale";

export function postgresIdentifierName(name: string): string {
  let result = "";
  for (const character of name) {
    if (Buffer.byteLength(result + character, "utf8") > 63) break;
    result += character;
  }
  return result;
}

export function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function schemaIndexHash(index: SchemaIndexDefinition): string {
  return createHash("sha256")
    .update(`v1\0${index.unique ? "unique" : "index"}\0${index.query.trim()}`)
    .digest("hex");
}

function markerLine(marker: string): string {
  return `${INDEX_MARKER_PREFIX}${marker}${INDEX_MARKER_SUFFIX}`;
}

export function schemaIndexMarkers(comment: string | null): Set<string> {
  const markers = new Set<string>();
  for (const line of comment?.split("\n") ?? []) {
    if (line.startsWith(INDEX_MARKER_PREFIX) && line.endsWith("]")) {
      const marker = line.slice(INDEX_MARKER_PREFIX.length, -1);
      if (marker === STALE_INDEX_MARKER || /^[0-9a-f]{64}$/.test(marker)) {
        markers.add(marker);
      }
    }
  }
  return markers;
}

export function addSchemaIndexMarker(
  comment: string | null,
  marker: string,
): string {
  const lines = comment?.split("\n").filter((line) => line.length > 0) ?? [];
  const line = markerLine(marker);
  if (!lines.includes(line)) lines.push(line);
  return lines.join("\n");
}

export function staleSchemaIndexComment(): string {
  return markerLine(STALE_INDEX_MARKER);
}
