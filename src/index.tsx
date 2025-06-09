import React from 'react';
import ReactDOM from 'react-dom/client';
// Styles are now fully migrated to globalStyles.ts
import App from './App';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import theme from './styles/theme';
import getGlobalStyleOverrides from './styles/globalStyles';

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

root.render(
  <React.StrictMode>
    <ThemeProvider theme={themeWithGlobalStyles}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
