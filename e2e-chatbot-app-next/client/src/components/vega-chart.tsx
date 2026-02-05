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

  console.log('[VegaChart] Component render - has spec:', !!spec, 'has container:', !!container);

  // Stable ID for this chart instance
  const chartId = useMemo(() => {
    const id = `vega-chart-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    console.log('[VegaChart] Generated chartId:', id);
    return id;
  }, []); // Only generate once per component instance

  // Use callback ref to reliably get the container element
  const setContainerRef = useCallback((node: HTMLDivElement | null) => {
    console.log('[VegaChart] ⚡ Callback ref called! Node:', !!node, 'Node type:', node?.nodeName);
    if (node) {
      console.log('[VegaChart] Setting container state...');
      setContainer(node);
    } else {
      console.log('[VegaChart] Node is null (unmounting)');
      // Don't clear container state here - let useEffect cleanup handle it
    }
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

        // Create a child div for vega to render into (isolates from React)
        const vegaContainer = document.createElement('div');
        vegaContainer.className = 'vega-render-target';
        vegaContainer.style.width = '100%';
        vegaContainer.style.height = '100%';

        // Clear any existing content and append new container
        while (container.firstChild) {
          container.removeChild(container.firstChild);
        }
        container.appendChild(vegaContainer);

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

        console.log('[VegaChart] Calling vega-embed...');

        // Vega-embed renders into the isolated child div
        const result = await embed(vegaContainer, spec, {
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

    // Cleanup: finalize vega view ONLY (let React handle DOM)
    return () => {
      isMounted = false;

      if (vegaView && vegaView.finalize) {
        try {
          vegaView.finalize();
          console.log('[VegaChart] Vega view finalized');
        } catch (e) {
          console.warn('[VegaChart] Cleanup error (ignored):', e);
        }
      }

      // Don't manually remove children - vega.finalize() + React cleanup is enough
      // Manual removeChild causes conflicts with React's reconciliation
    };
  }, [container, spec]);

  // Always render the container div (needed for callback ref to be called)
  return (
    <div
      id={chartId}
      ref={setContainerRef}
      className={cn(
        'vega-chart-container my-4 min-h-[300px] overflow-auto rounded-lg border bg-white p-4',
        className,
      )}
      suppressHydrationWarning
    >
      {error && (
        <div className="rounded border border-red-300 bg-red-50 p-4 text-red-700">
          <p className="font-semibold text-sm">Chart Rendering Error</p>
          <p className="text-xs">{error}</p>
        </div>
      )}

      {isLoading && !error && (
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <div className="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm">Loading visualization...</p>
        </div>
      )}

      {/* Vega will inject the chart here when ready */}
    </div>
  );
}
