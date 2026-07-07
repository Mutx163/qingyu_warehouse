# Security Policy

## Supported Versions

| Branch | Supported |
| ------ | --------- |
| `main` | Yes |
| Other branches | Best effort only |

## Reporting a Vulnerability

**Do not open a public issue for security vulnerabilities.**

Report privately to [@Mutx163](https://github.com/Mutx163) or via [GitHub Security Advisories](https://github.com/Mutx163/qingyu_warehouse/security/advisories/new).

Include:

1. Affected adapter or script path under `resources/`
2. Steps to reproduce
3. Impact (credential leak, arbitrary code execution in WebView import, etc.)

## Adapter Content Rules

- Never commit real usernames, passwords, cookies, tokens, or raw packet captures
- Test credentials belong in local-only files ignored by `.gitignore`
- Scripts must not exfiltrate user data to third-party endpoints

## Response Expectations

- Initial acknowledgment: within **7 days**
- Critical issues (malicious adapter code): prioritized

## Out of Scope

- Bugs in individual school adapters that only affect import UX — use normal Issues/PRs
- Problems in the main app ([mikcb](https://github.com/Mutx163/mikcb)) — report there instead
