/** @jest-environment jsdom */

import { html_to_text } from "./misc";

describe("html_to_text", () => {
  it("extracts text without requiring jQuery", () => {
    expect(
      html_to_text(
        "<p>Hello <strong>CoCalc</strong></p><script>not text</script>",
      ),
    ).toBe("Hello CoCalc");
  });
});
