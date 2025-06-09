import { SxProps, Theme } from '@mui/material/styles';

// Styles for the TableRenderer component
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

export const tableRow: SxProps<Theme> = {
  '&:nth-of-type(odd)': { backgroundColor: 'rgba(0, 0, 0, 0.1)' },
  '&:nth-of-type(even)': { backgroundColor: 'rgba(255, 255, 255, 0.02)' },
  '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.05)' },
};

export const tableCell: SxProps<Theme> = {
  borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
  py: 1.5,
  px: 2,
};
