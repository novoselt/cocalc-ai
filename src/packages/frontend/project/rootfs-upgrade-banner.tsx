/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { Alert, Button } from "antd";
import { useMemo, useState } from "react";

import { useProjectContext } from "@cocalc/frontend/project/context";
import { RootFilesystemImageModal } from "@cocalc/frontend/project/settings/root-filesystem-image";
import { latestRootfsUpgradeEntry } from "@cocalc/frontend/rootfs/catalog-ui";
import {
  managedRootfsCatalogUrl,
  useRootfsImages,
} from "@cocalc/frontend/rootfs/manifest";
import type { RootfsImageEntry } from "@cocalc/util/rootfs-images";

export interface ProjectRootfsUpgrade {
  current: RootfsImageEntry;
  next: RootfsImageEntry;
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
  next,
  onReview,
  project_id,
}: ProjectRootfsUpgrade & {
  onReview: () => void;
  project_id: string;
}) {
  const upgradeKey = `${project_id}:${current.id}:${next.id}`;
  const [dismissedUpgradeKey, setDismissedUpgradeKey] = useState("");
  if (dismissedUpgradeKey === upgradeKey) return null;

  return (
    <Alert
      action={
        <Button onClick={onReview} size="small" type="primary">
          Review upgrade
        </Button>
      }
      banner
      closable
      description={`Upgrade from ${imageVersionLabel(current)} to ${imageVersionLabel(next)} for updated software and fixes. Review the change before restarting the project.`}
      onClose={() => setDismissedUpgradeKey(upgradeKey)}
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
  return (
    <>
      <ProjectRootfsUpgradeAlert
        {...upgrade}
        onReview={() => setReviewOpen(true)}
        project_id={project_id}
      />
      <RootFilesystemImageModal
        onClose={() => setReviewOpen(false)}
        open={reviewOpen}
      />
    </>
  );
}
