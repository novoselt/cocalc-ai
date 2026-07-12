jest.mock("p-limit", () => ({
  __esModule: true,
  default: () =>
    Object.assign((fn: () => unknown) => Promise.resolve().then(fn), {
      activeCount: 0,
      pendingCount: 0,
    }),
}));

import {
  ACP_CLIENT_REFRESH_REQUIRED_CODE,
  ACP_CLIENT_REFRESH_REQUIRED_MESSAGE,
  ACP_SUBJECT_ROOT,
} from "./subjects";
import { __test__ } from "./server";

describe("ACP server subject identity binding", () => {
  const project_id = "00000000-0000-4000-8000-000000000001";
  const other_project_id = "00000000-0000-4000-8000-000000000002";
  const account_id = "00000000-0000-4000-8000-000000000003";
  const other_account_id = "00000000-0000-4000-8000-000000000004";
  const subject = `${ACP_SUBJECT_ROOT}.project-${project_id}.account-${account_id}.api`;

  it("derives both identities from the subject", () => {
    const options: any = { prompt: "hello", chat: {} };

    __test__.bindOptionsToSubject(options, subject, "api");

    expect(options).toMatchObject({
      account_id,
      project_id,
      chat: { project_id },
    });
  });

  it("rejects payload account mismatches", () => {
    expect(() =>
      __test__.bindOptionsToSubject(
        { account_id: other_account_id, project_id },
        subject,
        "api",
      ),
    ).toThrow("account_id does not match subject");
  });

  it("rejects payload project mismatches", () => {
    expect(() =>
      __test__.bindOptionsToSubject(
        { account_id, project_id: other_project_id },
        subject,
        "api",
      ),
    ).toThrow("project_id does not match subject");
  });

  it("rejects nested chat project mismatches", () => {
    expect(() =>
      __test__.bindOptionsToSubject(
        {
          account_id,
          project_id,
          chat: { project_id: other_project_id },
        },
        subject,
        "api",
      ),
    ).toThrow("chat.project_id does not match subject");
  });

  it("rejects legacy and wrong-operation subjects for execution", () => {
    expect(() =>
      __test__.bindOptionsToSubject(
        { account_id, project_id },
        `${ACP_SUBJECT_ROOT}.project-${project_id}.api`,
        "api",
      ),
    ).toThrow("ACP subject must bind an account and project");
    expect(() =>
      __test__.bindOptionsToSubject(
        { account_id, project_id },
        `${ACP_SUBJECT_ROOT}.project-${project_id}.account-${account_id}.interrupt`,
        "api",
      ),
    ).toThrow("ACP subject must bind an account and project");
  });
});

describe("legacy ACP compatibility response", () => {
  const project_id = "00000000-0000-4000-8000-000000000001";

  it("terminates legacy streaming requests without executing work", async () => {
    const respond = jest.fn().mockResolvedValue(undefined);

    await __test__.rejectLegacyRequest(
      {
        subject: `${ACP_SUBJECT_ROOT}.project-${project_id}.api`,
        respond,
      },
      "api",
    );

    expect(respond).toHaveBeenNthCalledWith(
      1,
      {
        seq: 0,
        type: "error",
        code: ACP_CLIENT_REFRESH_REQUIRED_CODE,
        error: ACP_CLIENT_REFRESH_REQUIRED_MESSAGE,
        retryable: false,
      },
      { noThrow: true },
    );
    expect(respond).toHaveBeenNthCalledWith(2, null, { noThrow: true });
  });

  it("returns a non-retryable error for legacy control requests", async () => {
    const respond = jest.fn().mockResolvedValue(undefined);

    await __test__.rejectLegacyRequest(
      {
        subject: `${ACP_SUBJECT_ROOT}.project-${project_id}.interrupt`,
        respond,
      },
      "interrupt",
    );

    expect(respond).toHaveBeenCalledWith(
      {
        code: ACP_CLIENT_REFRESH_REQUIRED_CODE,
        error: ACP_CLIENT_REFRESH_REQUIRED_MESSAGE,
        retryable: false,
      },
      { noThrow: true },
    );
  });
});
