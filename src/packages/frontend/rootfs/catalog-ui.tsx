/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { type CSSProperties, useEffect, useState } from "react";

import { Tag } from "antd";

import { Icon, isIconName, type IconName } from "@cocalc/frontend/components";
import { blobImageUrl } from "@cocalc/frontend/components/theme-image-input";
import { RootfsScanStatusTag } from "@cocalc/frontend/rootfs/scan-status";
import {
  managedRootfsContentKey,
  type RootfsImageEntry,
} from "@cocalc/util/rootfs-images";
import { COLORS } from "@cocalc/util/theme";

export function sectionLabel(section: RootfsImageEntry["section"]): string {
  switch (section) {
    case "official":
      return "Official";
    case "mine":
      return "My image";
    case "collaborators":
      return "Collaborator image";
    case "public":
      return "Public image";
    default:
      return "Catalog";
  }
}

export function sectionTagColor(section: RootfsImageEntry["section"]): string {
  switch (section) {
    case "official":
      return "blue";
    case "mine":
      return "green";
    case "collaborators":
      return "gold";
    case "public":
      return "red";
    default:
      return "default";
  }
}

export function groupedRootfsOptions(images: RootfsImageEntry[]) {
  const sections: Array<{
    key: NonNullable<RootfsImageEntry["section"]>;
    label: string;
  }> = [
    { key: "official", label: "Official images" },
    { key: "mine", label: "My images" },
    { key: "collaborators", label: "Collaborator images" },
    { key: "public", label: "Public images" },
  ];
  return sections.reduce<
    Array<{
      label: string;
      options: Array<{
        value: string;
        label: string;
        searchText: string;
        entry: RootfsImageEntry;
      }>;
    }>
  >((acc, { key, label }) => {
    const options = images
      .filter((entry) => entry.section === key)
      .map((entry) => ({
        value: entry.id,
        label: entry.label || entry.image,
        entry,
        searchText: [
          entry.label,
          entry.slug,
          entry.image,
          entry.description,
          entry.content?.title,
          entry.content?.subtitle,
          entry.content?.description,
          entry.content?.publisher?.name,
          entry.owner_name,
          "rootfs",
          ...(entry.content?.highlights ?? []),
          ...(entry.tags ?? []),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
      }));
    if (options.length > 0) {
      acc.push({ label, options });
    }
    return acc;
  }, []);
}

const VERSION_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function rootfsSeriesScopeKey(entry: RootfsImageEntry): string {
  const arch = Array.isArray(entry.arch)
    ? [...entry.arch].sort().join(",")
    : (entry.arch ?? "any");
  return [
    (entry.owner_id ?? "").trim().toLowerCase(),
    entry.official ? "official" : "user",
    (entry.channel ?? "").trim().toLowerCase(),
    entry.gpu ? "gpu" : "cpu",
    arch.toLowerCase(),
  ].join("|");
}

function rootfsSeriesKey(entry: RootfsImageEntry): string | undefined {
  if (!entry.family || !entry.version) return;
  return `${rootfsSeriesScopeKey(entry)}|${entry.family.trim().toLowerCase()}`;
}

function compareVersionRecency(
  a: RootfsImageEntry,
  b: RootfsImageEntry,
): number {
  const versionCmp = VERSION_COLLATOR.compare(a.version ?? "", b.version ?? "");
  if (versionCmp !== 0) return versionCmp;
  const aTime = Date.parse(a.created ?? "") || 0;
  const bTime = Date.parse(b.created ?? "") || 0;
  if (aTime !== bTime) return aTime - bTime;
  return a.id.localeCompare(b.id);
}

export type RootfsVersionGroup = {
  latest: RootfsImageEntry;
  older: RootfsImageEntry[];
};

/**
 * Group catalog entries using the same series rules as
 * latestRootfsVersionEntries, while retaining every older release.  Groups
 * remain in catalog order and older releases are listed newest first.
 */
export function groupRootfsVersionEntries(
  images: RootfsImageEntry[],
): RootfsVersionGroup[] {
  const entriesById = new Map(images.map((entry) => [entry.id, entry]));
  const parent = new Map(images.map((entry) => [entry.id, entry.id]));
  const find = (id: string): string => {
    const current = parent.get(id) ?? id;
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const union = (left: string, right: string) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  };

  const firstBySeries = new Map<string, string>();
  for (const entry of images) {
    const key = rootfsSeriesKey(entry);
    if (!key) continue;
    const first = firstBySeries.get(key);
    if (first) {
      union(first, entry.id);
    } else {
      firstBySeries.set(key, entry.id);
    }
  }
  for (const entry of images) {
    const predecessor = entriesById.get(
      entry.supersedes_image_id?.trim() ?? "",
    );
    if (
      predecessor &&
      rootfsSeriesScopeKey(predecessor) === rootfsSeriesScopeKey(entry)
    ) {
      union(predecessor.id, entry.id);
    }
  }

  const grouped = new Map<string, RootfsImageEntry[]>();
  for (const entry of images) {
    const root = find(entry.id);
    const entries = grouped.get(root) ?? [];
    entries.push(entry);
    grouped.set(root, entries);
  }
  const inputIndex = new Map(images.map((entry, index) => [entry.id, index]));
  return Array.from(grouped.values())
    .map((entries) => {
      const [latest, ...older] = entries.sort((a, b) =>
        compareVersionRecency(b, a),
      );
      return { latest, older };
    })
    .sort(
      (a, b) =>
        (inputIndex.get(a.latest.id) ?? 0) - (inputIndex.get(b.latest.id) ?? 0),
    );
}

export function latestRootfsVersionEntries(
  images: RootfsImageEntry[],
  opts?: {
    showOlderVersions?: boolean;
    preserveIds?: Array<string | undefined>;
  },
): RootfsImageEntry[] {
  if (opts?.showOlderVersions) return images;
  const visibleIds = new Set(
    groupRootfsVersionEntries(images).map(({ latest }) => latest.id),
  );
  for (const id of opts?.preserveIds ?? []) {
    const value = `${id ?? ""}`.trim();
    if (value) visibleIds.add(value);
  }
  return images.filter((entry) => visibleIds.has(entry.id));
}

export function latestRootfsVersionForEntry({
  current,
  images,
}: {
  current: RootfsImageEntry;
  images: RootfsImageEntry[];
}): RootfsImageEntry {
  const entries = images.some((entry) => entry.id === current.id)
    ? images
    : [...images, current];
  const group = groupRootfsVersionEntries(entries).find(
    ({ latest, older }) =>
      latest.id === current.id ||
      older.some((entry) => entry.id === current.id),
  );
  return group?.latest ?? current;
}

export function latestRootfsUpgradeEntry({
  current,
  images,
}: {
  current?: RootfsImageEntry;
  images: RootfsImageEntry[];
}): RootfsImageEntry | undefined {
  if (!current) return undefined;
  const entries = images.filter(
    (entry) => !entry.hidden && !entry.blocked && entry.id !== current.id,
  );
  const bySupersededId = new Map<string, RootfsImageEntry[]>();
  for (const entry of entries) {
    const supersededId = entry.supersedes_image_id?.trim();
    if (!supersededId) continue;
    const list = bySupersededId.get(supersededId) ?? [];
    list.push(entry);
    bySupersededId.set(supersededId, list);
  }

  const reachableExplicit: RootfsImageEntry[] = [];
  let cursor: RootfsImageEntry = current;
  const seen = new Set<string>([current.id]);
  while (true) {
    const candidates = (bySupersededId.get(cursor.id) ?? []).sort((a, b) =>
      compareVersionRecency(b, a),
    );
    const next = candidates.find((entry) => !seen.has(entry.id));
    if (!next) break;
    reachableExplicit.push(next);
    seen.add(next.id);
    cursor = next;
  }

  const latestExplicit = reachableExplicit.sort((a, b) =>
    compareVersionRecency(b, a),
  )[0];
  const currentSeriesKey = rootfsSeriesKey(current);
  if (!currentSeriesKey) return latestExplicit;
  const related = entries
    .filter(
      (entry) =>
        rootfsSeriesKey(entry) === currentSeriesKey &&
        !!entry.version &&
        VERSION_COLLATOR.compare(entry.version, current.version!) > 0,
    )
    .sort((a, b) => compareVersionRecency(b, a));
  const latestRelated = related[0];
  if (!latestExplicit) return latestRelated;
  if (
    latestRelated &&
    compareVersionRecency(latestRelated, latestExplicit) > 0
  ) {
    return latestRelated;
  }
  return latestExplicit;
}

export function rootfsOptionSearchText(option?: any): string {
  return `${option?.searchText ?? option?.data?.searchText ?? ""}`.toLowerCase();
}

export function rootfsThemeImageUrl(
  theme?: RootfsImageEntry["theme"],
): string | undefined {
  return blobImageUrl(theme?.image_blob, "rootfs-theme.png");
}

export function RootfsThemePreview({
  entry,
  size = 56,
}: {
  entry?: {
    theme?: RootfsImageEntry["theme"];
    label?: string;
    image?: string;
  };
  size?: number;
}): React.JSX.Element {
  const imageUrl = rootfsThemeImageUrl(entry?.theme);
  const [imageFailed, setImageFailed] = useState(false);
  const accentColor = entry?.theme?.accent_color?.trim();
  const color = entry?.theme?.color?.trim();
  const iconName = rootfsCatalogIconName({ theme: entry?.theme });
  const boxStyle: CSSProperties = {
    width: size,
    height: size,
    borderRadius: size <= 56 ? 12 : 16,
    flex: "0 0 auto",
    overflow: "hidden",
  };

  useEffect(() => {
    setImageFailed(false);
  }, [imageUrl]);

  if (imageUrl && !imageFailed) {
    return (
      <img
        src={imageUrl}
        alt={`${entry?.label || entry?.image || "Image"} theme`}
        onError={() => setImageFailed(true)}
        style={{
          ...boxStyle,
          display: "block",
          objectFit: "cover",
        }}
      />
    );
  }

  return (
    <div
      style={{
        ...boxStyle,
        alignItems: "center",
        background: accentColor || COLORS.GRAY_LL,
        color: color || undefined,
        display: "flex",
        justifyContent: "center",
      }}
    >
      <Icon name={iconName} style={{ fontSize: size <= 56 ? 24 : 56 }} />
    </div>
  );
}

function shortRootfsRef(image: string): string {
  const contentKey = managedRootfsContentKey(image);
  if (contentKey) {
    return `managed image ${contentKey.slice(0, 8)}…${contentKey.slice(-8)}`;
  }
  const value = image.trim();
  if (value.length <= 56) return value;
  return `${value.slice(0, 34)}…${value.slice(-14)}`;
}

function publishedLabel(created?: string): string | undefined {
  if (!created) return;
  const date = new Date(created);
  if (Number.isNaN(date.valueOf())) return;
  const now = new Date();
  const includeYear = date.getFullYear() !== now.getFullYear();
  return `Published ${date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(includeYear ? { year: "numeric" } : {}),
  })}`;
}

export function renderRootfsCatalogOption(entry: RootfsImageEntry) {
  const themeColor = entry.theme?.color?.trim() || COLORS.GRAY_L;
  const accentColor =
    entry.theme?.accent_color?.trim() || entry.theme?.color?.trim();
  const themeTitle = entry.theme?.title?.trim() || entry.label || entry.image;
  const themeDescription =
    entry.theme?.description?.trim() || entry.description?.trim();
  const metadata = [
    publishedLabel(entry.created),
    entry.section !== "mine" && !entry.official && entry.owner_name
      ? `by ${entry.owner_name}`
      : undefined,
    shortRootfsRef(entry.image),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      style={{
        border: `1px solid ${themeColor}`,
        borderRadius: 12,
        padding: "10px 12px",
        background: accentColor ? `${accentColor}18` : "rgba(0, 0, 0, 0.02)",
      }}
    >
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <RootfsThemePreview entry={entry} size={52} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              flexWrap: "wrap",
              marginBottom: "2px",
            }}
          >
            <span style={{ fontWeight: 600 }}>{themeTitle}</span>
            {entry.section ? (
              <Tag
                color={sectionTagColor(entry.section)}
                style={{ marginInlineEnd: 0 }}
              >
                {sectionLabel(entry.section)}
              </Tag>
            ) : null}
            {entry.version ? (
              <Tag style={{ marginInlineEnd: 0 }}>{entry.version}</Tag>
            ) : null}
            {entry.channel ? (
              <Tag color="cyan" style={{ marginInlineEnd: 0 }}>
                {entry.channel}
              </Tag>
            ) : null}
            {entry.gpu ? (
              <Tag color="purple" style={{ marginInlineEnd: 0 }}>
                GPU
              </Tag>
            ) : null}
            <RootfsScanStatusTag entry={entry} showUnknown={entry.official} />
          </div>
          <div
            title={entry.image}
            style={{
              fontSize: "11px",
              color: COLORS.GRAY_M,
              overflowWrap: "anywhere",
              marginBottom: themeDescription ? "2px" : 0,
            }}
          >
            {metadata}
          </div>
          {themeDescription ? (
            <div
              style={{
                fontSize: "12px",
                color: COLORS.GRAY_D,
                overflowWrap: "anywhere",
              }}
            >
              {themeDescription}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function rootfsCatalogIconName(entry: {
  theme?: RootfsImageEntry["theme"];
}): IconName {
  const icon = entry.theme?.icon?.trim();
  return isIconName(icon) ? icon : "docker";
}
