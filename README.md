# iCKB/template

iCKB template built on top of CCC to manage iCKB Typescript libraries boilerplate.

## Sync boilerplate

Use `./sync.sh` to create or update boilerplate across repositories.

Note: it will not clean up old boilerplate files.

## Import locally

Import locally unpublished mono-repositories (like CCC) in case of working with a PR that is not yet published in canary.

```json
{
  "scripts": {
    "preinstall": "./.devcontainer/setup-local-store.sh https://github.com/ckb-devrel/ccc.git 9d016b7c0d349f16162e9387532448c81d879f87",
  },
  "dependencies": {
    "@ckb-ccc/core": "link:.local-store/ccc/packages/core",
    "@ckb-ccc/udt": "link:.local-store/ccc/packages/udt"
  }
}
```

## Distribute locally

Useful for testing changes across multiple repos before publishing to npm registry.

```json
{
    "prepare": "tsc && pnpm distribute",
    "distribute": "D=.local-store/$(jq -r .name < package.json); mkdir -p \"$D\" && rsync -a --delete --include='package.json' --include='src/***' --include='dist/***' --exclude='*' . \"$D\""
}
```

## Dependencies

```mermaid
graph TD;
    A["@ickb/utils"] --> B["@ckb-ccc/core"];
    C["@ickb/dao"] --> A;
    C --> B;
    D["@ickb/core"] --> A;
    D --> C;
    E["@ickb/order"] --> A;
    E --> B;
    F["@ickb/sdk"] --> A;
    F --> B;
    F --> C;
    F --> D;
    F --> E;
    G["@ickb/template"] --> A;
    G --> B;
    G --> C;
    G --> D;
    G --> E;
    G --> F

    click A "https://github.com/ickb/utils" "Go to @ickb/utils"
    click B "https://github.com/ckb-devrel/ccc/tree/master/packages/core" "Go to @ckb-ccc/core"
    click C "https://github.com/ickb/dao" "Go to @ickb/dao"
    click D "https://github.com/ickb/core" "Go to @ickb/core"
    click E "https://github.com/ickb/order" "Go to @ickb/order"
    click F "https://github.com/ickb/sdk" "Go to @ickb/sdk"
    click G "https://github.com/ickb/template" "Go to @ickb/template"
```

## Epoch Semantic Versioning

This repository follows [Epoch Semantic Versioning](https://antfu.me/posts/epoch-semver). In short ESV aims to provide a more nuanced and effective way to communicate software changes, allowing for better user understanding and smoother upgrades.

## Licensing

This source code, crafted with care by [Phroi](https://phroi.com/), is freely available on [GitHub](https://github.com/ickb/template) and it is released under the [MIT License](./LICENSE).
