# Security policy

## Supported versions

Only the latest release on `main` receives fixes.

## Reporting a vulnerability

Please do not post exploit details in a public issue. Instead,
[report it privately through GitHub](https://github.com/LSUDOKO/vega-gated-video-player/security/advisories/new)
(Security → Report a vulnerability). If that form isn't available, open an issue that says only that you have a
security report, and the maintainer will arrange a private channel.

Include the affected version or commit, what an attacker can do, and steps to reproduce. You can expect a first
reply within a week.

## Scope

This package parses untrusted `.istep` JSON (always through the zod validator) and consumes landmark numbers. It
does not handle camera images, credentials or network traffic itself. Reports about validation bypasses, crashes
on malformed input, or a safety gate being loosened or skipped are all in scope.
