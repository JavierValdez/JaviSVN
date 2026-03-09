#!/bin/bash
# bundle-svn.sh
# Copia el binario SVN de Homebrew y todas sus dependencias dylib a resources/
# para que la app sea completamente autónoma.
#
# Uso: bash scripts/bundle-svn.sh
# Requiere: svn instalado via Homebrew (brew install subversion)

set -e

if [[ "$OSTYPE" != "darwin"* ]]; then
  echo "Este script es solo para macOS. En Windows usa scripts/bundle-svn.ps1"
  exit 0
fi

# ─── Locate SVN ──────────────────────────────────────────────────────────────
SVN_SRC=""
for candidate in /opt/homebrew/bin/svn /usr/local/bin/svn; do
  if [ -e "$candidate" ]; then
    SVN_SRC="$candidate"
    break
  fi
done

if [ -z "$SVN_SRC" ]; then
  echo "ERROR: SVN no encontrado. Instala con: brew install subversion"
  exit 1
fi

echo "SVN encontrado en: $SVN_SRC"

# ─── Paths ───────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RESOURCES_DIR="$SCRIPT_DIR/../resources"
DEST_BIN="$RESOURCES_DIR/bin/svn"
DEST_LIB="$RESOURCES_DIR/lib"

mkdir -p "$(dirname "$DEST_BIN")" "$DEST_LIB"

# ─── Copy binary (follow symlinks) ───────────────────────────────────────────
echo "Copiando binario SVN..."
cp -L "$SVN_SRC" "$DEST_BIN"
chmod +x "$DEST_BIN"

# ─── Collect dylibs recursively ──────────────────────────────────────────────
echo "Recopilando dependencias dylib..."
COLLECTED_FILE=$(mktemp)
trap 'rm -f "$COLLECTED_FILE"' EXIT

collect_dylib() {
  local src="$1"

  # Skip system libraries (macOS provides these)
  case "$src" in
    /usr/lib/*|/System/*|/Library/Apple/*) return ;;
  esac

  # Only collect Homebrew libraries
  case "$src" in
    /opt/homebrew/*|/usr/local/*) ;;
    *) return ;;
  esac

  local name
  name=$(basename "$src")

  # Skip if already collected
  if grep -qxF "$name" "$COLLECTED_FILE" 2>/dev/null; then return; fi
  echo "$name" >> "$COLLECTED_FILE"

  if [ ! -f "$src" ]; then
    echo "  ⚠️  No encontrado: $src"
    return
  fi

  echo "  $name"
  cp -L "$src" "$DEST_LIB/$name" 2>/dev/null || true
  chmod 644 "$DEST_LIB/$name" 2>/dev/null || true

  # Recurse into this dylib's own dependencies
  while IFS= read -r dep; do
    collect_dylib "$dep"
  done < <(otool -L "$src" 2>/dev/null | awk 'NR>1{print $1}')
}

# Collect all dependencies of the SVN binary
while IFS= read -r dep; do
  collect_dylib "$dep"
done < <(otool -L "$SVN_SRC" 2>/dev/null | awk 'NR>1{print $1}')

# ─── Patch binary rpath ───────────────────────────────────────────────────────
echo "Parcheando rpath del binario..."
install_name_tool -add_rpath "@executable_path/../lib" "$DEST_BIN" 2>/dev/null || true

# Change each Homebrew lib reference in the binary to use @rpath
while IFS= read -r dep; do
  case "$dep" in
    /opt/homebrew/*|/usr/local/*)
      name=$(basename "$dep")
      install_name_tool -change "$dep" "@rpath/$name" "$DEST_BIN" 2>/dev/null || true
      ;;
  esac
done < <(otool -L "$SVN_SRC" 2>/dev/null | awk 'NR>1{print $1}')

# ─── Patch dylib IDs and references ──────────────────────────────────────────
echo "Parcheando referencias en dylibs..."
for lib in "$DEST_LIB"/*.dylib; do
  [ -f "$lib" ] || continue
  libname=$(basename "$lib")

  # Fix dylib's own install name
  install_name_tool -id "@rpath/$libname" "$lib" 2>/dev/null || true

  # Fix references to other Homebrew libs inside this dylib
  while IFS= read -r dep; do
    case "$dep" in
      /opt/homebrew/*|/usr/local/*)
        depname=$(basename "$dep")
        install_name_tool -change "$dep" "@rpath/$depname" "$lib" 2>/dev/null || true
        ;;
    esac
  done < <(otool -L "$lib" 2>/dev/null | awk 'NR>1{print $1}')
done

# ─── Ad-hoc code signing (required after install_name_tool invalidates signature) ──
echo "Firmando binario y dylibs (ad-hoc)..."
codesign --force --sign - "$DEST_BIN" 2>/dev/null || true
for lib in "$DEST_LIB"/*.dylib; do
  [ -f "$lib" ] || continue
  codesign --force --sign - "$lib" 2>/dev/null || true
done

# ─── Done ─────────────────────────────────────────────────────────────────────
lib_count=$(ls "$DEST_LIB" | wc -l | tr -d ' ')
svn_version=$("$DEST_BIN" --version --quiet 2>/dev/null || echo "desconocida")

echo ""
echo "SVN $svn_version embebido correctamente."
echo "  Binario : resources/bin/svn"
echo "  Librerias: $lib_count dylibs en resources/lib/"
