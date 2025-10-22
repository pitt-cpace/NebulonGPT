import React from 'react';
import ReactDOM from 'react-dom/client';
// Styles are now fully migrated to globalStyles.ts
import App from './App';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import theme from './styles/theme';
import getGlobalStyleOverrides from './styles/globalStyles';

// Suppress benign ResizeObserver loop warnings
// This prevents React's error overlay from showing non-fatal Chrome diagnostics
if (typeof window !== 'undefined') {
  const isROLoop = (msg?: any) =>
    typeof msg === 'string' && msg.includes('ResizeObserver loop');

  // Capture phase so we beat CRA/Vite overlay listeners
  const onErrorCapture = (event: ErrorEvent) => {
    if (isROLoop(event.message)) {
      event.stopImmediatePropagation();
      event.preventDefault();
    }
  };
  const onRejectionCapture = (event: PromiseRejectionEvent) => {
    const msg =
      (event.reason && (event.reason.message || String(event.reason))) || '';
    if (isROLoop(msg)) {
      event.stopImmediatePropagation();
      event.preventDefault();
    }
  };

  window.addEventListener('error', onErrorCapture, { capture: true });
  window.addEventListener('unhandledrejection', onRejectionCapture, {
    capture: true,
  });

  // Also mute the console copy the overlay prints
  const origError = console.error;
  console.error = (...args: any[]) => {
    if (args[0] && isROLoop(String(args[0]))) return;
    origError(...args);
  };

  // CRA overlay escape hatch (present in CRA setups)
  // @ts-ignore
  if (window.__REACT_ERROR_OVERLAY_GLOBAL_HOOK__) {
    // @ts-ignore
    const hook = window.__REACT_ERROR_OVERLAY_GLOBAL_HOOK__;
    if (typeof hook.stopReportingRuntimeErrors === 'function') {
      // Don't disable entirely — wrap and filter just RO loop
      const origStop = hook.stopReportingRuntimeErrors.bind(hook);
      hook.stopReportingRuntimeErrors = (err: any) => {
        if (isROLoop(err?.message)) return true; // swallow this one
        return origStop(err);
      };
    }
  }
}

// Update theme with global style overrides
const themeWithGlobalStyles = {
  ...theme,
  components: {
    ...theme.components,
    MuiCssBaseline: {
      styleOverrides: getGlobalStyleOverrides(theme),
    },
  },
};

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

// Use StrictMode only in production to avoid double-observation during development
const AppTree =
  process.env.NODE_ENV === 'production' ? (
    <React.StrictMode>
      <ThemeProvider theme={themeWithGlobalStyles}>
        <CssBaseline />
        <App />
      </ThemeProvider>
    </React.StrictMode>
  ) : (
    <ThemeProvider theme={themeWithGlobalStyles}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  );

root.render(AppTree);
