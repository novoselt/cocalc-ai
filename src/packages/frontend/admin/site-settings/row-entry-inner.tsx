/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Input, Select, Switch } from "antd";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { isEqual } from "lodash";
import { LOCALIZATIONS } from "@cocalc/frontend/i18n";
import { LOCALE } from "@cocalc/util/consts/locale";
import {
  ConfigValid,
  to_list_of_locale,
} from "@cocalc/util/db-schema/site-defaults";
import { RowEntryInnerProps } from "./row-entry";
import SecretSettingInput from "./secret-setting-input";

export function testIsInvalid(value, valid?: ConfigValid): boolean {
  return (
    (Array.isArray(valid) && !valid.includes(value)) ||
    (typeof valid == "function" && !valid(value))
  );
}

export function rowEntryStyle(value, valid?: ConfigValid): CSSProperties {
  if (testIsInvalid(value, valid)) {
    return { border: "2px solid red" };
  }
  return {};
}

export function RowEntryInner({
  name,
  value,
  valid,
  valid_labels,
  password,
  isSet,
  isClearing,
  multiline,
  onChangeEntry,
  onDraftEntry,
  isReadonly,
  clearable,
  onClearSecret,
}: RowEntryInnerProps) {
  const externalValue = value ?? "";
  const [draftValue, setDraftValue] = useState(externalValue);
  const draftValueRef = useRef(draftValue);
  const isEditingRef = useRef(false);

  useEffect(() => {
    if (isEditingRef.current) return;
    draftValueRef.current = externalValue;
    setDraftValue(externalValue);
  }, [externalValue]);

  function changeDraft(nextValue: string): void {
    isEditingRef.current = true;
    draftValueRef.current = nextValue;
    setDraftValue(nextValue);
    onDraftEntry(name, nextValue);
  }

  function commitDraft(): void {
    if (!isEditingRef.current) return;
    isEditingRef.current = false;
    onChangeEntry(name, draftValueRef.current);
  }

  if (isReadonly == null) return null; // typescript
  const disabled = isReadonly[name] == true;

  if (name === "i18n") {
    return (
      <Select
        mode="multiple"
        style={{ width: "100%" }}
        placeholder="Select user selectable language locale"
        optionLabelProp="label"
        defaultValue={to_list_of_locale(value, false)}
        onChange={(value: Array<string>) => {
          onChangeEntry(name, value.join(","));
        }}
        options={LOCALE.map((l) => {
          return { label: LOCALIZATIONS[l].name, value: l };
        })}
        optionRender={(option) => (
          <>
            {option.value ? LOCALIZATIONS[option.value].flag : ""}{" "}
            {option.label}
          </>
        )}
      />
    );
  } else if (isEqual(valid, ["yes", "no"])) {
    return (
      <Switch
        defaultChecked={value == "yes"}
        checkedChildren="yes"
        unCheckedChildren="no"
        onChange={(checked) => {
          onChangeEntry(name, checked ? "yes" : "no");
        }}
      />
    );
  } else if (Array.isArray(valid)) {
    return (
      <Select
        defaultValue={value}
        disabled={disabled}
        onChange={(value) => {
          // should never happen, because this is not a "multiple" Select
          if (Array.isArray(value)) {
            console.warn(`Got array value for ${name}: ${value}`);
            return;
          }
          onChangeEntry(name, value);
        }}
        style={{ width: "100%" }}
        options={valid.map((value) => {
          return { value, label: valid_labels?.[value] ?? value };
        })}
      />
    );
  } else {
    if (password) {
      return (
        <SecretSettingInput
          value={draftValue}
          isSet={isSet}
          isClearing={isClearing}
          multiline={multiline}
          disabled={disabled}
          inputStyle={rowEntryStyle(draftValue, valid)}
          onClear={
            !disabled && onClearSecret ? () => onClearSecret(name) : undefined
          }
          onChange={changeDraft}
          onBlur={commitDraft}
        />
      );
    } else {
      if (multiline != null) {
        const style = {
          ...rowEntryStyle(draftValue, valid),
          fontFamily: "monospace",
          fontSize: "80%",
        } as CSSProperties;
        return (
          <Input.TextArea
            autoComplete="off"
            rows={multiline}
            style={style}
            value={draftValue}
            disabled={disabled}
            onChange={(e) => changeDraft(e.target.value)}
            onBlur={commitDraft}
          />
        );
      } else {
        return (
          <Input
            autoComplete="off"
            style={rowEntryStyle(draftValue, valid)}
            value={draftValue}
            disabled={disabled}
            onChange={(e) => changeDraft(e.target.value)}
            onBlur={commitDraft}
            allowClear={clearable}
          />
        );
      }
    }
  }
}
