import type { VisualizationSpec } from 'vega-embed';

interface ExtractedContent {
  text: string;
  vegaSpecs: VisualizationSpec[];
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
 * Extracts ALL Vega-Lite specifications from text content.
 * Supports multiple formats:
 * 1. vega-lite code blocks: ```vega-lite\n{...}\n```
 * 2. JSON code blocks: ```json\n{...}\n```
 * 3. Raw JSON objects that look like Vega-Lite specs
 */
export function extractVegaSpec(content: string): ExtractedContent {
  const vegaSpecs: VisualizationSpec[] = [];
  let remainingText = content;

  // Extract ALL vega-lite blocks (use matchAll for multiple)
  const vegaBlockMatches = content.matchAll(/```vega-lite\s*([\s\S]*?)\s*```/g);
  for (const match of vegaBlockMatches) {
    try {
      const spec = JSON.parse(match[1]);
      if (isVegaLiteSpec(spec)) {
        vegaSpecs.push(spec);
        remainingText = remainingText.replace(match[0], '');
      }
    } catch {
      // Not valid JSON, skip
    }
  }

  // Extract ALL json blocks that are vega specs
  const jsonBlockMatches = content.matchAll(/```json\s*([\s\S]*?)\s*```/g);
  for (const match of jsonBlockMatches) {
    try {
      const spec = JSON.parse(match[1]);
      if (isVegaLiteSpec(spec)) {
        vegaSpecs.push(spec);
        remainingText = remainingText.replace(match[0], '');
      }
    } catch {
      // Not valid JSON, skip
    }
  }

  // If we already found specs in code blocks, return them
  if (vegaSpecs.length > 0) {
    return { text: remainingText.trim(), vegaSpecs };
  }

  // Fallback: Try to find any JSON objects that look like Vega-Lite
  // Find all { positions and try parsing from each
  const positions: number[] = [];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '{') {
      positions.push(i);
    }
  }

  // Track which ranges we've already extracted to avoid duplicates
  const extractedRanges: Array<{ start: number; end: number }> = [];

  for (const pos of positions) {
    // Skip if this position is within an already extracted range
    if (extractedRanges.some((r) => pos >= r.start && pos < r.end)) {
      continue;
    }

    try {
      // Try to find the matching closing brace
      let depth = 0;
      let endPos = pos;
      let inString = false;
      let escapeNext = false;

      for (let i = pos; i < content.length; i++) {
        const char = content[i];

        if (escapeNext) {
          escapeNext = false;
          continue;
        }

        if (char === '\\') {
          escapeNext = true;
          continue;
        }

        if (char === '"') {
          inString = !inString;
          continue;
        }

        if (!inString) {
          if (char === '{') depth++;
          if (char === '}') {
            depth--;
            if (depth === 0) {
              endPos = i + 1;
              break;
            }
          }
        }
      }

      if (endPos > pos) {
        const possibleJson = content.slice(pos, endPos);
        const spec = JSON.parse(possibleJson);
        if (isVegaLiteSpec(spec)) {
          vegaSpecs.push(spec);
          extractedRanges.push({ start: pos, end: endPos });
          remainingText = remainingText.replace(possibleJson, '');
        }
      }
    } catch {
      // Not valid JSON from this position, continue
    }
  }

  return { text: remainingText.trim(), vegaSpecs };
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
