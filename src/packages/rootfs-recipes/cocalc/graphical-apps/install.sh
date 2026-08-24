set -euo pipefail

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  SUDO="sudo -n"
fi

packages=(
  adwaita-icon-theme
  dbus-daemon
  libegl1
  libxcb-cursor0
  mesa-vulkan-drivers
  pipewire
  pipewire-pulse
  shared-mime-info
  wireplumber
  xwayland
)

$SUDO apt-get update
$SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y \
  --no-install-recommends "${packages[@]}"
$SUDO apt-get clean
$SUDO rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*.deb
