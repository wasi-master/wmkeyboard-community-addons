#!/usr/bin/env bash
# Puts wmpy at $WMPY_DIR/bin/wmpy for the plugin check in submission.yml.
#
#   1. WMPY_VERSION set (a repository variable, such as v0.1.0): the Linux
#      x86_64 build attached to that release of github.com/wasi-master/wmpy,
#      checked against the release's SHA256SUMS when it carries one. A
#      checksum that does not match stops here rather than falling back.
#   2. Otherwise, or when that release has no Linux x86_64 build: built from
#      WM Keyboard's own source (native/wmpy) with cargo, which GitHub's
#      Ubuntu runners have, at WMKEYBOARD_REF and then at the default branch.
#
# No token: the release and the source are public. Nothing here comes from
# the issue.
set -euo pipefail

dest=${WMPY_DIR:?WMPY_DIR must be set}
mkdir -p "$dest/bin"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

from_release() {
	local version=$1
	curl -fsSL --retry 3 "https://api.github.com/repos/wasi-master/wmpy/releases/tags/$version" -o "$work/release.json" || return 1
	local url name sums
	url=$(jq -r '[.assets[] | select(.name | test("(x86_64|amd64).*linux|linux.*(x86_64|amd64)"; "i")) | select(.name | test("sha256|\\.sig$|\\.asc$"; "i") | not)][0].browser_download_url // empty' "$work/release.json")
	[ -n "$url" ] || { echo "wmpy $version has no Linux x86_64 build"; return 1; }
	name=${url##*/}
	curl -fsSL --retry 3 "$url" -o "$work/$name"
	# The build's own .sha256, else the release's SHA256SUMS.
	sums=$(jq -r --arg n "$name.sha256" '([.assets[] | select(.name == $n)] + [.assets[] | select(.name | test("^(SHA256SUMS|sha256sums)(\\.txt)?$"))])[0].browser_download_url // empty' "$work/release.json")
	if [ -n "$sums" ]; then
		curl -fsSL --retry 3 "$sums" -o "$work/sums"
		local want got
		want=$(awk -v n="$name" '$2 == n || $2 == "*"n || NF == 1 { print $1; exit }' "$work/sums")
		got=$(sha256sum "$work/$name" | cut -d' ' -f1)
		if [ -z "$want" ] || [ "$want" != "$got" ]; then
			echo "::error::$name does not match the release's checksum" >&2
			exit 1
		fi
	fi
	case "$name" in
	*.tar.gz | *.tgz) tar -xzf "$work/$name" -C "$work" ;;
	*.tar.xz) tar -xJf "$work/$name" -C "$work" ;;
	*.zip) unzip -q "$work/$name" -d "$work" ;;
	*) mv "$work/$name" "$work/wmpy" ;;
	esac
	local bin
	bin=$(find "$work" -type f -name wmpy | head -n 1)
	[ -n "$bin" ] || { echo "no wmpy binary in $name"; return 1; }
	install -m 755 "$bin" "$dest/bin/wmpy"
}

from_source() {
	local repo=https://github.com/wasi-master/wmkeyboard
	if [ -n "${WMKEYBOARD_REF:-}" ] && cargo install --quiet --locked --root "$dest" --git "$repo" --tag "$WMKEYBOARD_REF" wmpy; then
		return 0
	fi
	cargo install --quiet --locked --root "$dest" --git "$repo" wmpy
}

if [ -n "${WMPY_VERSION:-}" ] && from_release "$WMPY_VERSION"; then
	echo "wmpy $WMPY_VERSION from its release"
else
	echo "building wmpy from WM Keyboard's source"
	from_source
fi
"$dest/bin/wmpy" --version
