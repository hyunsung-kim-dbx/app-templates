import { useEffect, useRef, useState, useMemo } from 'react';
import embed, { type VisualizationSpec } from 'vega-embed';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface VegaChartProps {
  spec: VisualizationSpec;
  className?: string;
}

const ROWS_PER_PAGE = 15; // Default page size for performance

/**
 * Extracts inline data from a Vega-Lite spec
 */
function getInlineData(spec: VisualizationSpec): any[] | null {
  if (!spec || typeof spec !== 'object') return null;

  const specObj = spec as any;

  // Check if spec has inline data
  if (
    specObj.data &&
    typeof specObj.data === 'object' &&
    Array.isArray(specObj.data.values)
  ) {
    return specObj.data.values;
  }

  return null;
}

/**
 * Creates a new spec with paginated data
 */
function paginateSpec(
  spec: VisualizationSpec,
  data: any[],
  page: number,
  pageSize: number,
): VisualizationSpec {
  const start = page * pageSize;
  const end = start + pageSize;
  const paginatedData = data.slice(start, end);

  return {
    ...spec,
    data: {
      ...(spec as any).data,
      values: paginatedData,
    },
  } as VisualizationSpec;
}

export function VegaChart({ spec, className }: VegaChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(0);

  // Extract inline data to check if pagination is needed
  const inlineData = useMemo(() => getInlineData(spec), [spec]);
  const totalRows = inlineData?.length || 0;
  const needsPagination = totalRows > ROWS_PER_PAGE;
  const totalPages = Math.ceil(totalRows / ROWS_PER_PAGE);

  // Reset to first page when spec changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: We want to reset page when spec object changes
  useEffect(() => {
    setCurrentPage(0);
  }, [spec]);

  // Create paginated spec
  const displaySpec = useMemo(() => {
    if (!needsPagination || !inlineData) return spec;
    return paginateSpec(spec, inlineData, currentPage, ROWS_PER_PAGE);
  }, [spec, inlineData, needsPagination, currentPage]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !displaySpec) return;

    const renderChart = async () => {
      try {
        setError(null);
        await embed(container, displaySpec, {
          actions: {
            export: true,
            source: false,
            compiled: false,
            editor: false,
          },
          renderer: 'svg',
        });
      } catch (err) {
        console.error('Vega render error:', err);
        setError(
          err instanceof Error ? err.message : 'Failed to render chart',
        );
      }
    };

    renderChart();

    // Cleanup
    return () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [displaySpec]);

  if (error) {
    return (
      <div className="rounded border border-red-300 bg-red-50 p-4 text-red-700">
        <p className="font-semibold text-sm">Chart Rendering Error</p>
        <p className="text-xs">{error}</p>
      </div>
    );
  }

  const startRow = currentPage * ROWS_PER_PAGE + 1;
  const endRow = Math.min((currentPage + 1) * ROWS_PER_PAGE, totalRows);

  return (
    <div className="flex flex-col gap-2">
      {needsPagination && (
        <div className="flex items-center justify-between rounded-t-lg border border-b-0 bg-muted/50 px-4 py-2 text-sm">
          <span className="text-muted-foreground">
            Showing rows {startRow}-{endRow} of {totalRows.toLocaleString()}
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
              onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={currentPage >= totalPages - 1}
            >
              Next
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
      <div
        ref={containerRef}
        className={cn(
          'vega-chart-container my-4 overflow-auto rounded-lg border bg-white p-4',
          needsPagination && 'my-0 rounded-t-none border-t-0',
          className,
        )}
      />
    </div>
  );
}
