import React from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
} from '@mui/material';

interface TableData {
  headers: string[];
  rows: string[][];
}

interface TableRendererProps {
  tableData: TableData;
}

/**
 * TableRenderer component for rendering formatted tables
 * This component extracts table rendering functionality from ChatArea.tsx
 * to improve code organization and maintainability
 */
const TableRenderer: React.FC<TableRendererProps> = ({ tableData }) => {
  const { headers, rows } = tableData;

  return (
    <TableContainer 
      component={Paper} 
      sx={{ 
        my: 3,
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
        borderRadius: 2,
        overflow: 'hidden',
        boxShadow: '0 4px 8px rgba(0, 0, 0, 0.15)',
        width: '100%',
      }}
    >
      <Table>
        <TableHead sx={{ backgroundColor: 'rgba(144, 202, 249, 0.1)' }}>
          <TableRow>
            {headers.map((header, idx) => (
              <TableCell 
                key={idx}
                sx={{ 
                  fontWeight: 'bold', 
                  borderBottom: '2px solid rgba(144, 202, 249, 0.3)',
                  color: '#90caf9',
                  py: 2,
                  px: 2,
                }}
              >
                {header}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, rowIdx) => (
            <TableRow 
              key={rowIdx}
              sx={{ 
                '&:nth-of-type(odd)': { backgroundColor: 'rgba(0, 0, 0, 0.1)' },
                '&:nth-of-type(even)': { backgroundColor: 'rgba(255, 255, 255, 0.02)' },
                '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.05)' },
              }}
            >
              {row.map((cell, cellIdx) => (
                <TableCell 
                  key={cellIdx}
                  sx={{ 
                    borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                    py: 1.5,
                    px: 2,
                  }}
                >
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

/**
 * Helper function to parse markdown table content into TableData
 */
export const parseMarkdownTable = (content: string): TableData | null => {
  // Split the content into lines
  const lines = content.trim().split('\n');
  
  // Need at least 3 lines for a valid table (header, separator, at least one row)
  if (lines.length < 3) {
    return null;
  }
  
  // Extract headers from the first line
  const headerLine = lines[0];
  const headers = headerLine
    .split('|')
    .filter(cell => cell.trim() !== '')
    .map(cell => cell.trim());
  
  // Verify the second line is a separator
  const separatorLine = lines[1];
  if (!separatorLine.includes('---')) {
    return null;
  }
  
  // Extract data rows (all lines except the first two)
  const dataRows = lines.slice(2);
  const rows = dataRows.map(row => 
    row
      .split('|')
      .filter(cell => cell.trim() !== '')
      .map(cell => cell.trim())
  );
  
  return { headers, rows };
};

/**
 * Helper function to parse tab-separated table content into TableData
 */
export const parseTabSeparatedTable = (content: string): TableData | null => {
  // Split the content into lines
  const lines = content.trim().split('\n');
  
  // Need at least 2 lines for a valid table (header and at least one row)
  if (lines.length < 2) {
    return null;
  }
  
  // Extract headers from the first line
  const headerLine = lines[0];
  const headers = headerLine.split('\t').map(cell => {
    // Remove markdown bold formatting if present (e.g., **text**)
    return cell.trim().replace(/^\*\*(.*)\*\*$/, '$1');
  });
  
  // Extract data rows (all lines except the first)
  const dataRows = lines.slice(1);
  const rows = dataRows.map(row => 
    row.split('\t').map(cell => {
      // Remove markdown bold formatting if present
      return cell.trim().replace(/^\*\*(.*)\*\*$/, '$1');
    })
  );
  
  return { headers, rows };
};

/**
 * Helper function to detect and parse Llama3-3 format tables
 */
export const parseLlama3Table = (content: string): TableData | null => {
  // This regex specifically targets the Llama3-3 table format with joined lines
  const llama3TableRegex = /\| ([^|]+) \| ([^|]+) \| ([^|]+) \| \| --- \| --- \| --- \| \| ([^|]+) \| ([^|]+) \| ([^|]+) \|/g;
  
  if (!llama3TableRegex.test(content)) {
    return null; // Not a Llama3-3 table
  }
  
  // Reset regex state
  llama3TableRegex.lastIndex = 0;
  
  // Extract table data
  const rows: string[][] = [];
  let headers: string[] = [];
  let match: RegExpExecArray | null;
  
  while ((match = llama3TableRegex.exec(content)) !== null) {
    if (headers.length === 0) {
      // First match contains headers
      headers = [match[1].trim(), match[2].trim(), match[3].trim()];
      // Add first row
      rows.push([match[4].trim(), match[5].trim(), match[6].trim()]);
    } else {
      // Subsequent matches are rows
      rows.push([match[1].trim(), match[2].trim(), match[3].trim()]);
    }
  }
  
  if (headers.length === 0 || rows.length === 0) {
    return null; // No valid table data extracted
  }
  
  return { headers, rows };
};

export default TableRenderer;
