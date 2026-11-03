import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider } from "./contexts/AuthContext";
import { ThemeProvider, useTheme } from "./contexts/ThemeContext";
import AppRoutes from "./routes/AppRoutes";
import "./styles/globals.css";
class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("HostelHub render failure", error, info.componentStack);
  }
  render() {
    return this.state.error ? (
      <main className="center-page">
        <div className="panel settings-panel">
          <h1>Something went wrong</h1>
          <p>Reload the page to reconnect to your workspace.</p>
          {import.meta.env.DEV && (
            <details className="error-details">
              <summary>Development error details</summary>
              <pre>{String(this.state.error?.stack || this.state.error)}</pre>
            </details>
          )}
          <button
            className="button button-primary"
            onClick={() => {
              this.setState({ error: null });
              window.location.reload();
            }}
          >
            Reload page
          </button>
        </div>
      </main>
    ) : (
      this.props.children
    );
  }
}
function App() {
  const { theme } = useTheme();
  return (
    <>
      <AppRoutes />
      <Toaster theme={theme} richColors position="bottom-right" />
    </>
  );
}
const rootElement = document.getElementById("root");
// Vite keeps this data across entry-module updates during local development.
const root = import.meta.hot?.data.root || createRoot(rootElement);
if (import.meta.hot) import.meta.hot.data.root = root;

root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
