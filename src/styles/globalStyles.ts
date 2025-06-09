import { Theme } from '@mui/material/styles';

// Global styles as a JS object that can be used with MUI's sx prop or styled API
export const globalStyles = {
  // CSS variables
  cssVars: {
    '--primary-color': '#90caf9',
    '--secondary-color': '#f48fb1',
    '--background-color': '#121212',
    '--paper-color': '#1e1e1e',
    '--text-color': '#ffffff',
    '--text-secondary-color': '#b0b0b0',
    '--border-color': '#333',
    '--code-background': '#2d2d2d',
    '--hover-color': 'rgba(144, 202, 249, 0.08)',
    '--active-color': 'rgba(144, 202, 249, 0.12)',
    '--scrollbar-track': '#1e1e1e',
    '--scrollbar-thumb': '#6b6b6b',
    '--scrollbar-thumb-hover': '#959595',
    '--user-message-bg': 'rgba(144, 202, 249, 0.08)',
    '--assistant-message-bg': 'rgba(255, 255, 255, 0.05)',
    '--table-header-bg': 'rgba(255, 255, 255, 0.08)',
    '--table-border': 'rgba(255, 255, 255, 0.1)',
  },

  // Body styles
  body: {
    margin: 0,
    fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif',
    WebkitFontSmoothing: 'antialiased',
    MozOsxFontSmoothing: 'grayscale',
    overflowX: 'hidden',
    backgroundColor: 'var(--background-color)',
    color: 'var(--text-color)',
  },

  // Code styles
  code: {
    fontFamily: '"JetBrains Mono", source-code-pro, Menlo, Monaco, Consolas, "Courier New", monospace',
  },

  // Markdown content styles
  markdownContent: {
    lineHeight: 1.6,
    animation: 'fadeIn 0.3s ease-in-out',
    '& pre': {
      backgroundColor: 'var(--code-background)',
      padding: '16px',
      borderRadius: '8px',
      overflowX: 'auto',
      margin: '16px 0',
      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
    },
    '& code': {
      backgroundColor: 'var(--code-background)',
      padding: '2px 4px',
      borderRadius: '4px',
      fontSize: '0.9em',
    },
    '& p': {
      marginBottom: '16px',
    },
    '& h1, & h2, & h3, & h4, & h5, & h6': {
      marginTop: '24px',
      marginBottom: '16px',
      fontWeight: 600,
      color: 'var(--primary-color)',
    },
    '& h1': {
      fontSize: '1.8em',
      borderBottom: '1px solid var(--border-color)',
      paddingBottom: '8px',
    },
    '& h2': {
      fontSize: '1.5em',
    },
    '& h3': {
      fontSize: '1.3em',
    },
    '& ul, & ol': {
      paddingLeft: '24px',
      marginBottom: '16px',
    },
    '& li': {
      marginBottom: '8px',
    },
    '& blockquote': {
      borderLeft: '4px solid var(--primary-color)',
      padding: '8px 16px',
      marginLeft: 0,
      marginRight: 0,
      backgroundColor: 'rgba(144, 202, 249, 0.05)',
      borderRadius: '0 4px 4px 0',
      color: 'var(--text-secondary-color)',
    },
    '& img': {
      maxWidth: '100%',
      borderRadius: '8px',
      margin: '16px 0',
    },
  },

  // Table styles
  table: {
    borderCollapse: 'collapse',
    width: '100%',
    margin: '24px 0',
    borderRadius: '8px',
    overflow: 'hidden',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
  },
  tableHead: {
    backgroundColor: 'rgba(144, 202, 249, 0.1)',
  },
  tableHeaderCell: {
    fontWeight: 'bold',
    borderBottom: '2px solid rgba(144, 202, 249, 0.3)',
    color: '#90caf9',
    padding: '12px 16px',
    textAlign: 'left',
  },
  tableCell: {
    borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
    padding: '12px 16px',
    textAlign: 'left',
  },
  tableRowOdd: {
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
  },
  tableRowEven: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
  },
  tableRowHover: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },

  // Enhanced table styles
  enhancedTable: {
    borderCollapse: 'separate',
    borderSpacing: 0,
    width: '100%',
    margin: '24px 0',
    overflow: 'hidden',
    borderRadius: '8px',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
  },

  // Streaming cursor
  streamingCursor: {
    '&::after': {
      content: '"▋"',
      display: 'inline-block',
      animation: 'blink 1s infinite',
      color: 'var(--primary-color)',
      marginLeft: '2px',
    },
  },

  // Animation keyframes
  '@keyframes fadeIn': {
    from: { opacity: 0 },
    to: { opacity: 1 },
  },
  '@keyframes slideIn': {
    from: { transform: 'translateY(10px)', opacity: 0 },
    to: { transform: 'translateY(0)', opacity: 1 },
  },
  '@keyframes blink': {
    '0%, 100%': { opacity: 1 },
    '50%': { opacity: 0 },
  },
};

// Function to create global styles for the CssBaseline component
export const getGlobalStyleOverrides = (theme: Theme) => ({
  html: {
    ...globalStyles.cssVars,
  },
  body: {
    ...globalStyles.body,
  },
  code: {
    ...globalStyles.code,
  },
  '::-webkit-scrollbar': {
    width: '8px',
  },
  '::-webkit-scrollbar-track': {
    background: 'var(--scrollbar-track)',
  },
  '::-webkit-scrollbar-thumb': {
    background: 'var(--scrollbar-thumb)',
    borderRadius: '4px',
  },
  '::-webkit-scrollbar-thumb:hover': {
    background: 'var(--scrollbar-thumb-hover)',
  },
  '.markdown-content': {
    ...globalStyles.markdownContent,
  },
  '.streaming-cursor': {
    ...globalStyles.streamingCursor,
  },
  '@keyframes fadeIn': globalStyles['@keyframes fadeIn'],
  '@keyframes slideIn': globalStyles['@keyframes slideIn'],
  '@keyframes blink': globalStyles['@keyframes blink'],
});

export default getGlobalStyleOverrides;
