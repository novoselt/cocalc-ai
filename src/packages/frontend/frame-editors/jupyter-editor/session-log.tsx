/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { useSyncExternalStore } from "react";

import type { AccountState } from "@cocalc/frontend/account/types";
import CopyButton from "@cocalc/frontend/components/copy-button";
import {
  notebookToSessionLog,
  sessionLogSyntaxExtension,
} from "@cocalc/frontend/jupyter/session-log-format";
import { COLORS } from "@cocalc/util/theme";

import type { JupyterEditorActions } from "./actions";
import { TextDocument } from "../time-travel-editor/document";

interface Props {
  actions: JupyterEditorActions;
  editor_settings: AccountState["editor_settings"];
  font_size: number;
  id: string;
  path: string;
  project_id: string;
}

export function SessionLog({
  actions,
  editor_settings,
  font_size,
  id,
  path,
  project_id,
}: Props) {
  const store = actions.jupyter_actions.store;
  useSyncExternalStore(
    (onStoreChange) => {
      store.on("change", onStoreChange);
      return () => store.off("change", onStoreChange);
    },
    () => store.getState(),
    () => store.getState(),
  );
  const ipynb = store.get_ipynb();
  const value = ipynb == null ? "" : notebookToSessionLog(ipynb);
  const syntaxHighlightExtension =
    ipynb == null ? "txt" : sessionLogSyntaxExtension(ipynb);

  return (
    <div
      style={{
        background: COLORS.TOP_BAR.ACTIVE,
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
      }}
    >
      <div
        style={{
          alignItems: "center",
          background: COLORS.GRAY_LLL,
          borderBottom: `1px solid ${COLORS.GRAY_L0}`,
          color: COLORS.GRAY_D,
          display: "flex",
          flex: "0 0 auto",
          gap: "8px",
          justifyContent: "space-between",
          padding: "4px 8px 4px 12px",
        }}
      >
        <span>Live read-only command-line transcript</span>
        <CopyButton value={value} size="small" />
      </div>
      <div
        style={{
          flex: "1 1 auto",
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <TextDocument
          id={id}
          actions={actions}
          path={path}
          project_id={project_id}
          font_size={font_size}
          editor_settings={editor_settings}
          value={value}
          syntaxHighlightExtension={syntaxHighlightExtension}
        />
      </div>
    </div>
  );
}
