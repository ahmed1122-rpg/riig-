#!/bin/sh
set -eu

value=${TRUSTED_PROXY_CIDR:-}
fail() {
  echo "TRUSTED_PROXY_CIDR must be one bounded IPv4 or IPv6 CIDR." >&2
  exit 1
}

[ -n "$value" ] || fail
case "$value" in
  *[!0-9A-Fa-f:./]*) fail ;;
esac

address=${value%/*}
prefix=${value#*/}
[ "$address" != "$value" ] || fail
[ -n "$address" ] && [ -n "$prefix" ] || fail
case "$prefix" in
  0|[1-9]|[1-9][0-9]|[1-9][0-9][0-9]) ;;
  *) fail ;;
esac

case "$address" in
  *:*)
    [ "$prefix" -le 128 ] || fail
    [ "$value" != "::/0" ] || fail
    ;;
  *)
    [ "$prefix" -le 32 ] || fail
    old_ifs=$IFS
    IFS=.
    set -- $address
    IFS=$old_ifs
    [ "$#" -eq 4 ] || fail
    for octet in "$@"; do
      case "$octet" in
        0|[1-9]|[1-9][0-9]|[1-9][0-9][0-9]) ;;
        *) fail ;;
      esac
      [ "$octet" -le 255 ] || fail
    done
    [ "$value" != "0.0.0.0/0" ] || fail
    ;;
esac
