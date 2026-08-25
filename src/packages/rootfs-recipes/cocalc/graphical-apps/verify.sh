set -euo pipefail

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

for package in "${packages[@]}"; do
  dpkg-query -W -f='${Status}' "$package" | grep -q "install ok installed"
done

command -v Xwayland >/dev/null
command -v dbus-daemon >/dev/null
command -v pipewire >/dev/null
command -v pipewire-pulse >/dev/null
command -v wireplumber >/dev/null
ldconfig -p | grep 'libEGL\.so\.1' >/dev/null
ldconfig -p | grep 'libpipewire-0\.3\.so\.0' >/dev/null
ldconfig -p | grep 'libxcb-cursor\.so\.0' >/dev/null
compgen -G '/usr/share/vulkan/icd.d/*lvp*.json' >/dev/null
