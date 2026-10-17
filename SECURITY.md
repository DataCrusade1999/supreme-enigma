# Security policy

## Reporting a vulnerability

Report it privately through GitHub: open the repository's **Security** tab and
click **Report a vulnerability**. Please do not open a public issue, pull
request or discussion for it.

Include what you found, where (a URL, file or endpoint), the steps to
reproduce it, and what an attacker could do with it.

## Scope

- The live sites: https://ashutosh-pandey.com, https://stage.ashutosh-pandey.com
  and https://dev.ashutosh-pandey.com, including the sign-in flow and the
  gated `/tools` and `/api/*` routes.
- The code in this repository: `web/`, `lambda/`, `infra/` and
  `.github/workflows/`.

Out of scope: findings in third-party services (Vercel, AWS, GitHub, Cognito)
that aren't caused by how this project configures them, denial-of-service and
volume testing, and social engineering.

## What to expect

This is a personal project maintained by one person. I aim to acknowledge a
report within 7 days and to keep you updated until it is fixed or closed.
Fixes ship to `main`; there are no supported older versions.
