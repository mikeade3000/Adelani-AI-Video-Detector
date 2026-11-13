# Recovery note (13 Nov 2026)

The working copy of KIU CBT was lost when the build machine was replaced. This folder was rebuilt from what is live:

- `admin.html`, `index.html`, `lecturer.html`, `observe.html`, `assets/`, `samples/`: downloaded from kiu-cbt.portals.com.ng (identical to the live files).
- `apps-script/Code.gs` and `cloudflare/src/*.js`: extracted from the deployed Worker (Cloudflare → kiu-cbt → Edit code).
  Rebuilding them with Wrangler 4.151.1 reproduces the deployed Worker byte for byte. The bundler had removed the
  comments from Code.gs, so it has none; its code is unchanged.
- `cloudflare/tools/build.mjs`, `wrangler.toml`, `package.json`: rewritten to produce exactly that build.

From now on every version is committed here.
