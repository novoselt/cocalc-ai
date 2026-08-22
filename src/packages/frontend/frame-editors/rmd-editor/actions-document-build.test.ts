import type { DocumentBuildSnapshot } from "@cocalc/app-document-build";
import { webapp_client } from "@cocalc/frontend/webapp-client";
import { Actions } from "./actions";

function queued(): DocumentBuildSnapshot {
  return {
    build_id: "build-rmd",
    generation: "17",
    identity: {
      kind: "r-markdown",
      logical_path: "docs/report.Rmd",
      working_path: "docs/report.Rmd",
      resource_key: "docs/report.Rmd",
    },
    state: "queued",
    seq: 1,
    submitted_at: 1,
    build_timeout_ms: 60_000,
    force: false,
    stages: [],
    diagnostics: [],
    dependencies: [],
    artifacts: [],
  };
}

describe("R Markdown project-side builds", () => {
  afterEach(() => jest.restoreAllMocks());

  it("submits saved-source metadata instead of running Rscript in the browser", async () => {
    const start = jest.fn(async () => queued());
    jest.spyOn(webapp_client.project_client, "conatApi").mockReturnValue({
      documentBuild: { start },
    } as any);
    const actions: any = Object.create(Actions.prototype);
    actions.project_id = "project-1";
    actions.path = "docs/report.Rmd";
    actions.starting_build = false;
    actions._syncstring = {
      get_state: () => "ready",
      hash_of_saved_version: () => 17,
      to_str: () => "---\ntitle: Test\n---\n\n# Report\n",
    };
    actions.set_status = jest.fn();
    actions.setState = jest.fn();
    actions.set_error = jest.fn();
    actions.apply_build_snapshot = jest.fn(async () => undefined);

    await (Actions.prototype as any)._run_rmd_converter.call(
      actions,
      17,
      false,
    );

    expect(start).toHaveBeenCalledWith({
      path: "docs/report.Rmd",
      generation: "17",
      expected_source_hash: 17,
      force: false,
    });
    expect(actions.apply_build_snapshot).toHaveBeenCalledWith(queued());
    expect(actions.setState).toHaveBeenCalledWith(
      expect.objectContaining({ value: expect.any(String) }),
    );
  });

  it("cancels the active project build by build id", async () => {
    const canceled = { ...queued(), state: "canceled", seq: 2 } as const;
    const cancel = jest.fn(async () => canceled);
    jest.spyOn(webapp_client.project_client, "conatApi").mockReturnValue({
      documentBuild: { cancel },
    } as any);
    const actions: any = Object.create(Actions.prototype);
    actions.project_id = "project-1";
    actions.active_build_id = "build-rmd";
    actions.apply_build_snapshot = jest.fn(async () => undefined);
    actions.set_status = jest.fn();
    actions.setState = jest.fn();

    await Actions.prototype.stop_build.call(actions, "");

    expect(cancel).toHaveBeenCalledWith("build-rmd");
    expect(actions.apply_build_snapshot).toHaveBeenCalledWith(canceled);
  });

  it("does not attach an idempotency generation to an explicit build", async () => {
    const start = jest.fn(async () => queued());
    jest.spyOn(webapp_client.project_client, "conatApi").mockReturnValue({
      documentBuild: { start },
    } as any);
    const actions: any = Object.create(Actions.prototype);
    actions.project_id = "project-1";
    actions.path = "docs/report.Rmd";
    actions.starting_build = false;
    actions._syncstring = {
      get_state: () => "ready",
      hash_of_saved_version: () => 17,
      to_str: () => "# Report\n",
    };
    actions.set_status = jest.fn();
    actions.setState = jest.fn();
    actions.set_error = jest.fn();
    actions.apply_build_snapshot = jest.fn(async () => undefined);

    await (Actions.prototype as any)._run_rmd_converter.call(
      actions,
      undefined,
      false,
    );

    expect(start).toHaveBeenCalledWith({
      path: "docs/report.Rmd",
      expected_source_hash: 17,
      force: false,
    });
  });

  it("does not clear building state when another client build is active", async () => {
    const actions: any = Object.create(Actions.prototype);
    actions.active_build_id = "build-rmd";
    actions.build_watcher = {
      latestActiveBuildId: () => "build-newer",
    };
    actions.last_snapshot_seq = new Map();
    actions.set_status = jest.fn();
    actions.setState = jest.fn();
    actions.set_error = jest.fn();
    actions.reload = jest.fn();
    actions._check_produced_files = jest.fn(async () => undefined);
    const completed = {
      ...queued(),
      state: "succeeded",
      seq: 2,
      exit_code: 0,
    } as DocumentBuildSnapshot;

    await (Actions.prototype as any).apply_build_snapshot.call(
      actions,
      completed,
    );

    expect(actions.active_build_id).toBe("build-newer");
    expect(actions.setState).toHaveBeenCalledWith({ building: true });
    expect(actions.set_status).toHaveBeenLastCalledWith("Running RMarkdown...");
  });
});
