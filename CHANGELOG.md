# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-10-24

### Added

- `thinking` plugin option: the brief's transient generation is sent with a lower reasoning effort
  (`low` by default, `inherit` to opt out) through `session.hook("generate")`, scoped to the brief
  by a marker in the prompt.
- Built-in fallback instructions and user-facing strings in English.

### Changed

- The `model` option accepts the documented `provider/model#variant` form as well as
  `provider/model/variant`.

### Fixed

- The dialog opened at medium size and uncentered: `ui.dialog.set` ran before `ui.dialog.show`,
  which resets both.

## [0.2.0] - 2026-10-24

### Changed

- The panel now opens with the same mechanics as the built-in `/btw`: `show` then `set`, key layer
  registered in `modal` mode by the component, dialog inset and colors from the host theme.
- Markdown is styled with the theme's markdown and syntax tokens (headings, emphasis, links, inline
  code) instead of a single flat color.
- `/brief` appears in the prompt footer while generating; the "Generating…" toast is gone.
- Copy feedback lives in the panel footer; `c` still copies through OSC52.

## [0.1.0] - 2026-10-24

### Added

- `/brief [focus]` slash command and palette entry that renders an executive summary of the current
  session in a dismissable dialog, plus the stateless fallback and the length-only log.
