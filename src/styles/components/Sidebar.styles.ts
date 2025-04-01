import { SxProps, Theme } from '@mui/material/styles';

// Constants
export const drawerWidth = 280;

// Styles for the Sidebar component
export const drawer: SxProps<Theme> = {
  width: drawerWidth,
  flexShrink: 0,
  '& .MuiDrawer-paper': {
    width: drawerWidth,
    boxSizing: 'border-box',
    backgroundColor: '#121212',
    borderRight: '1px solid #333',
  },
};

export const contentContainer: SxProps<Theme> = {
  p: 2,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};

export const logoContainer: SxProps<Theme> = {
  display: 'flex',
  alignItems: 'center',
  gap: 1,
  mb: 1,
};

export const logoAvatar: SxProps<Theme> = {
  bgcolor: 'rgba(144, 202, 249, 0.2)',
  color: '#90caf9',
  width: 40,
  height: 40,
};

export const appTitle: SxProps<Theme> = {
  lineHeight: 1.2,
};

export const appSubtitle: SxProps<Theme> = {
  display: 'block',
  mt: 0.5,
};

export const byLogoContainer: SxProps<Theme> = {
  display: 'flex',
  alignItems: 'center',
  gap: 1,
  mt: 0.5,
};

export const byText: SxProps<Theme> = {
  fontWeight: 'bold',
  fontSize: '0.7rem',
};

export const cpaceLogo: SxProps<Theme> = {
  width: '100%',
  maxWidth: 135,
  height: 'auto',
};

export const newChatButtonContainer: SxProps<Theme> = {
  display: 'flex',
  alignItems: 'center',
  gap: 1,
};

export const newChatButton: SxProps<Theme> = {
  backgroundColor: 'rgba(144, 202, 249, 0.1)',
  color: '#90caf9',
  textTransform: 'none',
  justifyContent: 'flex-start',
  '&:hover': {
    backgroundColor: 'rgba(144, 202, 249, 0.2)',
  },
  borderRadius: 2,
  py: 1,
};

export const divider: SxProps<Theme> = {
  borderColor: '#333',
};

export const searchContainer: SxProps<Theme> = {
  px: 2,
  py: 1,
};

export const searchField: SxProps<Theme> = {
  '& .MuiOutlinedInput-root': {
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    '&:hover .MuiOutlinedInput-notchedOutline': {
      borderColor: 'rgba(255, 255, 255, 0.1)',
    },
    '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
      borderColor: 'primary.main',
    },
  },
};

export const chatListItem: SxProps<Theme> = {
  pl: 4,
  '&.Mui-selected': {
    backgroundColor: 'rgba(144, 202, 249, 0.08)',
  },
  '&.Mui-selected:hover': {
    backgroundColor: 'rgba(144, 202, 249, 0.12)',
  },
};

export const chatListItemIcon: SxProps<Theme> = {
  minWidth: 36,
};

export const editTextField: SxProps<Theme> = {
  flex: 1,
  mr: 1,
  '& .MuiOutlinedInput-root': {
    borderRadius: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
};

export const deleteButton: SxProps<Theme> = {
  opacity: 0,
  transition: 'opacity 0.2s',
  '&:hover': { opacity: 1 },
  '.MuiListItemButton-root:hover &': { opacity: 0.7 },
};

export const noChatFound: SxProps<Theme> = {
  pl: 4,
};
