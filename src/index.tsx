import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

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

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

// Use StrictMode only in production to avoid double-observation during development
root.render(
  process.env.NODE_ENV === 'production' ? (
    <React.StrictMode>
      <App />
    </React.StrictMode>
  ) : (
    <App />
  )
);
