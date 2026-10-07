import type { IMimeModelBody } from '@jupyter/chat';

interface IDisplayOutput {
  output_type: string;
  data?: unknown;
  metadata?: unknown;
}

const DISPLAY_OUTPUT_TYPES = new Set([
  'display_data',
  'update_display_data',
  'execute_result'
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDisplayOutput(value: unknown): value is IDisplayOutput {
  return (
    isPlainObject(value) &&
    typeof value.output_type === 'string' &&
    DISPLAY_OUTPUT_TYPES.has(value.output_type)
  );
}

function displayOutputs(value: unknown): IDisplayOutput[] {
  if (isDisplayOutput(value)) {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.filter(isDisplayOutput);
  }
  if (!isPlainObject(value)) {
    return [];
  }
  return Array.isArray(value.outputs)
    ? value.outputs.filter(isDisplayOutput)
    : displayOutputs(value.result);
}

/**
 * The rich outputs (display data) in the result of a JupyterLab command, as
 * chat MIME bundles.
 */
export function mimeBundles(
  result: unknown,
  trustedMimeTypes: ReadonlySet<string>
): IMimeModelBody[] {
  return displayOutputs(result)
    .filter(
      output => isPlainObject(output.data) && Object.keys(output.data).length
    )
    .map(output => {
      const data = output.data as IMimeModelBody['data'];
      return {
        data,
        ...(isPlainObject(output.metadata) && {
          metadata: output.metadata as IMimeModelBody['metadata']
        }),
        ...(Object.keys(data).some(type => trustedMimeTypes.has(type)) && {
          trusted: true
        })
      };
    });
}
