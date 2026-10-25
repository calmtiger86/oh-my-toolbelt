# Architecture

A one-page map for people who want to change Oh My Toolbelt. It assumes you have read the user-facing [README](../README.md).

## What a mod is

Oh My Toolbelt is a Claude Code **mod**: a hooks module (`hooks/hooks.json` names `hooks/register.tsx`) that the engine loads as TypeScript with JSX, with no build step. The module registers hooks with `on(event, matcher, hook)`; every hook gets `$` (the engine), the event `e` and `next` (the rest of the chain). Drawings are trees of the engine's elements (`Box`, `Text`, `Button`, …), resolved per surface with `$.ui.resolve(e)`, so one tree serves the terminal and the desktop app. The engine's own type file (written into `.claude-plugin/types/` when it loads the mod) is the reference for every event and call.

## The flow

```
events (session.start, ui.render, prompt.submit, session.append, turns, ticks)
   │
   ▼
hooks/register.tsx ── reads/writes ──▶ $.state  (values a drawing reads)
   │                                     │
   │ presses → effects (hooks/lib/effects.ts)      ▼ mirrored for later sessions
   └──────── runEffect: the one place an effect   $.store (plain JSON on this computer)
             becomes a call on $
```

1. **State drives drawing.** Most values a drawing shows live in `$.state` (declared in `types/index.d.ts`). A render hook reads it, which subscribes the drawing; a write redraws exactly the readers. The rest is module state: the options, the command list and the versions are redrawn with `$.ui.invalidate`, and the prompts table by bumping the `tocMoved` atom the Prompts tab reads. Render hooks never write.
2. **Tools are data.** `hooks/tools/registry.ts` lists the tools: a label for each size, a priority, whether it shows, and what a press does, returned as a list of **effects** (`prompt.fill`, `command.run`, `ui.open`, `state.update`, …). `runEffect` in `register.tsx` turns effects into engine calls, so tools stay pure and testable.
3. **The band (the toolbelt row) fits itself.** `hooks/band.tsx` builds a model from the layout and `hooks/lib/fit.ts` decides, by display cells (`hooks/lib/width.ts`), which items fit at their long or short size and which move into `…`.

## Modules

| Where | What |
|---|---|
| `hooks/register.tsx` | Most hooks (`row-hooks.ts` and `toc-hooks.ts` register the rest), most `$.state` atoms, timers, effects, the band's and the panel's render hooks |
| `hooks/band.tsx`, `pane.tsx`, `guide.tsx`, `toc-tab.tsx`, `card.tsx`, `chip.tsx`, `picker.tsx`, `curtain.tsx` | Pure drawing: they take a model and the element table, and call nothing |
| `hooks/fold.ts`, `clips.ts`, `row-hooks.ts`, `settings.ts`, `own-settings.ts` | Features with their own state, kept out of `register.tsx` |
| `hooks/config-write.ts` | The one place the mod writes `/config`: a call per row it may change (its own rows and the theme), each key written out |
| `hooks/toc-live.ts`, `toc-history.ts`, `toc-hooks.ts` | The Prompts tab: rows as they are drawn (and the send button's as they are appended), the transcript file, turns |
| `hooks/export-run.ts`, `notes-run.ts` | Export and the notes, each with its own `$.state` atom (the export format, the notes); both take `register.tsx`'s store calls as a `StoreIo` (`runtime.ts`), which notes a failure |
| `hooks/attach-run.ts`, `pdf-run.ts` | The file picker, PDF printing |
| `hooks/tools/` | The tools and their pure logic (clock, weather and its cities, pomodoro, notes, buttons, prompts table, transcript parsing, voice, theme, commands) |
| `hooks/lib/` | Shared pure helpers: effects, fitting, cell widths, i18n, icons, store schema, formatting, Markdown and HTML export, platform paths |
| `hooks/locales/` | `en`, `ko`, `ja`: every word the user sees |
| `types/index.d.ts` | The state contract the engine holds `$.state` to |
| `tests/` | `claude plugin test` suites; UI tests mount each component on both surfaces |

## Rules the engine holds a mod to

`claude plugin validate` checks most of these; the rest are conventions that keep the mod working.

- An atom (`atom({ plugin, key })`) is declared in the file that reads and writes it; other files get a function.
- `$` crosses files only as an argument of a top-level `function`.
- `register.tsx` stays under validate's 800-line cap, which is why feature modules carry their own state.
- Every hook at a gating site has a `.catch` that answers in its place.
- Widths are display cells, never string length; wide and emoji characters count two.
- Keys are letters, never digits; a press reads state at press time, never what a drawing captured.
- Programs run with an argument list and no shell. The network (weather) and the PDF browser are off until the user turns them on; Attach starts the file picker only when pressed; while the Prompts tab is on, `tail` (PowerShell on Windows) runs by itself to read a transcript file over 4 MiB. macOS's picker and Windows PowerShell run by their full paths (`/usr/bin/osascript`, `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`), never by a name the search path could point elsewhere; `tail` runs as `/usr/bin/tail` where that file is there, and by its name only where it is not. [PRIVACY.md](../PRIVACY.md) lists each of them.
- A `ponytail:` comment marks a deliberate simplification: it names the limit and the way to lift it.
- In a file that declares hooks, a function written inside another one passes `$` only to a top-level `function` of the same file, and a call that passes `$` carries no type argument. `/config` is written only from `hooks/config-write.ts`, each key written out. The plugin directory's check reads the source as written; validate does not check these.

## The store

`$.store` keeps, per computer: `schemaVersion`, `buttons`, `layout`, `icons`, `notes`, `pomodoro`, `weatherCache`, `exportLast`, `bandHidden`, `bandFolded`, `settingsOverride.<field>` (desktop changes waiting for `/config`) and `transcript:<session id>` (the newest 20). `hooks/lib/schema.ts` reads it with a version: a store written by a newer version is read but never written. Every write reads again first, as all sessions share the store.

## Surfaces

The terminal and the desktop app draw the same trees with their own looks. The desktop app runs an SDK session: no `$.process`, no transcript scrolling, no plugin rows in `$.config.list()`; the code checks `$.session.surfaces()` and keeps desktop-only paths small (`own-settings.ts`, the opened prompt row).

## Checks and release

```sh
claude plugin validate .
claude plugin test .
npx -p typescript@5 tsc -p .
```

CI (`.github/workflows/`) runs validate and the tests on macOS, Linux and Windows, with Claude Code 2.1.309 and the newest. Its actions are pinned to a commit, with the tag in a comment, so a moved tag runs no other code. To release, raise `version` in `.claude-plugin/plugin.json`, add a section to `CHANGELOG.md`, and push: installs update by version.
