jest.mock("@cocalc/backend/execute-code", () => ({
  getAsyncJobGroupSnapshot: jest.fn(),
  onAsyncJobGroupEvent: jest.fn(),
}));

jest.mock("@cocalc/project/conat/runtime-client", () => ({
  getProjectConatClient: jest.fn(),
}));

jest.mock("@cocalc/project/data", () => ({
  project_id: "runtime-project",
}));

import {
  getAsyncJobGroupSnapshot,
  onAsyncJobGroupEvent,
} from "@cocalc/backend/execute-code";
import {
  execJobEventsSubject,
  execJobSnapshotSubject,
} from "@cocalc/conat/project/exec-jobs";
import { init } from "./exec-job-watch";

const PROJECT_ID = "project-1";

describe("project exec job watch service", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("publishes authoritative lifecycle events and serves snapshots", async () => {
    const respondSync = jest.fn();
    const close = jest.fn();
    const subscription = {
      close,
      async *[Symbol.asyncIterator]() {
        yield { data: { job_group: "build:doc.tex" }, respondSync };
      },
    } as any;
    const subscribe = jest.fn().mockResolvedValue(subscription);
    const publishSync = jest.fn();
    const stopPublishing = jest.fn();
    let publishEvent!: (event: any) => void;
    jest.mocked(onAsyncJobGroupEvent).mockImplementation((listener) => {
      publishEvent = listener;
      return stopPublishing;
    });
    const snapshots = [{ output: { job_id: "job-1" }, seq: 3 }];
    jest.mocked(getAsyncJobGroupSnapshot).mockReturnValue(snapshots as any);

    const service = await init({
      client: { publishSync, subscribe } as any,
      project_id: PROJECT_ID,
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(subscribe).toHaveBeenCalledWith(
      execJobSnapshotSubject({ project_id: PROJECT_ID }),
      { queue: "q" },
    );
    expect(respondSync).toHaveBeenCalledWith({ snapshots });

    const event = {
      job_group: "build:doc.tex",
      job_id: "job-1",
      seq: 1,
      type: "job",
    };
    publishEvent(event);
    expect(publishSync).toHaveBeenCalledWith(
      execJobEventsSubject({
        project_id: PROJECT_ID,
        job_group: event.job_group,
      }),
      event,
    );

    service.close();
    expect(stopPublishing).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });
});
