/** @jest-environment jsdom */

let Dropzone: typeof import("dropzone").default;

describe("Dropzone native file input lifecycle", () => {
  beforeAll(() => {
    // Bypass the general frontend Dropzone mock: this is a regression test for
    // the patched third-party native-input listener itself.
    (globalThis.jQuery as any).fn = {};
    Dropzone = jest.requireActual("dropzone/dist/dropzone.js").default;
  });

  it("ignores a file-picker change dispatched after teardown", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const dropzone = new Dropzone(element, { url: "/upload" });
    const input = dropzone.hiddenFileInput;
    const errors: unknown[] = [];
    const onError = (event: ErrorEvent) => errors.push(event.error);
    window.addEventListener("error", onError);

    try {
      dropzone.destroy();
      input.dispatchEvent(new Event("change"));
      expect(errors).toEqual([]);
    } finally {
      window.removeEventListener("error", onError);
      element.remove();
    }
  });
});
