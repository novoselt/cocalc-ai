import { EventEmitter } from "events";
import { ExecJobGroupWatcher } from "./exec-job-watcher";

const tick = async () => await new Promise((resolve) => setTimeout(resolve, 0));

describe("ExecJobGroupWatcher", () => {
  it("announces a snapshot when live completion wins the startup race", async () => {
    const job_group = "build:doc.tex";
    const output = {
      aggregate: 7,
      exit_code: 0,
      job_group,
      job_id: "job-1",
      job_key: "latex:doc.tex",
      start: Date.now(),
      status: "running",
      stderr: "",
      stdout: "partial",
      type: "async",
    } as const;
    const subscription = {
      close: jest.fn(),
      async *[Symbol.asyncIterator]() {
        yield {
          data: {
            aggregate: 7,
            data: { ...output, status: "completed" },
            job_group,
            job_id: "job-1",
            job_key: "latex:doc.tex",
            seq: 2,
            type: "done",
          },
        };
      },
    };
    const client = Object.assign(new EventEmitter(), {
      request: jest.fn(async () => ({
        data: { snapshots: [{ output, seq: 2 }] },
      })),
      subscribe: jest.fn(async () => subscription),
    });
    const watcher = new ExecJobGroupWatcher({
      getClient: async () => client as any,
      job_group,
      project_id: "project-1",
    });
    const jobs: any[] = [];
    watcher.on("job", (job) => jobs.push(job));

    await tick();
    await tick();
    expect(jobs).toEqual([output]);

    client.emit("connected");
    await tick();
    expect(jobs).toEqual([output]);

    watcher.close();
    expect(subscription.close).toHaveBeenCalled();
  });
});
