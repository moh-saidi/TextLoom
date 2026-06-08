# TextLoom

A Chrome extension that captures text selections from any webpage into your personal library. No copy-paste, no clipboard, no accounts.

## Core Loop

1. Press `Ctrl+Shift+Q` once to arm capture
2. Read normally — select text on any page, it saves silently
3. Open the sidebar to organize, tag, export

No copy-paste. No interrupt. Your selections persist across restarts.

## Features

- **Passive capture**: text selections auto-save via `mouseup` after arming
- **Right-click capture**: select text → right-click → Capture to Folder (no arming needed)
- **Collections** (folders): color-coded groups, create/edit/delete with hover-reveal actions
- **Tags**: inline tagging system, filter by tag, add/remove from individual or multi-selected items
- **Full-text search**: search across text content and source URLs
- **Keyboard navigation**: `j`/`k` to navigate, `s` to star, `/` to search, `e` to export, `d` to delete
- **Text Fragment links**: double-click a selection to open the source page scrolled to the captured text
- **Export**: Plain Text, JSON, CSV, Markdown (individual items or filtered views)
- **Dark/light theme**: toggle persisted in `localStorage`
- **Statistics**: total selections, starred, folders, tags, unique sources
- **Onboarding**: first-run guide for new users

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Ctrl+Shift+Q` | Toggle capture on/off |
| `j` / `↓` | Next selection |
| `k` / `↑` | Previous selection |
| `s` | Star/unstar focused item |
| `/` | Focus search |
| `e` | Export |
| `d` / `Delete` | Delete selected |
| `Space` | Toggle select focused item |
| `Esc` | Clear search / close modals |

## Tech

Manifest V3 Chrome extension. No frameworks, no build step, no server, no AI.

Permissions: `storage`, `activeTab`, `contextMenus`, `sidePanel`
