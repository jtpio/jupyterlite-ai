# Custom Providers

`jupyterlite-ai` supports custom AI providers through its provider registry system. Third-party providers can be registered programmatically in a JupyterLab extension.

Providers are [pi-ai](https://pi.dev) providers (`@earendil-works/pi-ai`): a provider owns its API adapter, its model catalog and its auth. The agent runs on `@earendil-works/pi-agent-core`, so anything pi-ai can talk to can be registered.

## Registering a Custom Provider

### Example: Registering a custom OpenAI-compatible provider

```typescript
import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { IProviderRegistry } from '@jupyterlite/ai';
import { createProvider } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';

const plugin: JupyterFrontEndPlugin<void> = {
  id: 'my-extension:custom-provider',
  autoStart: true,
  requires: [IProviderRegistry],
  activate: (app: JupyterFrontEnd, registry: IProviderRegistry) => {
    registry.registerProvider({
      id: 'my-custom-provider',
      name: 'My Custom Provider',
      apiKeyRequirement: 'required',
      defaultModels: ['my-model'],
      modelInfo: {
        'my-model': {
          contextWindow: 128000
        }
      },
      supportsBaseURL: true,
      supportsHeaders: true,
      provider: createProvider({
        id: 'my-custom-provider',
        name: 'My Custom Provider',
        baseUrl: 'https://api.example.com/v1',
        auth: {
          apiKey: {
            name: 'My Custom Provider API key',
            resolve: async () => ({ auth: {} })
          }
        },
        models: [],
        api: openAICompletionsApi()
      }),
      api: 'openai-completions'
    });
  }
};
```

The provider configuration object requires the following properties:

- `id`: Unique identifier for the provider
- `name`: Display name shown in the settings UI
- `apiKeyRequirement`: Whether an API key is `'required'`, `'optional'`, or `'none'`
- `defaultModels`: Array of model names to show in the settings
- `modelInfo` (optional): Per-model metadata such as `contextWindow`
- `supportsBaseURL`: Whether the provider supports a custom base URL
- `supportsHeaders`: Whether the provider supports custom HTTP headers
- `provider`: The pi-ai `Provider` (from `createProvider()` or one of the pi-ai provider factories such as `openaiProvider()`)
- `api`: The pi-ai API of the models that are not in the catalog of the provider (for example `'openai-completions'`, `'openai-responses'`, `'anthropic-messages'`)

The API key entered in the settings UI (or stored in the secrets manager) is
passed to the provider with every request, so the `auth` of the provider only
needs to say that the provider is configured.

## Models

The registry builds the pi-ai `Model` for a configured provider with
`IProviderRegistry.createModel()`: it uses the catalog entry of the provider
when the model id is known, and describes the model from `modelInfo` otherwise.
The base URL and the headers configured in the UI override the ones of the
provider.

Extensions can also run their own requests with the pi-ai `Models` collection
of the registry (`IProviderRegistry.models`), for example
`models.completeSimple(model, context, { apiKey })`.

## Hiding the Built-In Settings UI

If your extension ships a fully configured provider and you do not want users to
edit provider settings, disable the `@jupyterlite/ai:settings-panel` plugin.
This hides the AI settings command and the chat toolbar button without
disabling the rest of `jupyterlite-ai`.

For example, in your `jupyter-config-data` or `page_config.json`:

```json
{
  "disabledExtensions": ["@jupyterlite/ai:settings-panel"]
}
```

## Custom Tools

Tools are pi `AgentTool`s with a [TypeBox](https://github.com/sinclairzx81/typebox)
parameter schema. The `jsonTool()` helper of `@jupyternaut/agent` builds one
whose result is serialized as JSON:

```typescript
import { jsonTool, Type } from '@jupyternaut/agent';

const tool = jsonTool({
  name: 'get_time',
  label: 'Get time',
  description: 'Get the current time.',
  parameters: Type.Object({
    timezone: Type.Optional(Type.String({ description: 'IANA timezone' }))
  }),
  execute: async ({ timezone }) => ({
    now: new Date().toLocaleString('en-US', { timeZone: timezone })
  })
});
```

Set `needsApproval` to `true` (or to a predicate on the arguments) to ask the
user before the tool runs.
