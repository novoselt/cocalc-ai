/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Input, Modal, Typography, type InputRef } from "antd";
import { useRef } from "react";

export function RootfsLineageModal({
  open,
  entryLabel,
  target,
  busy,
  onTargetChange,
  onSave,
  onCancel,
}: {
  open: boolean;
  entryLabel?: string;
  target: string;
  busy: boolean;
  onTargetChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<InputRef>(null);
  return (
    <Modal
      open={open}
      title={
        entryLabel ? `Edit lineage for "${entryLabel}"` : "Edit RootFS lineage"
      }
      okText="Save lineage"
      onOk={onSave}
      onCancel={onCancel}
      okButtonProps={{ loading: busy }}
      afterOpenChange={(visible) => {
        if (visible) {
          inputRef.current?.focus({ cursor: "end" });
        }
      }}
    >
      <Typography.Paragraph type="secondary">
        Enter the catalog image ID this release replaces, or clear the field to
        make it a standalone release. Other catalog metadata is preserved.
      </Typography.Paragraph>
      <Input
        ref={inputRef}
        allowClear
        aria-label="Superseded RootFS image ID"
        placeholder="Predecessor catalog image ID"
        value={target}
        onChange={(event) => onTargetChange(event.target.value)}
      />
    </Modal>
  );
}
