import { useEffect, useRef, useState } from 'react';
import embed, { type VisualizationSpec } from 'vega-embed';
import { cn } from '@/lib/utils';

interface VegaChartProps {
  spec: VisualizationSpec;
  className?: string;
}

export function VegaChart({ spec, className }: VegaChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const renderInProgressRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !spec) {
      setIsLoading(false);
      return;
    }

    // Prevent multiple concurrent renders
    if (renderInProgressRef.current) {
      return;
    }

    const renderChart = async () => {
      renderInProgressRef.current = true;
      try {
        setError(null);
        setIsLoading(true);

        // Clear previous chart
        container.innerHTML = '';

        await embed(container, spec, {
          actions: {
            export: true,
            source: false,
            compiled: false,
            editor: false,
          },
          renderer: 'svg',
          // Suppress version mismatch warnings (v5 specs work fine with v6)
          logLevel: 2, // ERROR level only (suppresses WARN)
        });

        setIsLoading(false);
      } catch (err) {
        console.error('Vega render error:', err);
        console.error('Failed spec:', spec);
        setError(
          err instanceof Error ? err.message : 'Failed to render chart',
        );
        setIsLoading(false);
      } finally {
        renderInProgressRef.current = false;
      }
    };

    renderChart();

    // Cleanup - let Vega handle its own cleanup
    return () => {
      // Don't manually clear innerHTML - let vega-embed handle cleanup
      // This prevents React DOM errors when trying to remove already-removed nodes
    };
  }, [spec]);

  if (error) {
    return (
      <div className="rounded border border-red-300 bg-red-50 p-4 text-red-700">
        <p className="font-semibold text-sm">Chart Rendering Error</p>
        <p className="text-xs">{error}</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div
        className={cn(
          'vega-chart-container my-4 flex min-h-[300px] items-center justify-center overflow-auto rounded-lg border bg-white p-4',
          className,
        )}
      >
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <div className="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm">Loading visualization...</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        'vega-chart-container my-4 min-h-[300px] overflow-auto rounded-lg border bg-white p-4',
        className,
      )}
    />
  );
}
