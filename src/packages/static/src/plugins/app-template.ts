import { readFileSync } from "fs";
import { resolve } from "path";
import { PUBLIC_HEAD_PLACEHOLDER } from "@cocalc/util/public-site-metadata";

const PUBLIC_HEAD_TEMPLATE_TOKEN = "<!-- cocalc-public-head-placeholder -->";

export function renderAppTemplate(): string {
  const template = readFileSync(resolve(__dirname, "../app.html"), "utf8");
  const index = template.indexOf(PUBLIC_HEAD_TEMPLATE_TOKEN);
  if (
    index < 0 ||
    template.indexOf(
      PUBLIC_HEAD_TEMPLATE_TOKEN,
      index + PUBLIC_HEAD_TEMPLATE_TOKEN.length,
    ) >= 0
  ) {
    throw new Error(
      "app.html must contain exactly one public head placeholder token",
    );
  }
  return (
    template.slice(0, index) +
    PUBLIC_HEAD_PLACEHOLDER +
    template.slice(index + PUBLIC_HEAD_TEMPLATE_TOKEN.length)
  );
}
