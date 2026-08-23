import type { DocumentBuildSnapshot } from "@cocalc/app-document-build";
import { webapp_client } from "@cocalc/frontend/webapp-client";
import { Actions } from "./actions";

function queued(): DocumentBuildSnapshot {
  return {
    build_id: "build-qmd",
    generation: "23",
    identity: {
      kind: "quarto",
      logical_path: "docs/report.qmd",
      working_path: "docs/report.qmd",
      resource_key: "docs/report.qmd",
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

describe("Quarto project-side builds", () => {
  afterEach(() => jest.restoreAllMocks());

  it("submits saved-source metadata instead of running quarto in the browser", async () => {
    const start = jest.fn(async () => queued());
    jest.spyOn(webapp_client.project_client, "conatApi").mockReturnValue({
      documentBuild: { start },
    } as any);
    const actions: any = Object.create(Actions.prototype);
    actions.project_id = "project-1";
    actions.path = "docs/report.qmd";
    actions.starting_build = false;
    actions._syncstring = {
      get_state: () => "ready",
      hash_of_saved_version: () => 23,
      to_str: () => "---\ntitle: Test\n---\n\n# Report\n",
    };
    actions.set_status = jest.fn();
    actions.setState = jest.fn();
    actions.set_error = jest.fn();
    actions.apply_build_snapshot = jest.fn(async () => undefined);

    await (Actions.prototype as any)._run_qmd_converter.call(
      actions,
      23,
      false,
    );

    expect(start).toHaveBeenCalledWith({
      path: "docs/report.qmd",
      generation: "23",
      expected_source_hash: 23,
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
    actions.active_build_id = "build-qmd";
    actions.apply_build_snapshot = jest.fn(async () => undefined);
    actions.set_status = jest.fn();
    actions.setState = jest.fn();

    await Actions.prototype.stop_build.call(actions, "");

    expect(cancel).toHaveBeenCalledWith("build-qmd");
    expect(actions.apply_build_snapshot).toHaveBeenCalledWith(canceled);
  });

  it("does not attach an idempotency generation to an explicit build", async () => {
    const start = jest.fn(async () => queued());
    jest.spyOn(webapp_client.project_client, "conatApi").mockReturnValue({
      documentBuild: { start },
    } as any);
    const actions: any = Object.create(Actions.prototype);
    actions.project_id = "project-1";
    actions.path = "docs/report.qmd";
    actions.starting_build = false;
    actions._syncstring = {
      get_state: () => "ready",
      hash_of_saved_version: () => 23,
      to_str: () => "# Report\n",
    };
    actions.set_status = jest.fn();
    actions.setState = jest.fn();
    actions.set_error = jest.fn();
    actions.apply_build_snapshot = jest.fn(async () => undefined);

    await (Actions.prototype as any)._run_qmd_converter.call(
      actions,
      undefined,
      false,
    );

    expect(start).toHaveBeenCalledWith({
      path: "docs/report.qmd",
      expected_source_hash: 23,
      force: false,
    });
  });
});
