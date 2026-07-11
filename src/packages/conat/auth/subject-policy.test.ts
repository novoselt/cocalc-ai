import {
  checkCommonPermissions,
  extractProjectSubject,
  extractViewerFileSubject,
  isFileServerManagementSubject,
  isProjectAllowed,
} from "./subject-policy";
import { inboxPrefix } from "@cocalc/conat/names";

describe("conat auth subject policy", () => {
  const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

  it("treats file-server subjects as project subjects", () => {
    expect(extractProjectSubject(`file-server.${PROJECT_ID}`)).toBe(PROJECT_ID);
    expect(extractProjectSubject(`file-server.${PROJECT_ID}.api`)).toBe(
      PROJECT_ID,
    );
  });

  it("denies project identities access to file-server management subjects", () => {
    expect(
      isProjectAllowed({
        project_id: PROJECT_ID,
        subject: `file-server.${PROJECT_ID}.api`,
      }),
    ).toBe(false);
    expect(isFileServerManagementSubject(`file-server.${PROJECT_ID}`)).toBe(
      true,
    );
    expect(isFileServerManagementSubject(`fs.project-${PROJECT_ID}`)).toBe(
      false,
    );
  });

  it("extracts viewer file subjects", () => {
    expect(
      extractViewerFileSubject(
        `fs-viewer.project-${PROJECT_ID}.account-${PROJECT_ID}`,
      ),
    ).toEqual({ project_id: PROJECT_ID, account_id: PROJECT_ID });
    expect(extractViewerFileSubject(`fs.project-${PROJECT_ID}`)).toBe(
      undefined,
    );
  });

  it("denies subscribing to another identity's inbox before project fallback", () => {
    expect(
      checkCommonPermissions({
        user: { account_id: "22222222-2222-4222-8222-222222222222" },
        userType: "account",
        userId: "22222222-2222-4222-8222-222222222222",
        subject: inboxPrefix({ project_id: PROJECT_ID }),
        type: "sub",
      }),
    ).toBe(false);
  });
});
