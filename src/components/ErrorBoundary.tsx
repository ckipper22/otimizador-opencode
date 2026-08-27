import { Component, type ReactNode, type ErrorInfo } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, errorInfo: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    console.error("[ERROR_BOUNDARY]", error, errorInfo);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          fontFamily: "monospace",
          padding: "2rem",
          margin: "2rem",
          backgroundColor: "#1a1a2e",
          color: "#e0e0e0",
          borderRadius: "8px",
          border: "1px solid #e74c3c",
          overflow: "auto",
          maxHeight: "90vh",
        }}>
          <h2 style={{ color: "#e74c3c", margin: "0 0 1rem" }}>Erro inesperado</h2>
          <pre style={{
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            backgroundColor: "#0d1117",
            padding: "1rem",
            borderRadius: "4px",
            overflow: "auto",
            fontSize: "12px",
          }}>
            {this.state.error.message}
            {"\n\n"}
            {this.state.error.stack}
            {"\n\n"}
            Component Stack:
            {"\n"}
            {this.state.errorInfo?.componentStack}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: "1rem",
              padding: "0.5rem 1.5rem",
              backgroundColor: "#e74c3c",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontFamily: "monospace",
            }}
          >
            Recarregar
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
