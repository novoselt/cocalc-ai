/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { FormattedMessage } from "react-intl";

import { Panel } from "@cocalc/frontend/antd-bootstrap";
import { redux, useTypedRedux } from "@cocalc/frontend/app-framework";
import { Icon, Loading } from "@cocalc/frontend/components";
import { set_account_table } from "../util";
import { EditorSettingsAutosaveInterval } from "./autosave-interval";
import { EditorSettingsCheckboxes } from "./checkboxes";
import { EditorSettingsColorScheme } from "./color-schemes";
import { EditorSettingsFontSize } from "./font-size";
import { EditorSettingsIndentSize } from "./indent-size";
import { EditorSettingsKeyboardBindings } from "./keyboard-bindings";

export function EditorSettings({}) {
  const autosave = useTypedRedux("account", "autosave");
  const font_size = useTypedRedux("account", "font_size");
  const editor_settings = useTypedRedux("account", "editor_settings");
  const other_settings = useTypedRedux("account", "other_settings");
  const email_address = useTypedRedux("account", "email_address");
  const tab_size = editor_settings?.get("tab_size");

  function on_change(name: string, val: any): void {
    if (name === "autosave" || name === "font_size") {
      set_account_table({ [name]: val });
    } else {
      set_account_table({ editor_settings: { [name]: val } });
    }
  }

  function on_change_other_settings(name: string, value: any): void {
    redux.getActions("account").set_other_settings(name, value);
  }

  if (editor_settings == null || font_size == null || !autosave || !tab_size) {
    return <Loading />;
  }

  return (
    <>
      <Panel
        size="small"
        header={
          <>
            <Icon name="font" />{" "}
            <FormattedMessage
              id="account.editor-settings.basic.title"
              defaultMessage="Basic Settings"
            />
          </>
        }
      >
        <EditorSettingsFontSize on_change={on_change} font_size={font_size} />
        <EditorSettingsAutosaveInterval
          on_change={on_change}
          autosave={autosave}
        />
        <EditorSettingsIndentSize on_change={on_change} tab_size={tab_size} />
      </Panel>
      <EditorSettingsColorScheme
        style={{ marginTop: "10px" }}
        size={"small"}
        on_change={(value) => on_change("theme", value)}
        theme={editor_settings.get("theme") ?? ""}
        editor_settings={editor_settings}
        font_size={font_size}
      />
      <Panel
        size="small"
        header={
          <>
            <Icon name="keyboard" />{" "}
            <FormattedMessage
              id="account.editor-settings.keyboard.title"
              defaultMessage="Keyboard"
            />
          </>
        }
      >
        <EditorSettingsKeyboardBindings
          on_change={(value) => on_change("bindings", value)}
          bindings={editor_settings.get("bindings") ?? ""}
        />
      </Panel>
      <EditorSettingsCheckboxes
        on_change={on_change}
        on_change_other_settings={on_change_other_settings}
        editor_settings={editor_settings}
        other_settings={other_settings}
        email_address={email_address}
      />
    </>
  );
}
