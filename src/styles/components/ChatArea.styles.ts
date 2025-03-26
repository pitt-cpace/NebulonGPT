import { SxProps, Theme } from '@mui/material/styles';
// Import the drawerWidth from Sidebar styles
import { drawerWidth } from './Sidebar.styles';

// Styles for the ChatArea component
export const container = (sidebarOpen: boolean): SxProps<Theme> => ({
  position: 'absolute',
  right: 0,
  left: sidebarOpen ? drawerWidth : 0,
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
  overflow: 'hidden',
  transition: 'left 225ms cubic-bezier(0.0, 0, 0.2, 1) 0ms',
});

export const appBar: SxProps<Theme> = {
  borderBottom: '1px solid #333',
};

export const modelSelector: SxProps<Theme> = {
  textTransform: 'none',
  color: 'white',
  fontWeight: 'normal',
};

export const messagesContainer: SxProps<Theme> = {
  flexGrow: 1,
  p: 3,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
};

export const messageBox: SxProps<Theme> = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  mb: 2,
  maxWidth: '100%',
};

export const userMessage: SxProps<Theme> = {
  display: 'flex',
  p: 2,
  borderRadius: 2,
  backgroundColor: 'rgba(144, 202, 249, 0.08)',
  maxWidth: '100%',
  width: '100%',
};

export const assistantMessage: SxProps<Theme> = {
  display: 'flex',
  p: 2,
  borderRadius: 2,
  backgroundColor: 'rgba(255, 255, 255, 0.05)',
  maxWidth: '100%',
  width: '100%',
};

export const messageContent: SxProps<Theme> = {
  wordBreak: 'break-word',
};

export const inputContainer: SxProps<Theme> = {
  p: 2,
  borderTop: '1px solid #333',
  backgroundColor: 'background.paper',
};

export const inputBox: SxProps<Theme> = {
  display: 'flex',
  alignItems: 'center',
};

export const fileUploadButton: SxProps<Theme> = {
  mr: 1,
  color: 'text.secondary',
  '&:hover': {
    color: 'primary.main',
  },
};

export const fileInput: SxProps<Theme> = {
  display: 'none',
};

export const attachmentPreview: SxProps<Theme> = {
  display: 'flex',
  alignItems: 'center',
  p: 1,
  my: 1,
  borderRadius: 1,
  backgroundColor: 'rgba(255, 255, 255, 0.05)',
  border: '1px solid rgba(255, 255, 255, 0.1)',
};

export const attachmentIcon: SxProps<Theme> = {
  mr: 1,
  color: 'primary.main',
};

export const attachmentName: SxProps<Theme> = {
  flexGrow: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

export const attachmentSize: SxProps<Theme> = {
  ml: 1,
  color: 'text.secondary',
  fontSize: '0.75rem',
};

export const attachmentRemove: SxProps<Theme> = {
  ml: 1,
  p: 0.5,
};

export const micButton: SxProps<Theme> = {
  mr: 1,
};

export const micButtonActive: SxProps<Theme> = {
  ...micButton,
  color: 'error.main',
  animation: 'pulse 1.5s infinite',
  '@keyframes pulse': {
    '0%': { opacity: 1 },
    '50%': { opacity: 0.5 },
    '100%': { opacity: 1 },
  },
};

export const micButtonError: SxProps<Theme> = {
  ...micButton,
  color: 'warning.main',
};

export const micErrorText: SxProps<Theme> = {
  position: 'absolute',
  bottom: -20,
  left: 0,
  whiteSpace: 'nowrap',
  fontSize: '0.7rem',
};

export const textField: SxProps<Theme> = {
  borderRadius: 4,
  backgroundColor: 'rgba(255, 255, 255, 0.05)',
  '&:hover': {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
};

export const interimTranscript: SxProps<Theme> = {
  position: 'absolute',
  bottom: '100%',
  left: 0,
  right: 0,
  backgroundColor: 'rgba(0, 0, 0, 0.7)',
  color: 'rgba(255, 255, 255, 0.7)',
  padding: '8px 12px',
  borderRadius: '4px',
  fontSize: '0.85rem',
  maxWidth: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  zIndex: 10,
};

// Welcome screen styles
export const welcomeContainer: SxProps<Theme> = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  flexGrow: 1,
  p: 3,
};

export const welcomeHeader: SxProps<Theme> = {
  textAlign: 'center',
  mb: 4,
};

export const suggestedPromptsHeader: SxProps<Theme> = {
  alignSelf: 'flex-start',
  mb: 2,
  display: 'flex',
  alignItems: 'center',
  gap: 1,
};

export const sparkleIcon: SxProps<Theme> = {
  opacity: 0.6,
};

export const promptCard: SxProps<Theme> = {
  backgroundColor: 'rgba(255, 255, 255, 0.05)',
  borderColor: 'rgba(255, 255, 255, 0.1)',
};

// Table styles
export const tableContainer: SxProps<Theme> = {
  my: 3,
  backgroundColor: 'rgba(255, 255, 255, 0.05)',
  borderRadius: 2,
  overflow: 'hidden',
  boxShadow: '0 4px 8px rgba(0, 0, 0, 0.15)',
  width: '100%',
};

export const tableHead: SxProps<Theme> = {
  backgroundColor: 'rgba(144, 202, 249, 0.1)',
};

export const tableHeaderCell: SxProps<Theme> = {
  fontWeight: 'bold',
  borderBottom: '2px solid rgba(144, 202, 249, 0.3)',
  color: '#90caf9',
  py: 2,
  px: 2,
};

export const tableCell: SxProps<Theme> = {
  borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
  py: 1.5,
  px: 2,
};

export const tableRowOdd: SxProps<Theme> = {
  backgroundColor: 'rgba(0, 0, 0, 0.1)',
};

export const tableRowEven: SxProps<Theme> = {
  backgroundColor: 'rgba(255, 255, 255, 0.02)',
};

export const tableRowHover: SxProps<Theme> = {
  backgroundColor: 'rgba(255, 255, 255, 0.05)',
};

// Code block styles
export const codeBlock: SxProps<Theme> = {
  backgroundColor: 'rgba(0, 0, 0, 0.3)',
  borderRadius: 2,
  p: 2,
  overflowX: 'auto',
  my: 2,
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
  border: '1px solid rgba(255, 255, 255, 0.1)',
};

export const inlineCode: SxProps<Theme> = {
  backgroundColor: 'rgba(0, 0, 0, 0.2)',
  borderRadius: 1,
  px: 0.5,
  py: 0.25,
  fontFamily: 'monospace',
};
