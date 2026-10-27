# Privacy

Oh My Toolbelt is an open-source mod for Claude Code. It runs inside Claude Code on your computer. It has no server, no account, no analytics and no telemetry, and it sends nothing about you or your work to its authors. Its only network request is the weather, off until you pick a city.

This page says everything it reads, keeps, sends and runs. It applies to version 0.1.0 and later; changes are listed in [CHANGELOG.md](CHANGELOG.md).

## What it sends over the network

Only the weather, and only after you pick a city in the `weatherPlace` setting (it is `off` until you do).

- **To:** `api.open-meteo.com` ([Open-Meteo](https://open-meteo.com/), a free weather service; see its [terms and privacy notes](https://open-meteo.com/en/terms)).
- **What:** the picked city's latitude and longitude, the temperature unit, and the fixed list of values it asks for (the current temperature and weather code, in the city's own time zone). Not the city's name, nothing you typed, no conversation, no note, no identifier. As with any web request, Open-Meteo also sees your IP address.
- **How often:** at start when the saved forecast is older than the refresh period, then every `weatherRefreshMinutes` (30 by default), and when you ask with `/toolbelt weather refresh`.

Nothing else leaves your computer through the toolbelt.

## What it reads on your computer

| What | When | Why |
|---|---|---|
| Its own settings and its `plugin.json` | Always | To know your choices and show its version |
| Claude Code's settings list, its command list and its version; this session's id and folder | At start, after `/clear`, when the panel opens, and on export; the folder also on Attach | To find the theme and its own settings, check the commands your buttons run (and whether `/voice` is there), show the versions, name and place an export, and put a picked file inside that folder in the prompt box by its path from there |
| The prompts you send, and for each turn the names of the tools it called, the paths of the files it edited and how long it took | While the Prompts tab (`tocTab`, **on by default**) is on: as you send a prompt and as Claude Code draws and records each turn | To list your prompts and show what each turn did. Kept in memory for this session only |
| This session's transcript file, at the path Claude Code gives for this session | While the Prompts tab is on: when a session starts, is resumed (`/resume`) or compacted, when the mod reloads, and when you turn the tab on | To list the prompts sent before a restart or `/resume`. Claude Code's message list for a mod has no row ids and holds only the newest 4,096 messages, so it cannot match an earlier prompt to its row on screen; the file can. Read in memory, never sent |
| This session's messages, from Claude Code | When you export, or open a prompt's answer in the desktop app | To write the export you asked for, or show that prompt's answer |
| Text you select with the mouse inside Claude Code, once a second: not your system clipboard, not other apps. It is read whether or not Claude Code's Copy on select copies it | While the Clipboard tab (`clipboardTab`, off by default) is on | To keep what you copied by dragging (the last 30 selections, in memory) |
| A few environment variables, on every system: `LANG`, `LC_ALL`, `LC_MESSAGES`, `HOME`, `USERPROFILE`, `LOCALAPPDATA`, `OS`, `ProgramFiles`, `ProgramFiles(x86)`; on Linux also `DISPLAY`, `WAYLAND_DISPLAY`; on Windows also `SystemRoot` | At start, on export and on Attach; `SystemRoot` on Attach and when a transcript file over 4 MiB is read | To pick the language, the export folder, a PDF browser and a file picker, to write a picked file under your home folder from `~`, to tell Windows apart (`OS`), and to find PowerShell in the Windows folder (`SystemRoot`) |
| Whether a few files are there: `/usr/bin/osascript`, `/usr/bin/tail`, the browsers' program files, the files you picked, the export's file names and the PDF it printed, this session's transcript file | On Attach, on export, and with the Prompts tab | To choose the file picker, `tail` and the browser, keep only files that exist, avoid writing over a file, and know the PDF was made |

What it reads is used on your computer only.

## What it keeps on your computer

In Claude Code's plugin store, as plain text, until you delete it. The store is the JSON file whose name starts with `oh-my-toolbelt_` in `~/.claude/plugins/store/`; with Claude Code closed, deleting that file removes everything below.

- your buttons, button sets, layout and icons;
- your notes (at most 500, 256 KiB in all; past that the oldest are removed);
- the pomodoro's state, shared by your sessions;
- the last weather forecast for the picked city;
- the export format you chose last, whether the toolbelt is hidden or folded;
- settings you changed in the desktop app's Status tab, until a terminal session copies them into `/config`;
- while the Prompts tab is on, the transcript file paths of your 20 most recent sessions (each is a full path on this computer: your home folder's name, often your user name, and every folder name on the way to the project folder).

The **clipboard history** is kept in memory only, never in a file. It is emptied when Claude Code closes.

While Claude Code runs, other mods you installed can read what the toolbelt keeps for the screen, as Claude Code lets any mod read another's: your notes, your buttons (and one you are editing), the clipboard history with your latest selection, and the last error.

**Exports** are written where `exportDirectory` says (your Downloads folder by default), only when you ask, under a name no file had when the export started (`-2`, `-3`, … are added as needed). An export holds your prompts, the commands you typed (a slash command with its arguments as `/command arguments`, a shell command as `! command`), Claude's answers and, for each tool call, its name and the first 80 characters of its input (a command, a path, a URL). It leaves out what Claude Code wrote itself: tool output, the output of your commands, the hidden text it puts ahead of your prompts (such as system reminders, which can carry text a hook added) and its own notices, such as task notifications. A Markdown export keeps any HTML in the conversation as it is, so open it in a viewer that does not run HTML; the HTML export escapes everything and allows no scripts. An export is a plain file anyone who has it can read.

## What it runs

Each program is started with an argument list and no shell.

**When you ask:**

- your system's file picker when you press **Attach** (`/usr/bin/osascript` on macOS; on Windows, PowerShell by its full path, `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`; `zenity` or `kdialog` on Linux);
- the browser named in `pdfBrowser` when you export a PDF, to print the page it just saved. What the browser itself does on the network is up to the browser.

**By itself:**

- while the Prompts tab is on (the default), at the same moments the transcript file is read (see the table above): if this session's transcript file is larger than 4 MiB, `tail` on macOS and Linux (`/usr/bin/tail` where that file is there, otherwise by its name), or on Windows PowerShell by the same full path (the file's path reaches it in an environment variable, not on its command line), to read that one file;
- when a pomodoro round ends with Pomodoro sound on, Claude Code plays the toolbelt's sound with `afplay` on macOS (a Linux or Windows terminal plays nothing).

## What the model sees

Only what you choose to send: a prompt button you press, or a note, clip, earlier prompt or attached file you put in the prompt box. Send buttons submit your own saved text as your prompt. The toolbelt adds nothing to your prompts or to Claude's instructions. The one-line reply of a `/toolbelt` command (for example the path an export was saved to) stays in the conversation like any command's output, where the model can read it.

## Children

Oh My Toolbelt is a developer tool and is not directed at children.

## Questions

Open an issue at <https://github.com/calmtiger86/oh-my-toolbelt/issues>.
