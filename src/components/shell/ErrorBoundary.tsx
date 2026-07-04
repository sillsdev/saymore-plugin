/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { LAMETA_UI_FONT } from "../../lametaTheme";

/**
 * Minimal error boundary so a rendering failure in one tool shows a message
 * instead of blanking the whole app. (Phase 4 expands error handling.)
 */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | undefined }
> {
  state = { error: undefined as Error | undefined };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          css={css`
            max-width: 40rem;
            margin: 3rem auto;
            padding: 1rem;
            font-family: ${LAMETA_UI_FONT};
            color: #b71c1c;
          `}
        >
          <h2>Something went wrong</h2>
          <pre
            css={css`
              white-space: pre-wrap;
            `}
          >
            {String(this.state.error.message)}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
