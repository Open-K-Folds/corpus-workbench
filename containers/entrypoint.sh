#!/bin/sh
set -eu
umask 077
case "${1:-serve-workbench}" in
  serve-workbench)
    test -f "$WB_STORE/ledger.sqlite" || { echo 'Import a complete package or run init-demo explicitly before serving.' >&2; exit 1; }
    exec corpus-workbench serve --store "$WB_STORE" --project "$WB_PROJECT" --ui /opt/workbench/ui --port "$WB_PORT" --container-network yes ;;
  init-demo)
    test ! -e "$WB_STORE/ledger.sqlite" || { echo 'Authority exists; refusing to replace it.' >&2; exit 1; }
    exec corpus-workbench import --store "$WB_STORE" --project "$WB_PROJECT" --package /opt/workbench/synthetic ;;
  health) exec corpus-workbench health --port "$WB_PORT" ;;
  *) exec corpus-workbench "$@" ;;
esac
