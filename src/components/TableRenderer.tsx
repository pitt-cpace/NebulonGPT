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
import * as styles from '../styles/components/TableRenderer.styles';

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
      sx={styles.tableContainer}
    >
      <Table>
        <TableHead sx={styles.tableHead}>
          <TableRow>
            {headers.map((header, idx) => (
              <TableCell 
                key={idx}
                sx={styles.tableHeaderCell}
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
              sx={styles.tableRow}
            >
              {row.map((cell, cellIdx) => (
                <TableCell 
                  key={cellIdx}
                  sx={styles.tableCell}
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

/**
 * Helper function to detect and parse MediaWiki format tables
 */
export const parseMediaWikiTable = (content: string): TableData | null => {
  // Check if content contains MediaWiki table syntax
  if (!content.includes('{|') || !content.includes('|}')) {
    return null; // Not a MediaWiki table
  }
  
  // Split the content into lines
  const lines = content.trim().split('\n');
  
  // Find the start and end of the table
  let startIndex = -1;
  let endIndex = -1;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('{|')) {
      startIndex = i;
    } else if (line.startsWith('|}')) {
      endIndex = i;
      break;
    }
  }
  
  if (startIndex === -1 || endIndex === -1 || startIndex >= endIndex) {
    return null; // Invalid table structure
  }
  
  // Extract table lines (excluding the opening and closing braces)
  const tableLines = lines.slice(startIndex, endIndex + 1);
  
  // Parse the header from the first line
  const firstLine = tableLines[0].trim();
  let headers: string[] = [];
  
  // Extract headers from the opening line: {| Header1 | Header2 | Header3 |}
  const headerMatch = firstLine.match(/\{\|\s*(.+?)\s*\|/);
  if (headerMatch) {
    headers = headerMatch[1]
      .split('|')
      .map(header => header.trim())
      .filter(header => header !== '');
  }
  
  // If no headers found in the first line, look for them in subsequent lines
  if (headers.length === 0) {
    for (let i = 1; i < tableLines.length - 1; i++) {
      const line = tableLines[i].trim();
      if (line.startsWith('|') && !line.includes('---')) {
        headers = line
          .split('|')
          .filter(cell => cell.trim() !== '')
          .map(cell => cell.trim());
        break;
      }
    }
  }
  
  // Extract data rows
  const rows: string[][] = [];
  let currentRow: string[] = [];
  
  for (let i = 1; i < tableLines.length - 1; i++) {
    const line = tableLines[i].trim();
    
    // Skip separator lines (lines with dashes)
    if (line.includes('---')) {
      continue;
    }
    
    // Skip empty lines
    if (!line) {
      continue;
    }
    
    // Process lines that start with |
    if (line.startsWith('|')) {
      // If we have a current row being built, save it
      if (currentRow.length > 0) {
        rows.push([...currentRow]);
        currentRow = [];
      }
      
      // Parse the current line
      const cells = line
        .split('|')
        .filter(cell => cell.trim() !== '')
        .map(cell => cell.trim());
      
      if (cells.length > 0) {
        currentRow = cells;
      }
    }
  }
  
  // Add the last row if it exists
  if (currentRow.length > 0) {
    rows.push(currentRow);
  }
  
  // Validate that we have headers and rows
  if (headers.length === 0 || rows.length === 0) {
    return null;
  }
  
  // Ensure all rows have the same number of columns as headers
  const validRows = rows.filter(row => row.length === headers.length);
  
  if (validRows.length === 0) {
    return null;
  }
  
  return { headers, rows: validRows };
};

export default TableRenderer;
