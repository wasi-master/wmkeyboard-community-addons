#!/usr/bin/env bash
# Git plumbing for the bot's writes, so no workflow step builds a git command
# out of an expression. Arguments are paths and issue numbers the caller has
# already checked; the token comes from GITHUB_TOKEN.
#
#   branch.sh checkout <dir> <branch>            clone <branch>, or start it empty
#   branch.sh commit <dir> <branch> <subdir> <message>
#       commit <subdir> and push; when the push loses a race, refetch the
#       branch and re-apply <subdir> on top (each issue owns its own folder,
#       so this never merges anyone else's work)
set -euo pipefail

remote="https://x-access-token:${GITHUB_TOKEN:?}@github.com/${GITHUB_REPOSITORY:?}.git"

identity() {
	git -C "$1" config user.name "github-actions[bot]"
	git -C "$1" config user.email "41898282+github-actions[bot]@users.noreply.github.com"
}

case "${1:-}" in
checkout)
	dir=$2 branch=$3
	if git ls-remote --exit-code --heads "$remote" "$branch" >/dev/null 2>&1; then
		git clone --quiet --depth 1 --branch "$branch" --single-branch "$remote" "$dir"
	else
		git init --quiet -b "$branch" "$dir"
		git -C "$dir" remote add origin "$remote"
		cat >"$dir/README.md" <<-'EOF'
			# pending

			Submissions waiting for review, one folder per issue: `pending/<issue>/`.
			Written by the bot in `submission.yml`, emptied by `/approve` and `/reject`.
			Each folder has its own `wmkeyboard-repo.json`, which the try links in the
			issue point at. Nothing here is published.
		EOF
	fi
	identity "$dir"
	;;
commit)
	dir=$2 branch=$3 sub=$4 message=$5
	saved=$(mktemp -d)
	if [ -e "$dir/$sub" ]; then cp -R "$dir/$sub" "$saved/content"; fi
	for attempt in 1 2 3 4 5; do
		git -C "$dir" add -A -- "$sub" README.md 2>/dev/null || git -C "$dir" add -A -- "$sub"
		if git -C "$dir" diff --cached --quiet; then
			echo "nothing to commit in $sub"
			exit 0
		fi
		git -C "$dir" commit --quiet -m "$message"
		if git -C "$dir" push --quiet origin "HEAD:refs/heads/$branch"; then
			exit 0
		fi
		echo "push lost a race (attempt $attempt), re-applying $sub on the new tip"
		sleep $((attempt * 3))
		git -C "$dir" fetch --quiet --depth 1 origin "$branch"
		git -C "$dir" reset --quiet --hard FETCH_HEAD
		rm -rf "${dir:?}/$sub"
		if [ -e "$saved/content" ]; then
			mkdir -p "$(dirname "$dir/$sub")"
			cp -R "$saved/content" "$dir/$sub"
		fi
	done
	echo "could not push to $branch" >&2
	exit 1
	;;
*)
	echo "usage: branch.sh checkout <dir> <branch> | commit <dir> <branch> <subdir> <message>" >&2
	exit 2
	;;
esac
