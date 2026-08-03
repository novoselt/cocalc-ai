# CoCalc Star Docker Preview

This is a privileged Docker-based preview appliance for CoCalc Star. It is for
local evaluation and release validation, not for hardened multi-tenant
production hosting.

The Docker layer is intentionally a thin packaging wrapper. The first preview
boots the current single-hub Star runtime, but the customer-facing workflow
should not depend on that internal layout. Keep this wrapper replaceable by the
Rocket/bay-style multi-worker systemd runtime as Star moves toward the same
scalable process layout used by full Rocket deployments.

In particular, avoid making image tags, volumes, environment variables, or docs
promise "one hub process" semantics. The intended transition path is that a
customer can keep using the same Docker preview shape while the container
internals evolve from the current compact Star deployment to multiple Node.js
processes and service units.

Build the image from a CoCalc source checkout:

```sh
src/scripts/star/docker-preview/build-image.sh --tag cocalc/star:preview
```

The default build does a slow builder-container pass that precomputes the
default RootFS cache and embeds it in the final Docker image. This makes
`docker run` much faster because first boot only initializes local state,
publishes the already-cached RootFS, starts services, and prints signup URLs.

Reuse an existing RootFS cache artifact:

```sh
src/scripts/star/docker-preview/build-image.sh \
  --tag cocalc/star:preview \
  --rootfs-cache dist/star/docker-preview/cocalc-star-rootfs-cache-....tar.gz
```

Skip embedding the RootFS cache for development:

```sh
src/scripts/star/docker-preview/build-image.sh \
  --tag cocalc/star:preview \
  --skip-rootfs-cache
```

Run it on a Linux Docker host with systemd and cgroup v2:

```sh
docker run --privileged --cgroupns=host \
  --security-opt seccomp=unconfined \
  --tmpfs /run --tmpfs /run/lock \
  -v /sys/fs/cgroup:/sys/fs/cgroup:rw \
  -v cocalc-star-data:/var/lib/cocalc \
  -p 8170:80 \
  cocalc/star:preview
```

The container prints first-boot status and the admin signup URL to Docker
stdout. Open `http://localhost:8170` after the first-boot installer prints the
bootstrap URL. The persistent data volume is `/var/lib/cocalc`; it contains the
Star database, project data image, rootfs cache, secrets, and bootstrap state.

Useful commands:

```sh
docker exec -it <container> /opt/cocalc-star/source/src/scripts/star/star.sh status
docker exec -it <container> /opt/cocalc-star/source/src/scripts/star/star.sh doctor
docker exec -it <container> /opt/cocalc-star/source/src/scripts/star/star.sh smoke
docker exec -it <container> /opt/cocalc-star/source/src/scripts/star/star.sh bootstrap-link
```

Runtime environment knobs:

```sh
COCALC_STAR_HOSTNAME=localhost
COCALC_STAR_HTTP_PORT=8170
COCALC_STAR_ACCESS_URL=http://localhost:8170
COCALC_STAR_DOCKER_ALLOW_DEGRADED=1
COCALC_STAR_BTRFS_SIZE=40G
COCALC_STAR_BUILD_DEFAULT_ROOTFS=1
COCALC_STAR_DEFAULT_ROOTFS_BASE_IMAGE=docker.io/buildpack-deps:26.04
```

Stop and restart with the same volume to preserve state:

```sh
docker stop <container>
docker run ... -v cocalc-star-data:/var/lib/cocalc cocalc/star:preview
```

Remove all preview data only after exporting anything you need:

```sh
docker volume rm cocalc-star-data
```

## Native multi-architecture Docker Hub releases

Published Star images are built natively. This avoids QEMU during the expensive
Star and RootFS builds and guarantees that each image contains the matching
Linux project-tools bundle.

The release workflow uses three immutable tags:

```text
sagemathinc/star:<release-id>-amd64
sagemathinc/star:<release-id>-arm64
sagemathinc/star:<release-id>
```

The first two are ordinary native images. The third is an OCI image index that
selects the correct native image for `linux/amd64` or `linux/arm64`.

Log in to Docker Hub on each build machine:

```sh
docker login
```

On the x86_64 Linux builder, build and push the x86 child from the matching
runtime release artifact:

```sh
RELEASE_ID=20260729T191811Z-fe6287a6bc3a
src/scripts/star/docker-preview/multiarch.sh build \
  --release-artifact \
    "dist/star/github-${RELEASE_ID}/cocalc-star-runtime-linux-x64.tar.gz" \
  --push
```

On an Apple Silicon Mac, first check out the same Git revision and build the
arm64 runtime artifact with the same release ID:

```sh
RELEASE_ID=20260729T191811Z-fe6287a6bc3a
git checkout fe6287a6bc3a
COCALC_STAR_RELEASE_ARCH=arm64 STAR_RELEASE_ID="$RELEASE_ID" \
  src/scripts/star/build-github-release-assets.sh \
  "dist/star/github-${RELEASE_ID}-arm64"
```

Then run the publishing script from a checkout that contains it, passing the
arm64 artifact by absolute path:

```sh
src/scripts/star/docker-preview/multiarch.sh build \
  --release-artifact \
    "/path/to/dist/star/github-${RELEASE_ID}-arm64/cocalc-star-runtime-linux-arm64.tar.gz" \
  --push
```

The publisher verifies the clean release metadata, embedded project-tools
architecture, Docker engine architecture, resulting image platform, release
label, and Git revision label before it pushes a child tag.

After both child tags exist, publish and verify the release index from either
machine:

```sh
src/scripts/star/docker-preview/multiarch.sh index \
  --release-id "$RELEASE_ID"
src/scripts/star/docker-preview/multiarch.sh inspect \
  --release-id "$RELEASE_ID"
```

Test the immutable release tag directly:

```sh
docker pull "sagemathinc/star:${RELEASE_ID}"
docker image inspect "sagemathinc/star:${RELEASE_ID}" \
  --format '{{.Os}}/{{.Architecture}}'
```

None of the commands above modifies `latest`. Only after both platforms have
been tested, promote the verified release index explicitly:

```sh
src/scripts/star/docker-preview/multiarch.sh promote \
  --release-id "$RELEASE_ID" \
  --yes
```
