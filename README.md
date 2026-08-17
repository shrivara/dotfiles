# Dotfiles

Strict, explicit configuration for this Mac.

## Setup

```sh
git clone https://github.com/shrivara/dotfiles.git ~/.dotfiles
cd ~/.dotfiles
cp dotfiles.user.example.json dotfiles.user.json
$EDITOR dotfiles.user.json
./dotfiles apply
```

`dotfiles.user.json` is required and gitignored. It selects this machine’s services and contains personal values:

```json
{
  "schemaVersion": 1,
  "services": ["zsh", "git", "gh", "ghostty", "herdr", "pi"],
  "git": {
    "name": "Your Name",
    "email": "you@example.com"
  }
}
```

`dotfiles.json` defines every available service, owned path, preserved runtime path, and tested version. Nothing is inferred from directory contents.

## Use

```sh
./dotfiles save     # selected machine configuration → repository
./dotfiles apply    # repository → selected machine services using symlinks
```

`save` updates only declared files belonging to services selected in `dotfiles.user.json`. Files already linked to the repository are already saved. Credentials, runtime data, generated files, and undeclared files are never collected.

`apply` validates selected services and exact versions, generates personal configuration, installs symlinks, prunes undeclared entries from selected owned directories, repairs integrations, and verifies the result. Disabled services are untouched; links previously installed by this manager are retired.

Before replacing, pruning, or overwriting anything, the command prints every affected path and asks for confirmation. Use `--yes` for automation or `--dry-run` to preview. Conflicting data is backed up under:

```text
${XDG_STATE_HOME:-~/.local/state}/dotfiles/backups/
```

## Ownership

| Service | Managed configuration |
|---|---|
| Zsh | `~/.zshrc` |
| Git | shared `~/.gitconfig` plus generated identity from `dotfiles.user.json` |
| GitHub CLI | `config.yml`; authentication preserved |
| Ghostty | complete config directory, Ayu icon, and Berkeley Mono |
| Herdr | config and generated Pi integration; runtime files preserved |
| Pi | settings and complete extensions, skills, themes, and prompts trees |

Pi credentials, sessions, cache, and trust state are never touched. GitHub authentication, SSH, and Clawrium credentials are outside ownership. Terminal.app is retired only when Ghostty is selected.

## Adding configuration

1. Add the real file beneath `config/<service>/`.
2. Declare its source and target in `dotfiles.json`.
3. Add the service to `dotfiles.user.json` if it should be active.
4. Run `./dotfiles apply`.

Undeclared files beneath `config/` fail validation. Undeclared files in selected owned destination directories are shown in the destructive warning, then backed up and removed after confirmation.
