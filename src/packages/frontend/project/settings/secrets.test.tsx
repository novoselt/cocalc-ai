/** @jest-environment jsdom */

import { render } from "@testing-library/react";
import { ProjectSecretsModal } from "./secrets";

const mockRefresh = jest.fn();

jest.mock("antd", () => {
  const Container = ({ children }: any) => <div>{children}</div>;
  const Input = (props: any) => <input {...props} />;
  Input.TextArea = ({ autoSize: _autoSize, ...props }: any) => (
    <textarea {...props} />
  );
  return {
    Alert: Container,
    Button: ({ children }: any) => <button type="button">{children}</button>,
    Checkbox: Container,
    Input,
    Modal: ({ children, open }: any) => (open ? <div>{children}</div> : null),
    Popconfirm: Container,
    Space: Container,
    Typography: { Text: Container },
  };
});

jest.mock("@cocalc/frontend/app-framework", () => {
  const React = require("react");
  return {
    React,
    useEffect: React.useEffect,
    useIsMountedRef: () => ({ current: true }),
    useMemo: React.useMemo,
    useState: React.useState,
  };
});

jest.mock("@cocalc/frontend/auth/fresh-auth", () => ({
  FreshAuthModal: () => null,
  isFreshAuthRequiredError: () => false,
  useFreshAuthAction: () => ({
    freshAuthModalProps: {},
    runFreshAuthAction: jest.fn(),
  }),
}));

jest.mock("@cocalc/frontend/components", () => {
  const Container = ({ children }: any) => <div>{children}</div>;
  return {
    ErrorDisplay: Container,
    Gap: () => null,
    HelpIcon: () => null,
    SettingBox: Container,
  };
});

jest.mock("@cocalc/frontend/project/use-project-secrets", () => ({
  useProjectSecrets: () => ({
    refresh: mockRefresh,
    secrets: [],
    setSecrets: jest.fn(),
  }),
}));

jest.mock("@cocalc/frontend/projects/select-project", () => ({
  SelectProject: () => null,
}));

jest.mock("@cocalc/frontend/webapp-client", () => ({
  webapp_client: {},
}));

describe("ProjectSecretsModal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("refreshes secrets whenever the modal opens", () => {
    const { rerender } = render(
      <ProjectSecretsModal
        onClose={jest.fn()}
        open={false}
        project_id="project-1"
      />,
    );

    expect(mockRefresh).not.toHaveBeenCalled();

    rerender(
      <ProjectSecretsModal onClose={jest.fn()} open project_id="project-1" />,
    );
    expect(mockRefresh).toHaveBeenCalledTimes(1);

    rerender(
      <ProjectSecretsModal
        onClose={jest.fn()}
        open={false}
        project_id="project-1"
      />,
    );
    rerender(
      <ProjectSecretsModal onClose={jest.fn()} open project_id="project-1" />,
    );
    expect(mockRefresh).toHaveBeenCalledTimes(2);
  });
});
