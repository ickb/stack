# iCKB/template

iCKB template built on top of CCC to manage iCKB Typescript libraries boilerplate.

Use `./sync.sh` to create or update boilerplate in repositories.

Note: `./sync.sh` doesn't clean up old boilerplate files.

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
