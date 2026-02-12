import { tool } from 'ai';
import { z } from 'zod';
import { ITool } from '../tokens';

const DEFAULT_MAX_CONTENT_CHARS = 20000;
const MAX_ALLOWED_CONTENT_CHARS = 100000;
const DEFAULT_TIMEOUT_MS = 20000;
const MAX_TIMEOUT_MS = 120000;

/**
 * Create a browser-native URL fetch tool.
 *
 * This is best-effort and subject to normal browser constraints (CORS, CSP,
 * mixed content, bot protections).
 */
export function createBrowserFetchTool(): ITool {
  return tool({
    title: 'Browser Fetch',
    description:
      'Fetch a URL directly from the browser using HTTP GET. Useful for exact URL inspection when CORS/access permits.',
    inputSchema: z.object({
      url: z.string().describe('HTTP(S) URL to fetch'),
      maxContentChars: z
        .number()
        .int()
        .min(1)
        .max(MAX_ALLOWED_CONTENT_CHARS)
        .optional()
        .describe(
          `Maximum number of response characters to return (default: ${DEFAULT_MAX_CONTENT_CHARS})`
        ),
      timeoutMs: z
        .number()
        .int()
        .min(1000)
        .max(MAX_TIMEOUT_MS)
        .optional()
        .describe(
          `Timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS}, max: ${MAX_TIMEOUT_MS})`
        )
    }),
    execute: async (input: {
      url: string;
      maxContentChars?: number;
      timeoutMs?: number;
    }) => {
      const maxContentChars = Math.min(
        input.maxContentChars ?? DEFAULT_MAX_CONTENT_CHARS,
        MAX_ALLOWED_CONTENT_CHARS
      );
      const timeoutMs = Math.min(
        input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        MAX_TIMEOUT_MS
      );

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(input.url);
      } catch {
        return {
          success: false,
          errorType: 'invalid_url',
          error: 'Invalid URL format',
          url: input.url
        };
      }

      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return {
          success: false,
          errorType: 'unsupported_protocol',
          error: 'Only http:// and https:// URLs are supported',
          url: input.url
        };
      }

      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(parsedUrl.toString(), {
          method: 'GET',
          redirect: 'follow',
          signal: controller.signal,
          headers: {
            Accept:
              'text/html,text/plain,application/json,text/markdown,*/*;q=0.8'
          }
        });

        const contentType = response.headers.get('content-type') || '';
        const contentLength = response.headers.get('content-length');
        const body = await response.text();
        const truncated = body.length > maxContentChars;
        const content = truncated ? body.slice(0, maxContentChars) : body;
        const success = response.ok;

        return {
          success,
          url: response.url,
          requestedUrl: parsedUrl.toString(),
          status: response.status,
          statusText: response.statusText,
          ok: response.ok,
          contentType,
          contentLength,
          ...(success
            ? {}
            : {
                errorType: 'http_error',
                error: `HTTP ${response.status} ${response.statusText}`
              }),
          isTruncated: truncated,
          returnedChars: content.length,
          totalChars: body.length,
          content,
          limitations:
            'Browser fetch is subject to CORS, site bot protections, and browser network policy.'
        };
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          return {
            success: false,
            errorType: 'timeout',
            error: `Request timed out after ${timeoutMs} ms`,
            url: parsedUrl.toString()
          };
        }

        return {
          success: false,
          errorType: 'network_or_cors',
          error: (error as Error).message || 'Fetch failed',
          url: parsedUrl.toString(),
          likelyCauses: [
            'CORS blocked by the target website',
            'DNS/network resolution failure',
            'TLS/certificate issue',
            'Target server rejected browser access'
          ]
        };
      } finally {
        clearTimeout(timeoutHandle);
      }
    }
  });
}
