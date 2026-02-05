import { useState } from 'react';
import { Button } from './ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface TabularData {
  columns: string[];
  rows: any[][];
}

/**
 * Checks if output matches {"columns": [...], "rows": [...]} format
 */
export function isTabularData(output: unknown): output is TabularData {
  if (typeof output !== 'object' || output === null) return false;
  const data = output as Record<string, unknown>;
  return (
    Array.isArray(data.columns) &&
    Array.isArray(data.rows) &&
    data.columns.every((col) => typeof col === 'string')
  );
}

interface CollapsibleTableProps {
  data: TabularData;
  rowsPerPage?: number;
}

/**
 * Renders tabular data with pagination
 */
export function CollapsibleTable({
  data,
  rowsPerPage = 15,
}: CollapsibleTableProps) {
  const [currentPage, setCurrentPage] = useState(0);
  const { columns, rows } = data;
  const totalRows = rows.length;
  const totalPages = Math.ceil(totalRows / rowsPerPage);
  const needsPagination = totalRows > rowsPerPage;

  const startRow = currentPage * rowsPerPage;
  const endRow = Math.min(startRow + rowsPerPage, totalRows);
  const displayRows = rows.slice(startRow, endRow);

  return (
    <div className="space-y-2">
      {needsPagination && (
        <div className="flex items-center justify-between border-b pb-2">
          <span className="text-muted-foreground text-xs">
            Showing rows {startRow + 1}-{endRow} of {totalRows.toLocaleString()}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
              disabled={currentPage === 0}
            >
              <ChevronLeft className="size-4" />
              Previous
            </Button>
            <span className="text-muted-foreground text-xs">
              Page {currentPage + 1} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setCurrentPage((p) => Math.min(totalPages - 1, p + 1))
              }
              disabled={currentPage >= totalPages - 1}
            >
              Next
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              {columns.map((col, i) => (
                <th
                  // biome-ignore lint/suspicious/noArrayIndexKey: columns are stable and order-dependent
                  key={i}
                  className="px-3 py-2 font-medium text-muted-foreground"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row, rowIndex) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are stable within current page
              <tr key={rowIndex} className="border-b last:border-b-0">
                {row.map((cell, cellIndex) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: cells are stable within row
                  <td key={cellIndex} className="px-3 py-2">
                    {cell === null || cell === undefined ? '-' : String(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface CollapsibleJsonProps {
  json: string;
  linesPerPage?: number;
}

/**
 * Renders large JSON payloads with pagination
 */
export function CollapsibleJson({
  json,
  linesPerPage = 10,
}: CollapsibleJsonProps) {
  const [currentPage, setCurrentPage] = useState(0);
  const lines = json.split('\n');
  const totalLines = lines.length;
  const totalPages = Math.ceil(totalLines / linesPerPage);
  const needsPagination = totalLines > linesPerPage;

  const startLine = currentPage * linesPerPage;
  const endLine = Math.min(startLine + linesPerPage, totalLines);
  const displayLines = lines.slice(startLine, endLine);

  return (
    <div className="space-y-2">
      {needsPagination && (
        <div className="flex items-center justify-between border-b pb-2">
          <span className="text-muted-foreground text-xs">
            Showing lines {startLine + 1}-{endLine} of{' '}
            {totalLines.toLocaleString()}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
              disabled={currentPage === 0}
            >
              <ChevronLeft className="size-4" />
              Previous
            </Button>
            <span className="text-muted-foreground text-xs">
              Page {currentPage + 1} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setCurrentPage((p) => Math.min(totalPages - 1, p + 1))
              }
              disabled={currentPage >= totalPages - 1}
            >
              Next
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        <pre className="whitespace-pre-wrap font-mono text-xs">
          {displayLines.join('\n')}
        </pre>
      </div>
    </div>
  );
}
