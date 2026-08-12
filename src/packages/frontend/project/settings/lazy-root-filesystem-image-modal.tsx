/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { Alert, Modal } from "antd";
import { Suspense, type ReactNode } from "react";

import { CocalcErrorBoundary } from "@cocalc/frontend/app/error-boundary";
import { lazyWithRetry } from "@cocalc/frontend/app/lazy-with-retry";
import { COLORS } from "@cocalc/util/theme";

interface Props {
  onClose: () => void;
  open: boolean;
}

const RootFilesystemImageModal = lazyWithRetry<Props>(
  async () => ({
    default: (await import("./root-filesystem-image")).RootFilesystemImageModal,
  }),
  "project RootFS image settings",
);

function ModalShell({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <Modal footer={null} onCancel={onClose} open title="Project Runtime Image">
      {children}
    </Modal>
  );
}

export function LazyRootFilesystemImageModal({ onClose, open }: Props) {
  if (!open) return null;
  return (
    <CocalcErrorBoundary
      scope="project.rootfs-image-modal"
      fallback={
        <ModalShell onClose={onClose}>
          <Alert
            description="Close this dialog and try again."
            showIcon
            title="The runtime image settings could not be loaded."
            type="warning"
          />
        </ModalShell>
      }
      resetKeys={[open]}
    >
      <Suspense
        fallback={
          <ModalShell onClose={onClose}>
            <div
              style={{ color: COLORS.GRAY, padding: 24, textAlign: "center" }}
            >
              Loading runtime images...
            </div>
          </ModalShell>
        }
      >
        <RootFilesystemImageModal onClose={onClose} open={open} />
      </Suspense>
    </CocalcErrorBoundary>
  );
}
