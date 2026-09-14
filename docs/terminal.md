# Terminal agent

`jupyternaut-terminal` adds the Jupyternaut coding agent to the
[JupyterLite terminal](https://github.com/jupyterlite/terminal) as a
`jupyternaut` command (alias: `ai`), similar to running a coding agent such as
Claude Code in a regular terminal.

Everything runs in the browser: the agent talks to the LLM provider configured
in the AI settings, runs shell commands in the in-browser `cockle` shell, and
reads and writes files of the JupyterLite file system.

## Install

```bash
pip install jupyternaut-terminal
```

This also installs `jupyterlite-terminal`. Enable terminals in your JupyterLite
deployment by adding a `jupyter-lite.json` file:

```json
{
  "jupyter-lite-schema-version": 0,
  "jupyter-config-data": {
    "terminalsAvailable": true
  }
}
```

Then build the site with `jupyter lite build`.

## Usage

1. Configure a provider, model and API key in the AI settings panel.
2. Open a terminal from the launcher.
3. Type `jupyternaut` (or `ai`) and press enter.

The agent uses the same providers, tools, skills and MCP servers as the chat.
On top of them it has terminal tools:

| Tool         | Description                                                                |
| ------------ | -------------------------------------------------------------------------- |
| `shell`      | Run a command in a headless `cockle` shell (`ls`, `grep`, `sed`, `git`...) |
| `list_files` | List a directory                                                           |
| `read_file`  | Read a file with line numbers                                              |
| `write_file` | Create or overwrite a file                                                 |
| `edit_file`  | Replace an exact string in a file                                          |

Commands that change files or run shell commands ask for confirmation first.
Choose "don't ask again" to allow a tool for the rest of the session.

### Slash commands and shortcuts

| Input           | Effect                                |
| --------------- | ------------------------------------- |
| `/help`         | Show the commands and shortcuts       |
| `/model`        | Switch the provider and model         |
| `/tools`        | List the tools available to the agent |
| `/clear`        | Clear the conversation                |
| `/settings`     | Open the AI settings panel            |
| `/exit`         | Leave the agent                       |
| `esc`           | Interrupt the current response        |
| `ctrl+c`        | Clear the prompt, press twice to exit |
| `pgup` / `pgdn` | Scroll the transcript                 |
| `\` + enter     | Insert a newline in the prompt        |

The conversation is kept while the terminal stays open, so running
`jupyternaut` again continues where you left off.

## Full screen and inline modes

By default the agent runs in full screen mode: it uses the alternate screen
buffer, like `vim`, and the transcript scrolls above a prompt that stays at the
bottom. Scroll with the mouse wheel, `pgup` and `pgdn`; `end` follows the
output again. The transcript leaves the screen when the agent exits, and
selecting text needs Option+drag on macOS or Shift+drag elsewhere because the
mouse wheel is tracked.

The inline mode prints the transcript in the terminal scrollback instead, so it
stays visible after the agent exits, but the prompt box scrolls with it.
Disable "Full screen mode" in the settings editor under "Jupyternaut Terminal",
or for one run:

```bash
jupyternaut --inline
```

Use `--fullscreen` to force the full screen mode for one run.

## Agent engines

The command can run the conversation with two agent runtimes:

| Engine   | Description                                                                                           |
| -------- | ----------------------------------------------------------------------------------------------------- |
| `ai-sdk` | The Jupyternaut agent of `@jupyternaut/agent`, built on the Vercel AI SDK (default)                   |
| `pi`     | The agent loop of [pi](https://pi.dev) (`@earendil-works/pi-agent-core`), driven with the same models |

Both engines use the providers, API keys, tools and skills configured in the
AI settings: the `pi` engine plugs the AI SDK model of the active provider into
the pi loop, so no pi provider configuration is needed. Select the engine in
the settings editor under "Jupyternaut Terminal", or for one run:

```bash
jupyternaut --engine pi
```

Changing the engine starts a new conversation in that terminal. The banner
shows the active engine.

## Terminal UI

The command can also draw its interface with two renderers:

| UI        | Description                                                                           |
| --------- | ------------------------------------------------------------------------------------- |
| `builtin` | The renderer of this extension, inline or full screen (default)                       |
| `pi`      | The [pi](https://pi.dev) TUI components (`@earendil-works/pi-tui`) on the main screen |

Both work with either engine. The pi UI keeps the transcript in the terminal
scrollback and uses the pi editor, markdown renderer and select lists. Select
it in the settings editor under "Jupyternaut Terminal", or for one run:

```bash
jupyternaut --ui pi
```

## Limitations

- The `cockle` shell has no Python or Node: use the notebook and kernel
  commands (`execute_command`) for code execution.
- Running commands cannot be interrupted; they time out after 30 seconds.
