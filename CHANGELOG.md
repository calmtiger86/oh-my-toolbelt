# Changelog

All notable changes to Oh My Toolbelt are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/). Installs update when `version` in `.claude-plugin/plugin.json` goes up.

## [0.1.2] - 2026-10-31

### Fixed

- **Prompts tab**: a prompt that started with pasted text was listed as `<pasted_content id="…">`, the tag Claude Code stores around a paste, so different prompts showed the same line. It is now listed, and shown on its card over the toolbelt, by its first line of text.
- **Prompts tab** (desktop app): an opened prompt that held pasted text showed those tags, and Put in the prompt box put them in the box. It now comes back as the prompt box held it.
- **Export**: pasted text was exported between those tags. It is exported as you pasted it; tags you typed yourself are kept.

## [0.1.1] - 2026-10-27

### Fixed

- **Prompts tab**: a prompt that was a slash command alone (`/co`, a skill) was missing from the list, and its turn counted toward the prompt before it. A slash command Claude answers is now listed as you typed it, whether you typed it or one of your buttons ran it; one that only acts in Claude Code (`/model`, `/login`) still is not.
- **Prompts tab**: a prompt sent while Claude was answering could be listed two or three times when the toolbelt reloaded during that answer (a settings change in any session reloads it). It is listed once.
- **Attach**: picked files went into the prompt box by their whole path, which shows your user name in a screen recording. A file inside the session's folder now goes in by its relative path and one under your home folder from `~`; Windows keeps whole paths.
- **Panel**: below 144 columns the Edit and Notes buttons left the panel closed without a word. The toolbelt let go of the press before the panel opened, so Claude Code took the open for one nobody asked for and waited for a wider window. A press now holds until the panel has opened, and it opens at any width, as with `/toolbelt`.
- **Your buttons**: a command button pressed while Claude was answering seemed to do nothing, as Claude Code runs the command only once the answer ends. A message now says it will run then, and pressing the button again while it waits no longer runs the command twice.
- **Hide conversation**: the "Most of the conversation is hidden" notice stayed for 8 seconds, so after a quick Show it was still up over the conversation that came back. It now goes after 4 seconds, as other notices do; a notice cannot be taken back sooner.
- **Clock and date**: with a language picked, the clock, the date, note times and the export's date still followed your computer's locale (English on a Korean computer showed `오전 5:32`). They now follow the language you picked, keeping your computer's regional format when it speaks that language, or when you picked English on a computer in a language the toolbelt has no words for (a German computer keeps `23.10.2026`); with `auto` they follow your computer as before. The time zone is unchanged, and the Status tab shows the date and time locale only when it differs from the language.
- **Export**: an export made while Claude was answering left out the answer being written, without a word. The message now says so, to export again once the answer ends.
- **Export**: the notice Claude Code writes when you interrupt an answer (`[Request interrupted by user]`) was exported under your name, as if you had written it. It is left out; a command you typed, such as `/reload-plugins`, is still exported as yours.
- **Prompts tab**: a turn you interrupted lost its time once the toolbelt read the list back from the session's file (after a resume or a reload), as Claude Code writes no duration for such a turn. Its time now runs from the prompt to the interruption, and the same goes for a turn an API error ended.
- **Prompts tab**: a prompt you stopped with Esc before Claude wrote anything stayed in the list as a row you could not jump to, though Claude Code had put it back in the prompt box, and after a reload it was gone and the rows after it moved up one number. It now leaves the list at once.

## [0.1.0] - 2026-10-24

The first public release. Tested by hand on macOS with Claude Code 2.1.309 and 2.1.310, in the terminal and in the desktop app's Code tab; the automatic tests also run on Linux and Windows.

### Added

- **The toolbelt**, a row above the prompt: information on the left, buttons on the right, fitted to the window by display width; what does not fit goes into `…`. `◂` folds it into a single `▸` and keeps it folded.
- **Clock and date** in 12- or 24-hour form, in your computer's time zone, UTC or that of one of 53 cities, with optional seconds and the date in your language's order.
- **Weather** for one of 63 cities from Open-Meteo, off until you pick a city.
- **Pomodoro**, shared by your sessions: focus rounds (and breaks, when Pomodoro auto break is on), a progress bar, a notification when a round ends and an optional sound on macOS (six sounds).
- **Your buttons**: saved prompts to fill or send, slash commands and skills, in sets you can switch, each with an optional icon and letter key.
- **Attach** (system file picker to `@` mentions), **Voice** (`/voice` on and off), **Light / Dark** (theme pair), **Hide** (covers the conversation) and **Export** (Markdown, HTML, plain text, and PDF in the terminal through a browser you pick).
- **The panel** with six tabs: Prompts (every prompt you sent, with jump, find, turn details and, in the desktop app, the answer in place), Notes, Clipboard (copies made by dragging, kept in memory; off by default), Status (this session, every tool, every setting), Tools (layout, buttons, sets, icons) and Guide (a step-by-step tour).
- **`/toolbelt`** (and `/tb`, when no other mod has it) commands for the panel's tabs, prompt jumps, the pomodoro, export, the curtain, the weather and hiding the toolbelt.
- **Desktop app support**: the same toolbelt and panel, settings kept by the toolbelt where Claude Code lists none and copied into `/config` from the next terminal session.
- **English, Korean and Japanese** for every word on screen, the guide and the README.
