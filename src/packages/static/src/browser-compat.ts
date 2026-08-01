/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

type CompatibleObjectConstructor = ObjectConstructor & {
  hasOwn?: (object: object, property: PropertyKey) => boolean;
};

const compatibleObject = Object as CompatibleObjectConstructor;

export function installBrowserCompatibility(): void {
  if (typeof compatibleObject.hasOwn === "function") {
    return;
  }

  Object.defineProperty(Object, "hasOwn", {
    configurable: true,
    writable: true,
    value(object: object, property: PropertyKey): boolean {
      return Object.prototype.hasOwnProperty.call(object, property);
    },
  });
}
