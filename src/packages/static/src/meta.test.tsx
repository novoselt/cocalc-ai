import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, waitFor } from "@testing-library/react";
import Meta from "./meta";

test("the application shell declares its language", () => {
  const html = readFileSync(join(__dirname, "app.html"), "utf8");
  expect(html).toMatch(/<html lang="en">/);
});

test("the application viewport permits browser zoom", async () => {
  const { unmount } = render(<Meta />);

  await waitFor(() => {
    const viewport = document.head.querySelector<HTMLMetaElement>(
      'meta[data-cocalc-head-tag="true"][name="viewport"]',
    );
    expect(viewport).not.toBeNull();
    expect(viewport?.content).toBe("width=device-width,initial-scale=1");
  });

  unmount();
});
