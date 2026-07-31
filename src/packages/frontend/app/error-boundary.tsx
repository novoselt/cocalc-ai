/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";

import { COLORS } from "@cocalc/util/theme";

import { markCaughtReactError } from "./react-error-reporting";

interface FallbackProps {
  error: unknown;
  retry: () => void;
  scope: string;
}

interface Props {
  children: ReactNode;
  scope: string;
  autoRetry?: boolean;
  fallback?: ReactNode | ((props: FallbackProps) => ReactNode);
  resetKeys?: readonly unknown[];
}

interface State {
  error: unknown;
  generation: number;
  hasError: boolean;
  retries: number;
}

function resetKeysChanged(
  previous: readonly unknown[] | undefined,
  current: readonly unknown[] | undefined,
): boolean {
  if (previous === current) return false;
  if (previous == null || current == null) return true;
  if (previous.length !== current.length) return true;
  return previous.some((value, index) => !Object.is(value, current[index]));
}

export class CocalcErrorBoundary extends Component<Props, State> {
  state: State = {
    error: undefined,
    generation: 0,
    hasError: false,
    retries: 0,
  };

  private retryTimer: ReturnType<typeof setTimeout> | undefined;

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error, hasError: true };
  }

  componentDidCatch(error: unknown, _info: ErrorInfo): void {
    markCaughtReactError(error, this.props.scope);
    if (this.props.autoRetry !== false && this.state.retries === 0) {
      this.retryTimer = setTimeout(() => {
        this.retryTimer = undefined;
        this.setState(({ generation }) => ({
          error: undefined,
          generation: generation + 1,
          hasError: false,
          retries: 1,
        }));
      }, 0);
    }
  }

  componentDidUpdate(previousProps: Props): void {
    if (
      this.state.hasError &&
      resetKeysChanged(previousProps.resetKeys, this.props.resetKeys)
    ) {
      this.reset(0);
    }
  }

  componentWillUnmount(): void {
    if (this.retryTimer != null) {
      clearTimeout(this.retryTimer);
    }
  }

  private reset = (retries = this.state.retries): void => {
    if (this.retryTimer != null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
    this.setState(({ generation }) => ({
      error: undefined,
      generation: generation + 1,
      hasError: false,
      retries,
    }));
  };

  private retry = (): void => {
    this.reset(this.state.retries + 1);
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (typeof this.props.fallback === "function") {
        return this.props.fallback({
          error: this.state.error,
          retry: this.retry,
          scope: this.props.scope,
        });
      }
      if (this.props.fallback != null) {
        return this.props.fallback;
      }
      return (
        <div
          data-error-boundary={this.props.scope}
          role="alert"
          style={{
            alignItems: "center",
            background: COLORS.GRAY_LLL,
            color: COLORS.GRAY_D,
            display: "flex",
            flex: "1 1 auto",
            flexDirection: "column",
            gap: "8px",
            justifyContent: "center",
            minHeight: "80px",
            padding: "16px",
            textAlign: "center",
          }}
        >
          <strong>This part of CoCalc could not be displayed.</strong>
          <span>The error was reported automatically.</span>
          <button
            onClick={this.retry}
            style={{
              background: COLORS.BLUE_D,
              border: 0,
              borderRadius: "4px",
              color: "white",
              cursor: "pointer",
              padding: "6px 12px",
            }}
            type="button"
          >
            Try again
          </button>
        </div>
      );
    }

    return (
      <Fragment key={this.state.generation}>{this.props.children}</Fragment>
    );
  }
}
