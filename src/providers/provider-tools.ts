import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';
import { openai } from '@ai-sdk/openai';
import type { Tool } from 'ai';

type ToolMap = Record<string, Tool>;

interface IProviderToolContext {
  provider: string;
  customSettings?: unknown;
  hasFunctionTools: boolean;
}

type IUserLocation = {
  type: 'approximate';
  country?: string;
  city?: string;
  region?: string;
  timezone?: string;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const values = value.filter(
    v => typeof v === 'string' && v.trim()
  ) as string[];
  return values.length > 0 ? values : undefined;
}

function asSearchContextSize(
  value: unknown
): 'low' | 'medium' | 'high' | undefined {
  if (value === 'low' || value === 'medium' || value === 'high') {
    return value;
  }
  return undefined;
}

function asGoogleSearchMode(
  value: unknown
): 'MODE_DYNAMIC' | 'MODE_UNSPECIFIED' | undefined {
  if (value === 'MODE_DYNAMIC' || value === 'MODE_UNSPECIFIED') {
    return value;
  }
  return undefined;
}

function asUserLocation(value: unknown): IUserLocation | undefined {
  const location = asRecord(value);
  if (!location) {
    return undefined;
  }

  const country = asString(location.country);
  const city = asString(location.city);
  const region = asString(location.region);
  const timezone = asString(location.timezone);

  if (!country && !city && !region && !timezone) {
    return undefined;
  }

  return {
    type: 'approximate',
    ...(country && { country }),
    ...(city && { city }),
    ...(region && { region }),
    ...(timezone && { timezone })
  };
}

function createOpenAIWebSearchTool(
  webSearchSettings: Record<string, unknown>
): Tool {
  const externalWebAccess = asBoolean(webSearchSettings.externalWebAccess);
  const searchContextSize = asSearchContextSize(
    webSearchSettings.searchContextSize
  );
  const userLocation = asUserLocation(webSearchSettings.userLocation);
  const allowedDomains = asStringArray(webSearchSettings.allowedDomains);

  return openai.tools.webSearch({
    ...(externalWebAccess !== undefined && { externalWebAccess }),
    ...(searchContextSize && { searchContextSize }),
    ...(userLocation && { userLocation }),
    ...(allowedDomains && {
      filters: {
        allowedDomains
      }
    })
  });
}

function createAnthropicWebSearchTool(
  webSearchSettings: Record<string, unknown>
): Tool {
  const maxUses = asNumber(webSearchSettings.maxUses);
  const allowedDomains = asStringArray(webSearchSettings.allowedDomains);
  const blockedDomains = asStringArray(webSearchSettings.blockedDomains);
  const userLocation = asUserLocation(webSearchSettings.userLocation);

  return anthropic.tools.webSearch_20250305({
    ...(maxUses !== undefined && { maxUses }),
    ...(allowedDomains && { allowedDomains }),
    ...(blockedDomains && { blockedDomains }),
    ...(userLocation && { userLocation })
  });
}

function createAnthropicWebFetchTool(
  webFetchSettings: Record<string, unknown>
): Tool {
  const maxUses = asNumber(webFetchSettings.maxUses);
  const allowedDomains = asStringArray(webFetchSettings.allowedDomains);
  const blockedDomains = asStringArray(webFetchSettings.blockedDomains);
  const maxContentTokens = asNumber(webFetchSettings.maxContentTokens);
  const citationsEnabled = asBoolean(webFetchSettings.citationsEnabled);
  const citations = asRecord(webFetchSettings.citations);
  const citationsFromObject = asBoolean(citations?.enabled);

  return anthropic.tools.webFetch_20250910({
    ...(maxUses !== undefined && { maxUses }),
    ...(allowedDomains && { allowedDomains }),
    ...(blockedDomains && { blockedDomains }),
    ...(maxContentTokens !== undefined && { maxContentTokens }),
    ...(citationsEnabled !== undefined && {
      citations: { enabled: citationsEnabled }
    }),
    ...(citationsFromObject !== undefined && {
      citations: { enabled: citationsFromObject }
    })
  });
}

function createGoogleWebSearchTool(
  webSearchSettings: Record<string, unknown>
): Tool {
  const mode = asGoogleSearchMode(webSearchSettings.mode);
  const dynamicThreshold = asNumber(webSearchSettings.dynamicThreshold);

  return google.tools.googleSearch({
    ...(mode && { mode }),
    ...(dynamicThreshold !== undefined && { dynamicThreshold })
  });
}

export function createProviderTools(options: IProviderToolContext): ToolMap {
  const tools: ToolMap = {};
  const customSettings = asRecord(options.customSettings);

  if (!customSettings) {
    return tools;
  }

  const webSearchSettings = asRecord(customSettings.webSearch);
  const webFetchSettings = asRecord(customSettings.webFetch);
  const webSearchEnabled = asBoolean(webSearchSettings?.enabled) === true;
  const webFetchEnabled = asBoolean(webFetchSettings?.enabled) === true;

  switch (options.provider) {
    case 'openai': {
      if (webSearchEnabled && webSearchSettings) {
        tools.web_search = createOpenAIWebSearchTool(webSearchSettings);
      }
      break;
    }

    case 'anthropic': {
      if (webSearchEnabled && webSearchSettings) {
        tools.web_search = createAnthropicWebSearchTool(webSearchSettings);
      }
      if (webFetchEnabled && webFetchSettings) {
        tools.web_fetch = createAnthropicWebFetchTool(webFetchSettings);
      }
      break;
    }

    case 'google': {
      if (webSearchEnabled && webSearchSettings) {
        // Google provider-defined tools currently conflict with function tools
        // in some AI SDK + Gemini combinations (custom tools can be ignored).
        // Keep this guard until upstream behavior is resolved:
        // https://github.com/vercel/ai/issues/8258
        if (options.hasFunctionTools) {
          console.warn(
            'Skipping google_search provider tool because it cannot be mixed with function tools.'
          );
        } else {
          tools.google_search = createGoogleWebSearchTool(webSearchSettings);
        }
      }
      break;
    }

    default:
      break;
  }

  return tools;
}
