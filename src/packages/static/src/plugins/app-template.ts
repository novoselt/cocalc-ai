import { readFileSync } from "fs";
import { resolve } from "path";
import {
  PUBLIC_BODY_PLACEHOLDER,
  PUBLIC_HEAD_PLACEHOLDER,
} from "@cocalc/util/public-site-metadata";

const PUBLIC_HEAD_TEMPLATE_TOKEN = "<!-- cocalc-public-head-placeholder -->";
const PUBLIC_BODY_TEMPLATE_TOKEN = "<!-- cocalc-public-body-placeholder -->";

function replaceExactlyOnce(
  template: string,
  token: string,
  replacement: string,
): string {
  const index = template.indexOf(token);
  if (index < 0 || template.indexOf(token, index + token.length) >= 0) {
    throw new Error(`app.html must contain exactly one ${token}`);
  }
  return (
    template.slice(0, index) +
    replacement +
    template.slice(index + token.length)
  );
}

export function renderAppTemplate(): string {
  const template = readFileSync(resolve(__dirname, "../app.html"), "utf8");
  return replaceExactlyOnce(
    replaceExactlyOnce(
      template,
      PUBLIC_HEAD_TEMPLATE_TOKEN,
      PUBLIC_HEAD_PLACEHOLDER,
    ),
    PUBLIC_BODY_TEMPLATE_TOKEN,
    PUBLIC_BODY_PLACEHOLDER,
  );
}
