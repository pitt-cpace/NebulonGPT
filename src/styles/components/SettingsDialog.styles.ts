import { SxProps, Theme } from '@mui/material/styles';

// Styles for the SettingsDialog component
export const settingsButton: SxProps<Theme> = {
  position: 'absolute',
  top: 10,
  right: 10,
  zIndex: 1100,
};

export const dialogTitle: SxProps<Theme> = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

export const sectionContainer: SxProps<Theme> = {
  mb: 3,
};

// Additional style objects for specific elements if needed
export const sliderContainer = sectionContainer; // Reusing the same style
