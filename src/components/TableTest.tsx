import React from 'react';
import TableRenderer from './TableRenderer';
import { Box, Typography, Button } from '@mui/material';

/**
 * Test component for verifying table rendering functionality
 */
const TableTest: React.FC = () => {
  // Sample table data
  const tableData = {
    headers: ['Rank', 'Language', 'Popularity (%)', 'Main Use Case'],
    rows: [
      ['1', 'Python', '29.48', 'Data Science, AI, Web Development'],
      ['2', 'JavaScript', '24.12', 'Web Development, Frontend'],
      ['3', 'Java', '17.26', 'Enterprise Applications, Android'],
      ['4', 'C#', '16.44', 'Windows Applications, Game Development'],
      ['5', 'C/C++', '12.70', 'System Programming, Performance-critical Applications'],
    ],
  };

  return (
    <Box sx={{ p: 4, maxWidth: '800px', margin: '0 auto' }}>
      <Typography variant="h4" gutterBottom sx={{ color: '#90caf9' }}>
        Table Rendering Test
      </Typography>
      
      <Typography variant="body1" paragraph>
        This is a test to verify that the TableRenderer component is working correctly.
      </Typography>
      
      <Typography variant="h5" gutterBottom sx={{ mt: 3 }}>
        Top 5 Programming Languages
      </Typography>
      
      {/* Use the TableRenderer component with our sample data */}
      <TableRenderer tableData={tableData} />
      
      <Box sx={{ mt: 4 }}>
        <Typography variant="body2" color="text.secondary">
          If you can see a properly formatted table above, the table rendering functionality is working correctly.
        </Typography>
      </Box>
    </Box>
  );
};

export default TableTest;
