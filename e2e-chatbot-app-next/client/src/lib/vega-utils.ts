import type { VisualizationSpec } from 'vega-embed';

interface ExtractedContent {
  text: string;
  vegaSpec: VisualizationSpec | null;
}

/**
 * Extracts Vega-Lite spec from UC function tool output format.
 * Format: {"columns":["output"],"rows":[["{...vega spec...}"]]}
 */
export function extractVegaFromToolOutput(
  output: unknown,
): VisualizationSpec | null {
  try {
    // Check if output matches the expected structure
    if (
      typeof output === 'object' &&
      output !== null &&
      'rows' in output &&
      Array.isArray((output as any).rows)
    ) {
      const rows = (output as any).rows;
      if (rows.length > 0 && Array.isArray(rows[0]) && rows[0].length > 0) {
        const specString = rows[0][0];
        if (typeof specString === 'string') {
          const spec = JSON.parse(specString);
          if (isVegaLiteSpec(spec)) {
            return spec;
          }
        }
      }
    }

    // Also try parsing if output is a string directly
    if (typeof output === 'string') {
      const spec = JSON.parse(output);
      if (isVegaLiteSpec(spec)) {
        return spec;
      }
    }
  } catch (_err) {
    // Not a valid Vega spec, ignore
  }

  return null;
}

/**
 * Extracts Vega-Lite specification from text content.
 * Supports multiple formats:
 * 1. vega-lite code blocks: ```vega-lite\n{...}\n```
 * 2. JSON code blocks: ```json\n{...}\n```
 * 3. Raw JSON at the end of text
 * 4. Inline JSON after colons
 */
export function extractVegaSpec(content: string): ExtractedContent {
  // Pattern 1: Vega-Lite code block (preferred format)
  const vegaBlockMatch = content.match(/```vega-lite\s*([\s\S]*?)\s*```/);
  if (vegaBlockMatch) {
    try {
      const spec = JSON.parse(vegaBlockMatch[1]);
      if (isVegaLiteSpec(spec)) {
        return {
          text: content.replace(vegaBlockMatch[0], '').trim(),
          vegaSpec: spec,
        };
      }
    } catch (err) {
      console.error('Failed to parse vega-lite block:', err);
    }
  }

  // Pattern 2: JSON code block
  const jsonBlockMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonBlockMatch) {
    try {
      const spec = JSON.parse(jsonBlockMatch[1]);
      if (isVegaLiteSpec(spec)) {
        return {
          text: content.replace(jsonBlockMatch[0], '').trim(),
          vegaSpec: spec,
        };
      }
    } catch (err) {
      console.error('Failed to parse json block:', err);
    }
  }

  // Pattern 2: Raw JSON at end (like "Here's a chart:\n{...}")
  const colonMatch = content.match(/:\s*$/);
  if (colonMatch) {
    const lastBraceIndex = content.lastIndexOf('{');
    if (lastBraceIndex !== -1) {
      try {
        const possibleJson = content.slice(lastBraceIndex);
        const spec = JSON.parse(possibleJson);
        if (isVegaLiteSpec(spec)) {
          return {
            text: content.slice(0, lastBraceIndex).trim(),
            vegaSpec: spec,
          };
        }
      } catch {
        // Not valid JSON
      }
    }
  }

  // Pattern 3: Try to find any JSON object that looks like Vega-Lite
  const braceMatches = [...content.matchAll(/\{[\s\S]*?\}/g)];
  for (const match of braceMatches) {
    try {
      const spec = JSON.parse(match[0]);
      if (isVegaLiteSpec(spec)) {
        return {
          text: content.replace(match[0], '').trim(),
          vegaSpec: spec,
        };
      }
    } catch {
      // Not valid JSON, continue
    }
  }

  return { text: content, vegaSpec: null };
}

/**
 * Checks if an object is a valid Vega-Lite specification.
 * Looks for key indicators like $schema, mark, layer, or encoding.
 */
function isVegaLiteSpec(obj: unknown): obj is VisualizationSpec {
  if (typeof obj !== 'object' || obj === null) return false;

  const spec = obj as Record<string, unknown>;

  // Check for Vega-Lite schema
  if (
    typeof spec.$schema === 'string' &&
    spec.$schema.includes('vega-lite')
  ) {
    return true;
  }

  // Check for key Vega-Lite properties
  const hasMarkOrLayer = 'mark' in spec || 'layer' in spec || 'spec' in spec;
  const hasDataOrEncoding = 'data' in spec || 'encoding' in spec;

  return hasMarkOrLayer || hasDataOrEncoding;
}
