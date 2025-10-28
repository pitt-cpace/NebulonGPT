import { createTheme, Theme } from '@mui/material/styles';

// Get theme mode from localStorage, default to 'dark'
export const getThemeMode = (): 'light' | 'dark' => {
  const savedMode = localStorage.getItem('themeMode');
  return (savedMode === 'light' || savedMode === 'dark') ? savedMode : 'dark';
};

// Function to create theme based on mode
export const createAppTheme = (mode: 'light' | 'dark'): Theme => {
  const theme = createTheme({
    palette: {
      mode,
      ...(mode === 'dark' ? {
        background: {
          default: '#121212',
          paper: '#1e1e1e',
        },
        primary: {
          main: '#90caf9',
        },
        secondary: {
          main: '#f48fb1',
        },
      } : {
        background: {
          default: '#fafafa',
          paper: '#ffffff',
        },
        primary: {
          main: '#1976d2',
        },
        secondary: {
          main: '#dc004e',
        },
      }),
    },
    typography: {
      fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: mode === 'dark' ? {
            scrollbarColor: "#6b6b6b #2b2b2b",
            "&::-webkit-scrollbar, & *::-webkit-scrollbar": {
              backgroundColor: "#2b2b2b",
              width: "8px",
            },
            "&::-webkit-scrollbar-thumb, & *::-webkit-scrollbar-thumb": {
              borderRadius: 8,
              backgroundColor: "#6b6b6b",
              minHeight: 24,
            },
            "&::-webkit-scrollbar-thumb:focus, & *::-webkit-scrollbar-thumb:focus": {
              backgroundColor: "#959595",
            },
            "&::-webkit-scrollbar-thumb:active, & *::-webkit-scrollbar-thumb:active": {
              backgroundColor: "#959595",
            },
            "&::-webkit-scrollbar-thumb:hover, & *::-webkit-scrollbar-thumb:hover": {
              backgroundColor: "#959595",
            },
          } : {
            scrollbarColor: "#bdbdbd #f5f5f5",
            "&::-webkit-scrollbar, & *::-webkit-scrollbar": {
              backgroundColor: "#f5f5f5",
              width: "8px",
            },
            "&::-webkit-scrollbar-thumb, & *::-webkit-scrollbar-thumb": {
              borderRadius: 8,
              backgroundColor: "#bdbdbd",
              minHeight: 24,
            },
            "&::-webkit-scrollbar-thumb:focus, & *::-webkit-scrollbar-thumb:focus": {
              backgroundColor: "#9e9e9e",
            },
            "&::-webkit-scrollbar-thumb:active, & *::-webkit-scrollbar-thumb:active": {
              backgroundColor: "#9e9e9e",
            },
            "&::-webkit-scrollbar-thumb:hover, & *::-webkit-scrollbar-thumb:hover": {
              backgroundColor: "#9e9e9e",
            },
          },
        },
      },
    },
  });
  
  return theme;
};

// Default theme export (for initial render)
const theme = createAppTheme(getThemeMode());

export default theme;
