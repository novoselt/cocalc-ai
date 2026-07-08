jest.mock("@cocalc/frontend/webapp-client", () => ({
  webapp_client: {
    project_client: {
      directory_listing: jest.fn(),
    },
  },
}));

import { webapp_client } from "@cocalc/frontend/webapp-client";
import { courseDirectoryCopySource } from "./copy-source";

const directoryListing = webapp_client.project_client
  .directory_listing as jest.Mock;

describe("courseDirectoryCopySource", () => {
  beforeEach(() => {
    directoryListing.mockReset();
  });

  it("uses base-relative child paths for non-empty directories", async () => {
    directoryListing.mockResolvedValue({
      files: [{ name: "a.ipynb" }, { name: ".private" }, { name: "data" }],
    });

    await expect(
      courseDirectoryCopySource({ project_id: "project-1", path: "handout" }),
    ).resolves.toEqual({
      project_id: "project-1",
      base_path: "handout",
      path: ["handout/a.ipynb", "handout/data"],
    });
    expect(directoryListing).toHaveBeenCalledWith({
      project_id: "project-1",
      path: "handout",
      hidden: false,
    });
  });

  it("keeps single-path copy semantics for empty directories", async () => {
    directoryListing.mockResolvedValue({ files: [] });

    await expect(
      courseDirectoryCopySource({ project_id: "project-1", path: "empty" }),
    ).resolves.toEqual({
      project_id: "project-1",
      path: "empty",
    });
  });

  it("falls back to the original path when the source cannot be listed", async () => {
    directoryListing.mockRejectedValue(new Error("missing"));

    await expect(
      courseDirectoryCopySource({ project_id: "project-1", path: "missing" }),
    ).resolves.toEqual({
      project_id: "project-1",
      path: "missing",
    });
  });
});
