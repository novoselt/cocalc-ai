import { PUBLIC_HEAD_PLACEHOLDER } from "@cocalc/util/public-site-metadata";
import { renderAppTemplate } from "./app-template";

test("renders the shared public head placeholder into the app template", () => {
  const html = renderAppTemplate();
  expect(html.split(PUBLIC_HEAD_PLACEHOLDER)).toHaveLength(2);
  expect(html).not.toContain("cocalc-public-head-placeholder");
});
