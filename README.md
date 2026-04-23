# gre - GitHub Review Explorer

A TUI for quickly working through GitHub PR review comments.

## Install

```bash
deno install --allow-all -n gre --force https://raw.githubusercontent.com/jeff-hykin/gh-review-tui/main/gre.ts
```

Or symlink directly:
```bash
ln -sf ~/repos/gh-review-tui/gre.ts ~/Commands/gre
```

## Usage

```bash
# Run on current branch (auto-detects PR)
gre

# Demo with fake data (no GitHub connection)
deno run --allow-all ~/repos/gh-review-tui/demo_tui.ts
```

## Keybindings

### List view
| Key | Action |
|-----|--------|
| up/down | Navigate items |
| enter | Open detail view |
| r | Resolve thread |
| u | Unresolve thread |
| s | Mark solved |
| S | Mark unsolved |
| c | Copy "ask Claude" to clipboard |
| o | Open file in VS Code |
| 1-4, 0 | Set category (fix/discuss/wontfix/large/unknown) |
| R | Re-sync with GitHub |
| q | Quit |

### Detail view
| Key | Action |
|-----|--------|
| up/down | Scroll comments |
| d | Switch to draft tab |
| n | Switch to notes tab |
| e | Edit draft/notes |
| esc | Back to list |
| r | Resolve |
| s | Mark solved |
| c | Copy to clipboard |

### Edit mode
| Key | Action |
|-----|--------|
| (typing) | Edit text |
| esc | Stop editing |
