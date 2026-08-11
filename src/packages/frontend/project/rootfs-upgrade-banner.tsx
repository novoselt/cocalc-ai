/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { Alert, Button, Popconfirm, Space } from "antd";
import { useMemo, useState } from "react";

import { redux, useAccountOtherSetting } from "@cocalc/frontend/app-framework";
import { useProjectContext } from "@cocalc/frontend/project/context";
import { LazyRootFilesystemImageModal } from "@cocalc/frontend/project/settings/lazy-root-filesystem-image-modal";
import { latestRootfsUpgradeEntry } from "@cocalc/frontend/rootfs/catalog-ui";
import {
  managedRootfsCatalogUrl,
  useRootfsImages,
} from "@cocalc/frontend/rootfs/manifest";
import type { RootfsImageEntry } from "@cocalc/util/rootfs-images";

export const ROOTFS_UPGRADE_DISMISSALS_SETTING = "rootfs_upgrade_dismissals";

type RootfsUpgradeDismissals = Record<string, string>;

export interface ProjectRootfsUpgrade {
  current: RootfsImageEntry;
  next: RootfsImageEntry;
}

export function normalizeRootfsUpgradeDismissals(
  value: unknown,
): RootfsUpgradeDismissals {
  const plain = (value as any)?.toJS?.() ?? value;
  if (plain == null || typeof plain !== "object" || Array.isArray(plain)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(plain).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" && entry[1].trim().length > 0,
    ),
  );
}

export function withRootfsUpgradeDismissal({
  dismissals,
  project_id,
  targetImageId,
}: {
  dismissals: unknown;
  project_id: string;
  targetImageId: string;
}): RootfsUpgradeDismissals {
  return {
    ...normalizeRootfsUpgradeDismissals(dismissals),
    [project_id]: targetImageId,
  };
}

export function isRootfsUpgradeDismissed({
  dismissals,
  project_id,
  targetImageId,
}: {
  dismissals: unknown;
  project_id: string;
  targetImageId: string;
}): boolean {
  return (
    normalizeRootfsUpgradeDismissals(dismissals)[project_id] === targetImageId
  );
}

export function getProjectRootfsUpgrade({
  image,
  imageId,
  images,
}: {
  image?: string;
  imageId?: string;
  images: RootfsImageEntry[];
}): ProjectRootfsUpgrade | undefined {
  const normalizedImageId = imageId?.trim();
  const normalizedImage = image?.trim();
  const current =
    (normalizedImageId
      ? images.find((entry) => entry.id === normalizedImageId)
      : undefined) ??
    (normalizedImage
      ? images.find((entry) => entry.image === normalizedImage)
      : undefined);
  if (!current) return;
  const next = latestRootfsUpgradeEntry({ current, images });
  return next ? { current, next } : undefined;
}

function imageVersionLabel(entry: RootfsImageEntry): string {
  const label =
    entry.theme?.title?.trim() || entry.label?.trim() || entry.image;
  const version = entry.version?.trim();
  if (!version || label.toLowerCase().includes(version.toLowerCase())) {
    return label;
  }
  return `${label} ${version}`;
}

export function ProjectRootfsUpgradeAlert({
  current,
  dismissed,
  next,
  onDismiss,
  onReview,
}: ProjectRootfsUpgrade & {
  dismissed: boolean;
  onDismiss: () => void;
  onReview: () => void;
}) {
  if (dismissed) return null;

  return (
    <Alert
      action={
        <Space size="small">
          <Button onClick={onReview} size="small" type="primary">
            Review upgrade
          </Button>
          <Popconfirm
            cancelText="Keep showing"
            description="You can still upgrade later using the Image button on the left side of the project, or Upgrade in the Projects list."
            okText="Dismiss permanently"
            onConfirm={onDismiss}
            placement="bottomRight"
            title="Stop showing this upgrade?"
          >
            <Button size="small" type="text">
              Dismiss
            </Button>
          </Popconfirm>
        </Space>
      }
      banner
      description={`Upgrade from ${imageVersionLabel(current)} to ${imageVersionLabel(next)} for updated software and fixes. Review the change before restarting the project.`}
      showIcon
      title="A newer project image is available"
      type="info"
    />
  );
}

export function ProjectRootfsUpgradeBanner({
  project_id,
}: {
  project_id: string;
}) {
  const { project } = useProjectContext();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [locallyDismissedTarget, setLocallyDismissedTarget] = useState("");
  const storedDismissals = useAccountOtherSetting<unknown>(
    ROOTFS_UPGRADE_DISMISSALS_SETTING,
  );
  const dismissals = useMemo(
    () => normalizeRootfsUpgradeDismissals(storedDismissals),
    [storedDismissals],
  );
  const imageId = `${project?.get("rootfs_image_id") ?? ""}`.trim();
  const image = `${project?.get("rootfs_image") ?? ""}`.trim();
  const { images } = useRootfsImages(
    imageId || image ? [managedRootfsCatalogUrl()] : [],
    {
      imageIds: imageId ? [imageId] : [],
      limit: 200,
    },
  );
  const upgrade = useMemo(
    () => getProjectRootfsUpgrade({ image, imageId, images }),
    [image, imageId, images],
  );

  if (!upgrade) return null;
  const targetImageId = upgrade.next.id;
  const dismissed =
    isRootfsUpgradeDismissed({
      dismissals,
      project_id,
      targetImageId,
    }) || locallyDismissedTarget === targetImageId;

  function dismissUpgrade(): void {
    setLocallyDismissedTarget(targetImageId);
    redux.getActions("account").set_other_settings(
      ROOTFS_UPGRADE_DISMISSALS_SETTING,
      withRootfsUpgradeDismissal({
        dismissals,
        project_id,
        targetImageId,
      }),
    );
  }

  return (
    <>
      <ProjectRootfsUpgradeAlert
        {...upgrade}
        dismissed={dismissed}
        onDismiss={dismissUpgrade}
        onReview={() => setReviewOpen(true)}
      />
      <LazyRootFilesystemImageModal
        onClose={() => setReviewOpen(false)}
        open={reviewOpen}
      />
    </>
  );
}
