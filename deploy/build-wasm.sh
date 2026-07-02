#!/usr/bin/env bash
# build-wasm.sh — compila wasm/veninfo.nx a static/assets/veninfo.wasm y
# refresca la copia del shim (nyx-wasi-shim.js) desde el monorepo.
#
# OJO: `make wasm` sobreescribe script.nx/script.ll (archivos scratch) del
# monorepo NyxLang — no correr en paralelo con otro build del monorepo.
#
# Tras compilar: subir el ?v=N de nyx-loader.js/veninfo.wasm JUNTOS en
# src/main.nx, subir veninfo-vN en static/sw.js, y rebuild+restart del server.
set -euo pipefail
NYX=/home/admin/NyxLang
PROJ=/home/admin/venezuelainfo.org

make -C "$NYX" wasm FILE="$PROJ/wasm/veninfo.nx"
mv "$NYX/veninfo.wasm" "$PROJ/static/assets/veninfo.wasm"
cp "$NYX/examples/browser/nyx-wasi-shim.js" "$PROJ/static/assets/nyx-wasi-shim.js"

RAW=$(stat -c%s "$PROJ/static/assets/veninfo.wasm")
GZ=$(gzip -c "$PROJ/static/assets/veninfo.wasm" | wc -c)
echo "✓ veninfo.wasm: ${RAW} bytes crudo, ${GZ} gzip"
