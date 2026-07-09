/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  flushServiceAdmissionDenialsForTests,
  recordServiceAdmissionDenial,
  resetServiceAdmissionDenialsForTests,
  setServiceAdmissionDenialRecorder,
  type ServiceAdmissionDenialEvent,
} from "./denials";

describe("service admission denial recorder", () => {
  afterEach(() => {
    resetServiceAdmissionDenialsForTests();
  });

  it("records the first denial immediately and aggregates repeated denials", async () => {
    const recorded: ServiceAdmissionDenialEvent[] = [];
    setServiceAdmissionDenialRecorder((event) => {
      recorded.push(event);
    });

    const event: ServiceAdmissionDenialEvent = {
      surface: "conat-socket",
      source: "socket",
      limit: "COCALC_CONAT_MAX_INBOUND_EVENTS_PER_SOCKET_WINDOW",
      current: 10001,
      maximum: 10000,
      reason: "high-rate Conat socket event stream",
      account_id: "account-1",
      browser_id: "browser-1",
      socket_id: "socket-1",
      subject: "subscriptions",
      key: "socket-1",
      time: 1000,
    };

    recordServiceAdmissionDenial(event);
    recordServiceAdmissionDenial({ ...event, current: 10002, time: 1001 });
    recordServiceAdmissionDenial({ ...event, current: 10003, time: 1002 });
    recordServiceAdmissionDenial({ ...event, current: 10004, time: 1003 });

    await Promise.resolve();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      count: 1,
      suppressed_count: 0,
      first_time: 1000,
      last_time: 1000,
    });

    await flushServiceAdmissionDenialsForTests();

    expect(recorded).toHaveLength(2);
    expect(recorded[1]).toMatchObject({
      count: 3,
      suppressed_count: 3,
      current: 10004,
      maximum: 10000,
      first_time: 1001,
      last_time: 1003,
      browser_id: "browser-1",
      socket_id: "socket-1",
      subject: "subscriptions",
    });
  });
});
