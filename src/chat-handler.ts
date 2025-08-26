/*
 * Copyright (c) Jupyter Development Team.
 * Distributed under the terms of the Modified BSD License.
 */

import {
  ChatCommand,
  AbstractChatContext,
  AbstractChatModel,
  IChatCommandProvider,
  IChatContext,
  IChatMessage,
  IChatModel,
  IInputModel,
  INewMessage,
  IUser
} from '@jupyter/chat';
import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  mergeMessageRuns,
  SystemMessage,
  ToolMessage
} from '@langchain/core/messages';
import { UUID } from '@lumino/coreutils';

import {
  DEFAULT_CHAT_SYSTEM_PROMPT,
  DEFAULT_AGENT_SYSTEM_PROMPT
} from './default-prompts';
import { jupyternautLiteIcon } from './icons';
import { IAIProviderRegistry, IToolRegistry } from './tokens';
import { AIChatModel } from './types/ai-model';

/**
 * The base64 encoded SVG string of the jupyternaut lite icon.
 * Encode so it can be passed as avatar_url to jupyter-chat.
 */
const AI_AVATAR_BASE64 = btoa(jupyternautLiteIcon.svgstr);
const AI_AVATAR = `data:image/svg+xml;base64,${AI_AVATAR_BASE64}`;

export const welcomeMessage = (
  providers: string[],
  hasAgent: boolean = false
) => `
#### ${hasAgent ? '🤖 JupyterLite AI Agent' : 'Ask JupyterLite AI'}

${
  hasAgent
    ? `
**✨ I'm your AI coding assistant with enhanced capabilities!**

I can actively help you with:
- 📊 **Notebook operations** - Create, edit, and run cells
- 📁 **File management** - Create, edit, and organize files
- 🧠 **Code development** - Write, debug, and optimize Python code
- 🔧 **Interactive assistance** - Execute tasks directly in your environment

Just ask me to help with your data science, research, or development work!

---
`
    : ''
}

The provider to use can be set in the <button data-commandLinker-command="settingeditor:open" data-commandLinker-args='{"query": "AI provider"}' href="#">settings editor</button>, by selecting it from
the <img src="${AI_AVATAR}" width="16" height="16"> _AI provider_ settings.

The current providers that are available are _${providers.sort().join('_, _')}_.

To clear the chat, you can use the \`/clear\` command from the chat input.
`;

export class ChatHandler extends AbstractChatModel {
  constructor(options: ChatHandler.IOptions) {
    super(options);
    this._providerRegistry = options.providerRegistry;
    this._toolRegistry = options.toolRegistry;

    this._providerRegistry.providerChanged.connect(() => {
      this._errorMessage = this._providerRegistry.chatError;
    });
  }

  clearMessages(): void {
    super.clearMessages();
    this._history = [];
  }

  /**
   * The provider registry.
   */
  get providerRegistry(): IAIProviderRegistry {
    return this._providerRegistry;
  }

  /**
   * Get the tool registry.
   */
  get toolRegistry(): IToolRegistry | undefined {
    return this._toolRegistry;
  }

  /**
   * Get the agent from the provider registry.
   */
  get agent(): AIChatModel | null {
    return this._providerRegistry.currentAgent;
  }

  /**
   * Get the chat model from the provider registry.
   */
  get chatModel(): AIChatModel | null {
    return this._providerRegistry.currentChatModel;
  }

  /**
   * Getter and setter for the persona name.
   */
  get personaName(): string {
    return this._personaName;
  }
  set personaName(value: string) {
    this.messages.forEach(message => {
      if (message.sender.username === this._personaName) {
        const updated: IChatMessage = { ...message };
        updated.sender.username = value;
        this.messageAdded(updated);
      }
    });
    this._personaName = value;
  }

  /**
   * Get the system prompt for the chat.
   */
  get systemPrompt(): string {
    // Use agent-specific prompt when agent is available
    if (this.agent !== null) {
      return DEFAULT_AGENT_SYSTEM_PROMPT.replaceAll(
        '$provider_name$',
        this._providerRegistry.currentName('chat')
      );
    }
    return (
      this._providerRegistry.chatSystemPrompt ?? DEFAULT_CHAT_SYSTEM_PROMPT
    );
  }

  async sendMessage(message: INewMessage): Promise<boolean> {
    const body = message.body;
    if (body.startsWith('/clear')) {
      // TODO: do we need a clear method?
      this.messagesDeleted(0, this.messages.length);
      this._history = [];
      return false;
    }
    message.id = UUID.uuid4();
    const msg: IChatMessage = {
      id: message.id,
      body,
      sender: { username: 'User' },
      time: Private.getTimestampMs(),
      type: 'msg'
    };
    this.messageAdded(msg);

    const chatModel = this.chatModel;

    if (chatModel === null) {
      const errorMsg: IChatMessage = {
        id: UUID.uuid4(),
        body: `**${this._errorMessage ? this._errorMessage : this._defaultErrorMessage}**`,
        sender: { username: 'ERROR' },
        time: Private.getTimestampMs(),
        type: 'msg'
      };
      this.messageAdded(errorMsg);
      return false;
    }

    const messages = mergeMessageRuns([
      new SystemMessage(this.systemPrompt),
      ...this._history
    ]);

    const newMessage = new HumanMessage(msg.body);
    messages.push(newMessage);
    this._history.push(newMessage);

    const sender = { username: this._personaName, avatar_url: AI_AVATAR };
    this.updateWriters([{ user: sender }]);

    if (this.agent !== null) {
      return this._sendAgentMessage(this.agent, messages, sender);
    }

    return this._sentChatMessage(chatModel, messages, sender);
  }

  dispose(): void {
    super.dispose();
  }

  messageAdded(message: IChatMessage): void {
    super.messageAdded(message);
  }

  stopStreaming(): void {
    this._controller?.abort();
  }

  createChatContext(): IChatContext {
    return new ChatHandler.ChatContext({ model: this });
  }

  private async _sentChatMessage(
    chatModel: AIChatModel,
    messages: BaseMessage[],
    sender: IUser
  ): Promise<boolean> {
    // Create an empty message to be filled by the AI provider
    const botMsg: IChatMessage = {
      id: UUID.uuid4(),
      body: '',
      sender,
      time: Private.getTimestampMs(),
      type: 'msg'
    };
    let content = '';
    this._controller = new AbortController();
    try {
      for await (const chunk of await chatModel.stream(messages, {
        signal: this._controller.signal
      })) {
        content += chunk.content ?? chunk;
        botMsg.body = content;
        this.messageAdded(botMsg);
      }
      this._history.push(new AIMessage(content));
      return true;
    } catch (reason) {
      const error = this._providerRegistry.formatErrorMessage(reason);
      const errorMsg: IChatMessage = {
        id: UUID.uuid4(),
        body: `**${error}**`,
        sender: { username: 'ERROR' },
        time: Private.getTimestampMs(),
        type: 'msg'
      };
      this.messageAdded(errorMsg);
      return false;
    } finally {
      this.updateWriters([]);
      this._controller = null;
    }
  }

  private async _sendAgentMessage(
    agent: AIChatModel,
    messages: BaseMessage[],
    sender: IUser
  ): Promise<boolean> {
    this._controller = new AbortController();
    let finalResponse = '';
    const currentMessageId = UUID.uuid4();
    let messageContent = '';
    const chronologicalItems: Array<{
      type: 'tool_call' | 'tool_result' | 'thinking';
      data: any;
      timestamp: number;
    }> = [];
    let isStreaming = false;

    const updateMessage = () => {
      // Sort items by timestamp to maintain chronological order
      const sortedItems = [...chronologicalItems].sort(
        (a, b) => a.timestamp - b.timestamp
      );

      const chronologicalSection = sortedItems
        .map(item => {
          switch (item.type) {
            case 'tool_call':
              return `<details class="jp-ai-tool-call">\n<summary>🔧 <strong>Using tool: ${item.data.name}</strong></summary>\n\n\`\`\`json\n${JSON.stringify(item.data.args, null, 2)}\n\`\`\`\n</details>\n\n`;
            case 'tool_result':
              try {
                const contentData = JSON.parse(item.data.content);
                const title =
                  contentData.command || item.data.name || 'Tool Result';
                return `<details class="jp-ai-tool-result">\n<summary>📋 <strong>${title}</strong></summary>\n\n\`\`\`\n${item.data.content}\n\`\`\`\n</details>\n\n`;
              } catch {
                const title = item.data.name || 'Tool Result';
                return `<details class="jp-ai-tool-result">\n<summary>📋 <strong>${title}</strong></summary>\n\n\`\`\`\n${item.data.content}\n\`\`\`\n</details>\n\n`;
              }
            case 'thinking':
              return chronologicalItems.length === 1
                ? item.data.content // Show thinking directly if it's the only content
                : `<details class="jp-ai-thinking" ${chronologicalItems.filter(i => i.type !== 'thinking').length === 0 ? 'open' : ''}>\n<summary>💭 <strong>Thinking</strong></summary>\n\n${item.data.content}\n</details>\n\n`;
            default:
              return '';
          }
        })
        .join('');

      const finalContent = chronologicalSection + finalResponse;

      this.messageAdded({
        id: currentMessageId,
        body: finalContent || (isStreaming ? '_AI is thinking..._' : ''),
        sender,
        time: Private.getTimestampMs(),
        type: 'msg'
      });
    };

    try {
      for await (const chunk of await agent.stream(
        { messages },
        {
          streamMode: 'updates',
          signal: this._controller.signal
        }
      )) {
        if ((chunk as any).agent) {
          const agentMessages = (chunk as any).agent.messages;
          agentMessages.forEach((message: BaseMessage) => {
            this._history.push(message);

            if (message instanceof AIMessage) {
              // Handle AI messages with tool calls
              if (
                (message as any).tool_calls &&
                (message as any).tool_calls.length > 0
              ) {
                const newToolCalls = (message as any).tool_calls;
                newToolCalls.forEach((toolCall: any) => {
                  chronologicalItems.push({
                    type: 'tool_call',
                    data: toolCall,
                    timestamp: Date.now()
                  });
                });
                isStreaming = true;
                updateMessage();
              }

              // Handle regular AI message content
              if (message.content) {
                const contents: string[] = [];
                if (typeof message.content === 'string') {
                  contents.push(message.content);
                } else if (Array.isArray(message.content)) {
                  message.content.forEach(content => {
                    if (content.type === 'text') {
                      contents.push(content.text);
                    }
                  });
                }
                contents.forEach(content => {
                  if (content.trim()) {
                    if (
                      chronologicalItems.some(
                        item =>
                          item.type === 'tool_call' ||
                          item.type === 'tool_result'
                      )
                    ) {
                      // This is thinking content, add it to chronological items
                      messageContent += content;
                      // Update or add thinking item
                      const existingThinking = chronologicalItems.find(
                        item => item.type === 'thinking'
                      );
                      if (existingThinking) {
                        existingThinking.data.content = messageContent;
                      } else {
                        chronologicalItems.push({
                          type: 'thinking',
                          data: { content: messageContent },
                          timestamp: Date.now()
                        });
                      }
                    } else {
                      // This is the final response
                      finalResponse += content;
                    }
                    isStreaming = true;
                    updateMessage();
                  }
                });
              }
            } else if (message instanceof ToolMessage) {
              // Handle tool response messages
              const content = message.content as string;
              chronologicalItems.push({
                type: 'tool_result',
                data: {
                  name: (message as any).name || 'Unknown',
                  content: content
                },
                timestamp: Date.now()
              });
              isStreaming = true;
              updateMessage();
            }
          });
        } else if ((chunk as any).tools) {
          const toolMessages = (chunk as any).tools.messages;
          toolMessages.forEach((message: BaseMessage) => {
            this._history.push(message);
            if (message instanceof ToolMessage) {
              const content = message.content as string;
              chronologicalItems.push({
                type: 'tool_result',
                data: {
                  name: (message as any).name || 'Unknown',
                  content: content
                },
                timestamp: Date.now()
              });
              isStreaming = true;
              updateMessage();
            }
          });
        }
      }

      // Final update to ensure everything is rendered
      updateMessage();
      return true;
    } catch (reason) {
      const error = this._providerRegistry.formatErrorMessage(reason);
      const errorMsg: IChatMessage = {
        id: UUID.uuid4(),
        body: `**${error}**`,
        sender: { username: 'ERROR' },
        time: Private.getTimestampMs(),
        type: 'msg'
      };
      this.messageAdded(errorMsg);
      return false;
    } finally {
      this.updateWriters([]);
      this._controller = null;
    }
  }

  private _providerRegistry: IAIProviderRegistry;
  private _personaName = 'AI';
  private _errorMessage: string = '';
  private _history: BaseMessage[] = [];
  private _defaultErrorMessage = 'AI provider not configured';
  private _controller: AbortController | null = null;
  private _toolRegistry?: IToolRegistry;
}

export namespace ChatHandler {
  /**
   * The options used to create a chat handler.
   */
  export interface IOptions extends IChatModel.IOptions {
    providerRegistry: IAIProviderRegistry;
    toolRegistry?: IToolRegistry;
  }

  /**
   * The chat context.
   */
  export class ChatContext extends AbstractChatContext {
    users = [];

    /**
     * The provider registry.
     */
    get providerRegistry(): IAIProviderRegistry {
      return (this._model as ChatHandler).providerRegistry;
    }

    /**
     * The tool registry.
     */
    get toolsRegistry(): IToolRegistry | undefined {
      return (this._model as ChatHandler).toolRegistry;
    }
  }

  /**
   *  The chat command provider for the chat.
   */
  export class ClearCommandProvider implements IChatCommandProvider {
    public id: string = '@jupyterlite/ai:clear-commands';
    private _slash_commands: ChatCommand[] = [
      {
        name: '/clear',
        providerId: this.id,
        replaceWith: '/clear',
        description: 'Clear the chat'
      }
    ];
    async listCommandCompletions(inputModel: IInputModel) {
      const match = inputModel.currentWord?.match(/^\/\w*/)?.[0];
      if (!match) {
        return [];
      }

      const commands = this._slash_commands.filter(cmd =>
        cmd.name.startsWith(match)
      );
      return commands;
    }

    async onSubmit(inputModel: IInputModel): Promise<void> {
      // no handling needed because `replaceWith` is set in each command.
      return;
    }
  }
}

namespace Private {
  /**
   * Return the current timestamp in milliseconds.
   */
  export function getTimestampMs(): number {
    return Date.now() / 1000;
  }
}
