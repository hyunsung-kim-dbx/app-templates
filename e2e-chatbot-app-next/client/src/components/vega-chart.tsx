import { useEffect, useRef, useState, useMemo } from 'react';
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

  // Generate a stable key from spec to force remount on spec change
  const specKey = useMemo(() => {
    return JSON.stringify(spec).substring(0, 100);
  }, [spec]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !spec) {
      setIsLoading(false);
      return;
    }

    let isMounted = true;

    const renderChart = async () => {
      try {
        setError(null);
        setIsLoading(true);

        // Vega-embed handles DOM updates automatically
        const result = await embed(container, spec, {
          actions: {
            export: true,
            source: false,
            compiled: false,
            editor: false,
          },
          renderer: 'svg',
          logLevel: 2, // Suppress version warnings
        });

        if (isMounted) {
          setIsLoading(false);
        }

        // Return cleanup function from vega-embed
        return result;
      } catch (err) {
        console.error('Vega render error:', err);
        if (isMounted) {
          setError(
            err instanceof Error ? err.message : 'Failed to render chart',
          );
          setIsLoading(false);
        }
        return null;
      }
    };

    let vegaView: any = null;
    renderChart().then((result) => {
      vegaView = result;
    });

    // Cleanup: use vega's own cleanup
    return () => {
      isMounted = false;
      if (vegaView && vegaView.finalize) {
        try {
          vegaView.finalize();
        } catch (e) {
          // Ignore cleanup errors
        }
      }
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
      key={specKey}
      ref={containerRef}
      className={cn(
        'vega-chart-container my-4 min-h-[300px] overflow-auto rounded-lg border bg-white p-4',
        className,
      )}
      // Prevent React from managing this subtree
      suppressHydrationWarning
    />
  );
}
