const mockConnect = jest.fn(() => ({ info: undefined }));

jest.mock("@cocalc/backend/data", () => ({
  apiKey: undefined,
  conatPassword: undefined,
  conatServer: "http://conat.example.com",
}));

jest.mock("@cocalc/conat/core/client", () => ({ connect: mockConnect }));

jest.mock("@cocalc/conat/client", () => ({
  setConatClient: jest.fn(),
}));

jest.mock("@cocalc/project/data", () => ({
  project_id: "812abe34-a382-4bd1-9071-29b6f4334f03",
  secretToken: "secret-token",
}));

jest.mock("@cocalc/project/logger", () => ({
  getLogger: () => ({ debug: jest.fn() }),
}));

import {
  connectToConat,
  INITIAL_PROJECT_CONAT_CONNECTION_POLICY,
} from "./connection";

describe("project Conat connection", () => {
  const originalFastStartupRetry =
    process.env.COCALC_PROJECT_CONAT_FAST_STARTUP_RETRY;

  afterEach(() => {
    mockConnect.mockClear();
    if (originalFastStartupRetry == null) {
      delete process.env.COCALC_PROJECT_CONAT_FAST_STARTUP_RETRY;
    } else {
      process.env.COCALC_PROJECT_CONAT_FAST_STARTUP_RETRY =
        originalFastStartupRetry;
    }
  });

  it("uses the bounded initial connection policy by default", () => {
    delete process.env.COCALC_PROJECT_CONAT_FAST_STARTUP_RETRY;

    connectToConat();

    expect(mockConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        initialConnectionPolicy: INITIAL_PROJECT_CONAT_CONNECTION_POLICY,
      }),
    );
  });

  it("allows the initial connection policy to be disabled", () => {
    process.env.COCALC_PROJECT_CONAT_FAST_STARTUP_RETRY = "0";

    connectToConat();

    expect(mockConnect).toHaveBeenCalledWith(
      expect.objectContaining({ initialConnectionPolicy: undefined }),
    );
  });
});
