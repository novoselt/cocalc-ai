/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Tag } from "antd";
import type { Map } from "immutable";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Tooltip } from "@cocalc/frontend/components";
import useNotebookFrameActions from "@cocalc/frontend/frame-editors/jupyter-editor/cell-notebook/hook";

// e.g., this is a subset of { JupyterActions } from "./browser-actions";
export interface Actions {
  select_complete: (
    id: string,
    item: string,
    complete?: Map<string, any>,
  ) => void;
  clear_complete: () => void;
  focus_complete?: () => void;
}

interface Props {
  actions: Actions;
  id: string;
  complete: Map<string, any>;
}

// WARNING: Complete closing when clicking outside the complete box
// is handled in cell-list on_click.  This is ugly code (since not localized),
// but seems to work well for now.  Could move.
export function Complete({ actions, id, complete }: Props) {
  const frameActions = useNotebookFrameActions();
  const menuRef = useRef<HTMLUListElement | null>(null);
  const itemRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const anchorTop = complete.getIn(["offset", "top"], 0) as number;
  const anchorBottom = complete.getIn(
    ["offset", "bottom"],
    anchorTop,
  ) as number;
  const anchorLeft = complete.getIn(["offset", "left"], 0) as number;
  const [position, setPosition] = useState({
    top: anchorBottom,
    left: anchorLeft,
  });

  useEffect(() => {
    return () => {
      // No matter what, when the complete dialog goes away, restore focus
      // and edit mode to the cell.
      frameActions.current?.set_mode("edit");
    };
  }, []);

  useEffect(() => {
    itemRefs.current[0]?.focus({ preventScroll: true });
  }, [complete]);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (menu == null) return;
    const margin = 8;
    const gap = 2;
    const rect = menu.getBoundingClientRect();
    const viewportHeight = document.documentElement.clientHeight;
    const viewportWidth = document.documentElement.clientWidth;
    const roomBelow = viewportHeight - anchorBottom - margin;
    const roomAbove = anchorTop - margin;
    const openAbove = rect.height > roomBelow && roomAbove > roomBelow;
    const top = openAbove
      ? Math.max(margin, anchorTop - rect.height - gap)
      : Math.min(anchorBottom + gap, viewportHeight - rect.height - margin);
    const left = Math.min(
      Math.max(margin, anchorLeft),
      Math.max(margin, viewportWidth - rect.width - margin),
    );
    setPosition({ top, left });
  }, [anchorBottom, anchorLeft, anchorTop, complete]);

  const typeInfo = useMemo(() => {
    const types = complete?.getIn(["metadata", "_jupyter_types_experimental"]);
    if (types == null) {
      return {};
    }
    const typeInfo: { [text: string]: { type: string; signature: string } } =
      {};
    // @ts-ignore
    for (const info of types) {
      const text = info.get("text");
      if (typeInfo[text] == null) {
        typeInfo[text] = {
          type: info.get("type"),
          signature: info.get("signature"),
        };
      }
    }
    return typeInfo;
  }, [complete]);

  function select(item: string): void {
    // Save contents of editor to the store so that completion properly *places* the
    // completion in the correct place: see https://github.com/sagemathinc/cocalc/issues/3978
    frameActions.current?.save_input_editor(id);

    // Actually insert the completion:
    actions.select_complete(id, item);
    setTimeout(() => actions.focus_complete?.(), 0);
  }

  const matches = (complete.get("matches")?.toArray?.() ?? []) as string[];
  itemRefs.current.length = matches.length;

  function renderItem(item: string, index: number) {
    return (
      <li key={item} role="none">
        <a
          role="menuitem"
          style={{ display: "flex", fontSize: "13px" }}
          tabIndex={-1}
          ref={(node) => {
            itemRefs.current[index] = node;
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            select(item);
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          data-item={item}
        >
          {item}
          {typeInfo[item]?.type ? (
            <Tooltip title={`${item}${typeInfo[item].signature}`}>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    float: "right",
                    marginLeft: "30px",
                    color: "#0000008a",
                    fontFamily: "monospace",
                  }}
                >
                  <Tag color={typeToColor[typeInfo[item].type]}>
                    {typeInfo[item].type}
                  </Tag>
                </div>
              </div>
            </Tooltip>
          ) : null}
        </a>
      </li>
    );
  }

  function focusItem(index: number): void {
    const count = matches.length;
    if (count === 0) return;
    const normalized = ((index % count) + count) % count;
    const item = itemRefs.current[normalized];
    item?.focus({ preventScroll: true });
    item?.scrollIntoView?.({ block: "nearest" });
  }

  function focusedIndex(): number {
    const index = itemRefs.current.findIndex(
      (item) => item === document.activeElement,
    );
    return index < 0 ? 0 : index;
  }

  function consume(e: KeyboardEvent<HTMLUListElement>): void {
    e.preventDefault();
    e.stopPropagation();
  }

  function key(e: KeyboardEvent<HTMLUListElement>): void {
    switch (e.key) {
      case "Escape":
        consume(e);
        actions.clear_complete();
        return;
      case "ArrowDown":
        consume(e);
        focusItem(focusedIndex() + 1);
        return;
      case "ArrowUp":
        consume(e);
        focusItem(focusedIndex() - 1);
        return;
      case "Home":
        consume(e);
        focusItem(0);
        return;
      case "End":
        consume(e);
        focusItem(matches.length - 1);
        return;
      case "Enter":
      case "Tab": {
        consume(e);
        const item = matches[focusedIndex()] ?? matches[0];
        if (item != null) {
          select(item);
        }
        return;
      }
    }
  }

  function getStyle(): CSSProperties {
    return {
      cursor: "pointer",
      top: `${position.top}px`,
      left: `${position.left}px`,
      zIndex: 2000,
      width: 0,
      height: 0,
      position: "fixed",
    };
  }

  const menu = (
    <div className="dropdown open" style={getStyle()}>
      <ul
        ref={menuRef}
        aria-label="Code completions"
        className="dropdown-menu cocalc-complete"
        onKeyDown={key}
        role="menu"
        style={{
          maxHeight: "min(50vh, 24rem)",
          overflowY: "auto",
        }}
      >
        {matches.map(renderItem)}
      </ul>
    </div>
  );

  return createPortal(menu, document.body);
}

const typeToColor = {
  function: "blue",
  statement: "green",
  module: "cyan",
  class: "orange",
  instance: "magenta",
  "<unknown>": "red",
  path: "gold",
  keyword: "purple",
  magic: "geekblue",
  param: "volcano",
};
