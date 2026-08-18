/** @jest-environment jsdom */

/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

let setting: boolean | undefined;

jest.mock("@cocalc/frontend/app-framework", () => ({
  useAccountOtherSetting: () => setting,
}));

import { renderHook } from "@testing-library/react";

import {
  ANIMATIONS_ATTRIBUTE,
  useAnimatedTransition,
  useAnimationsEnabled,
  useAnimationsRootAttribute,
} from "./animations";

const TRANSITION = "flex-basis 200ms ease";

describe("animations preference", () => {
  afterEach(() => {
    document.documentElement.removeAttribute(ANIMATIONS_ATTRIBUTE);
  });

  it("is enabled when the account setting is unset", () => {
    setting = undefined;
    expect(renderHook(() => useAnimationsEnabled()).result.current).toBe(true);
    expect(
      renderHook(() => useAnimatedTransition(TRANSITION)).result.current,
    ).toBe(TRANSITION);
  });

  it("drops the transition when the setting is off", () => {
    setting = false;
    expect(renderHook(() => useAnimationsEnabled()).result.current).toBe(false);
    expect(
      renderHook(() => useAnimatedTransition(TRANSITION)).result.current,
    ).toBeUndefined();
  });

  it("keeps the transition when the setting is on", () => {
    setting = true;
    expect(
      renderHook(() => useAnimatedTransition(TRANSITION)).result.current,
    ).toBe(TRANSITION);
  });

  it("publishes the preference on the document root for stylesheets", () => {
    setting = false;
    renderHook(() => useAnimationsRootAttribute());
    expect(document.documentElement.getAttribute(ANIMATIONS_ATTRIBUTE)).toBe(
      "off",
    );

    setting = true;
    renderHook(() => useAnimationsRootAttribute());
    expect(document.documentElement.getAttribute(ANIMATIONS_ATTRIBUTE)).toBe(
      "on",
    );
  });
});
