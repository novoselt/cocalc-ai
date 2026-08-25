# cocalc blob image router

This is the source for the Cloudflare Worker that serves public immutable CoCalc
image blobs from a private R2 bucket.

Attach the Worker to the canonical blob host and bind the private R2 bucket as
`BLOBS`. The canonical request path is:

```text
https://<blob-host>/<uuid>
```

The Worker also accepts the legacy compatibility shape
`/blobs/<display-name>?uuid=<uuid>` if the route is ever attached directly to a
site origin.

Run focused tests with:

```sh
node --test src/scripts/cloudflare/cocalc-blob-image-router/worker.test.mjs
```
