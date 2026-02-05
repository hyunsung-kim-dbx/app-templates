import { useEffect, useState, useMemo, useCallback } from 'react';
import embed, { type VisualizationSpec } from 'vega-embed';
import { cn } from '@/lib/utils';

interface VegaChartProps {
  spec: VisualizationSpec;
  className?: string;
}

export function VegaChart({ spec, className }: VegaChartProps) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  console.log('[VegaChart] Rendering with spec schema:', spec.$schema);

  // Stable ID for this chart instance
  const chartId = useMemo(() => {
    return `vega-chart-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }, []); // Only generate once per component instance

  // Use callback ref to reliably get the container element
  const setContainerRef = useCallback((node: HTMLDivElement | null) => {
    console.log('[VegaChart] Callback ref called, node:', !!node);
    setContainer(node);
  }, []);

  useEffect(() => {
    if (!container || !spec) {
      console.warn('[VegaChart] Waiting for container or spec...', { container: !!container, spec: !!spec });
      return;
    }

    console.log('[VegaChart] Starting render with valid container and spec');

    let isMounted = true;
    let vegaView: any = null;

    const renderChart = async () => {
      try {
        setError(null);
        setIsLoading(true);

        // Use requestAnimationFrame to ensure DOM is painted
        await new Promise<void>(resolve => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => resolve());
          });
        });

        if (!isMounted) {
          console.log('[VegaChart] Unmounted before render');
          return null;
        }

        // Verify container is still in the document
        if (!document.body.contains(container)) {
          console.error('[VegaChart] Container not in document');
          setError('Container not in DOM');
          setIsLoading(false);
          return null;
        }

        console.log('[VegaChart] Calling vega-embed...');

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

        console.log('[VegaChart] ✅ Render successful');

        if (isMounted) {
          setIsLoading(false);
        }

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
  }, [container, spec]);

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
      ref={setContainerRef}
      className={cn(
        'vega-chart-container my-4 min-h-[300px] overflow-auto rounded-lg border bg-white p-4',
        className,
      )}
      // Prevent React from managing this subtree
      suppressHydrationWarning
    />
  );
}
