# Dotfiles

Personal configuration files and setup scripts.

## Structure

- `git/` — Git configuration
- `pi/` — Pi settings, extensions, and themes
- `terminal/` — Terminal.app profiles
- `zsh/` — Zsh configuration
- `script/` — setup and maintenance scripts

Files ending in `.symlink` are linked into the home directory by the bootstrap script.

## Installation

```sh
git clone https://github.com/shrivara/dotfiles.git ~/.dotfiles
cd ~/.dotfiles
script/bootstrap
```

Existing configuration files are backed up to `~/.dotfiles-backup/` before they are replaced with symlinks.
