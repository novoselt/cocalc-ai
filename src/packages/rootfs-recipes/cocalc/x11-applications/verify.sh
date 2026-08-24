set -euo pipefail

python_version="$(/usr/bin/python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
packages=(
  chromium
  chromium-driver
  chromium-sandbox
  emacs-gtk
  gimp
  gnumeric
  inkscape
  krita
  libreoffice-calc
  texstudio
  vim-gtk3
  x11-apps
  "idle-python${python_version}"
)

for package in "${packages[@]}"; do
  dpkg-query -W -f='${Status}' "$package" | grep -q "install ok installed"
done

for executable in \
  chromium cocalc-idle emacs gimp gnumeric gvim inkscape krita \
  libreoffice texstudio xclock; do
  command -v "$executable" >/dev/null
done

/usr/bin/python3 -c 'import idlelib, tkinter'
