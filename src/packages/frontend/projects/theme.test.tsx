/** @jest-environment jsdom */

import { render } from "@testing-library/react";
import { ProjectThemeAvatar } from "./theme";

test("project image avatars are decorative when shown beside a project name", () => {
  const { container } = render(
    <ProjectThemeAvatar
      theme={{ image_blob: "e7a14cd0-240c-4b8c-a78b-cb1da072b528" }}
    />,
  );

  expect(container.querySelector("img")).toHaveAttribute("alt", "");
});
