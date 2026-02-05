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

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !spec) return;

    const renderChart = async () => {
      try {
        setError(null);
        await embed(container, spec, {
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
  }, [spec]);

  if (error) {
    return (
      <div className="rounded border border-red-300 bg-red-50 p-4 text-red-700">
        <p className="font-semibold text-sm">Chart Rendering Error</p>
        <p className="text-xs">{error}</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        'vega-chart-container my-4 overflow-auto rounded-lg border bg-white p-4',
        className,
      )}
    />
  );
}
