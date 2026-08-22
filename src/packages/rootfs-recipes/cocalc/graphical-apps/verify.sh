set -euo pipefail

packages=(
  adwaita-icon-theme
  dbus-daemon
  libegl1
  libxcb-cursor0
  mesa-vulkan-drivers
  shared-mime-info
  xwayland
)

for package in "${packages[@]}"; do
  dpkg-query -W -f='${Status}' "$package" | grep -q "install ok installed"
done

command -v Xwayland >/dev/null
command -v dbus-daemon >/dev/null
ldconfig -p | grep -q 'libEGL\.so\.1'
ldconfig -p | grep -q 'libxcb-cursor\.so\.0'
compgen -G '/usr/share/vulkan/icd.d/*lvp*.json' >/dev/null
