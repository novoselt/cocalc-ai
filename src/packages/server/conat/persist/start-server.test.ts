import { EventEmitter } from "node:events";

const SIGNALS = ["exit", "SIGTERM", "SIGQUIT"] as const;

function removeAddedListeners(
  before: Record<(typeof SIGNALS)[number], Function[]>,
) {
  for (const signal of SIGNALS) {
    for (const listener of process.rawListeners(signal)) {
      if (!before[signal].includes(listener)) {
        process.removeListener(signal, listener as (...args: any[]) => void);
      }
    }
  }
}

describe("persist child process lifecycle", () => {
  it("does not change process signal handling when merely imported", () => {
    const before = Object.fromEntries(
      SIGNALS.map((signal) => [signal, process.rawListeners(signal)]),
    ) as Record<(typeof SIGNALS)[number], Function[]>;

    try {
      jest.isolateModules(() => {
        require("./start-server");
      });
      for (const signal of SIGNALS) {
        expect(process.rawListeners(signal)).toEqual(before[signal]);
      }
    } finally {
      removeAddedListeners(before);
    }
  });

  it("installs forwarding handlers only after forking a child", () => {
    const child = new EventEmitter() as EventEmitter & {
      send: jest.Mock;
      kill: jest.Mock;
    };
    child.send = jest.fn();
    child.kill = jest.fn();
    const fork = jest.fn(() => child);
    jest.doMock("node:child_process", () => ({ fork }));

    const before = Object.fromEntries(
      SIGNALS.map((signal) => [signal, process.rawListeners(signal)]),
    ) as Record<(typeof SIGNALS)[number], Function[]>;

    try {
      jest.isolateModules(() => {
        const { createForkedPersistServer } = require("./start-server");
        createForkedPersistServer("persist-1");
      });
      expect(fork).toHaveBeenCalledTimes(1);
      for (const signal of SIGNALS) {
        expect(process.rawListeners(signal)).toHaveLength(
          before[signal].length + 1,
        );
      }
    } finally {
      removeAddedListeners(before);
      jest.dontMock("node:child_process");
    }
  });
});
