#!/bin/bash
# JaviSVN - Cliente SVN estilo GitHub Desktop
# Ejecutar este script para iniciar la aplicación

cd "$(dirname "$0")"

# Load optional local environment overrides (e.g. JAVISVN_SVN_BIN)
if [ -f ".env.local" ]; then
  set -a
  # shellcheck disable=SC1091
  . ".env.local"
  set +a
fi

# Ensure dependencies are installed
if [ ! -d "node_modules/electron" ]; then
  echo "Instalando dependencias npm..."
  npm install
fi

# Bundle SVN binary into the app if not already done
if [ ! -f "resources/bin/svn" ]; then
  echo "Empaquetando SVN dentro de la aplicacion (solo la primera vez)..."
  bash scripts/bundle-svn.sh
fi

# Start the app
echo "Iniciando JaviSVN..."
if [ -n "${JAVISVN_SVN_BIN:-}" ]; then
  echo "Usando cliente SVN personalizado: $JAVISVN_SVN_BIN"
fi
unset ELECTRON_RUN_AS_NODE
npm run dev
