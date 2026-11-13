# Deployment

A [version-changing release](../../AGENTS.md#the-gate) builds `interface/dist` again in a fresh job where none of the gate tooling runs, then deploys it. A failed check leaves the previous site live.

The domain `ickb.org` is the Pages setting of the repository. With the Actions source, GitHub ignores a `CNAME` file, so none is shipped.

`public/favicon.png` is the only static file copied to the site root. Files added under `public/` are published as they are.
