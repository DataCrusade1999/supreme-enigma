# Cognito sign-in branding

These scripts write the files `aws_cognito_managed_login_branding.web` in `infra/modules/auth/main.tf` reads:

- `settings.js` writes the site's colours, corner radius and layout into `infra/modules/auth/branding.json`, in place.
- `assets.js` writes the header logo, form logo and page background SVGs, dark and light, into `infra/modules/auth/branding/`. Managed login has no font setting, so it outlines IBM Plex Sans and Instrument Serif to paths.

`favicon.svg` is a copy of `web/app/icon.svg` and isn't generated.

## Rebuild

```bash
cd infra/modules/auth/branding/generate
npm ci
npm run build
```

Then `terraform plan` from `infra/prod/account` and check the diff before applying. A change to any SVG replaces the branding style, and the sign-in page is down until the new one is created. Cognito's size limits for the logos are in `.claude/rules/infra.md`.

The colours are copied from `web/app/globals.css` and the loop ring from `web/content/wave-envelope.ts`. A change to either on the site is not picked up here until these scripts are edited to match.
