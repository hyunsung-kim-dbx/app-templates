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

  console.log('[VegaChart] Rendering with spec schema:', spec.$schema);

  // Stable ID for this chart instance
  const chartId = useMemo(() => {
    return `vega-chart-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }, []); // Only generate once per component instance

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !spec) {
      console.warn('[VegaChart] No container or spec available');
      setIsLoading(false);
      return;
    }

    console.log('[VegaChart] Starting render, container exists:', !!container);

    let isMounted = true;
    let vegaView: any = null;

    const renderChart = async () => {
      try {
        setError(null);
        setIsLoading(true);

        // Small delay to ensure DOM is ready
        await new Promise(resolve => setTimeout(resolve, 10));

        if (!isMounted) {
          console.log('[VegaChart] Unmounted before render');
          return null;
        }

        // Double-check container still exists
        const currentContainer = containerRef.current;
        if (!currentContainer) {
          console.error('[VegaChart] Container disappeared before render');
          setError('Container not ready');
          setIsLoading(false);
          return null;
        }

        console.log('[VegaChart] Calling vega-embed...');

        // Vega-embed handles DOM updates automatically
        const result = await embed(currentContainer, spec, {
          actions: {
            export: true,
            source: false,
            compiled: false,
            editor: false,
          },
          renderer: 'svg',
          logLevel: 2, // Suppress version warnings
        });

        console.log('[VegaChart] ✅ Render successful');

        if (isMounted) {
          setIsLoading(false);
        }

        // Return cleanup function from vega-embed
        return result;
      } catch (err) {
        console.error('[VegaChart] ❌ Render error:', err);
        if (isMounted) {
          setError(
            err instanceof Error ? err.message : 'Failed to render chart',
          );
          setIsLoading(false);
        }
        return null;
      }
    };

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
          console.warn('[VegaChart] Cleanup error (ignored):', e);
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
      id={chartId}
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
