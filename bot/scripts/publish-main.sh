#!/usr/bin/env bash
# The /approve write to main: run `approve.ts publish`, commit what it wrote
# and push. When the push loses a race to another approval, reset to the new
# tip and publish again from scratch, so the manifest and README are
# regenerated with both addons and the id is checked against today's main.
#
# Run from the repository root, with main checked out. Reads GITHUB_TOKEN,
# GITHUB_REPOSITORY, GITHUB_OUTPUT, BRANCH, ISSUE_NUMBER and PENDING_DIR
# (the last for approve.ts); nothing here comes from the issue's text.
set -euo pipefail

remote="https://x-access-token:${GITHUB_TOKEN:?}@github.com/${GITHUB_REPOSITORY:?}.git"
branch=${BRANCH:?}
issue=${ISSUE_NUMBER:?}
case "$issue" in '' | *[!0-9]*) echo "bad issue number" >&2; exit 2 ;; esac

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

attempts=8
for attempt in $(seq 1 "$attempts"); do
	out=$(mktemp)
	(cd bot && GITHUB_OUTPUT="$out" npx tsx src/cli/approve.ts publish)
	dir=$(sed -n 's/^dir=//p' "$out" | tail -n 1)
	id=$(sed -n 's/^id=//p' "$out" | tail -n 1)
	version=$(sed -n 's/^version=//p' "$out" | tail -n 1)
	if [ -z "$dir" ] || [ -z "$id" ] || [ -z "$version" ]; then
		echo "approve.ts publish gave no dir, id or version" >&2
		exit 1
	fi

	git add -- "$dir" wmkeyboard-repo.json README.md
	git commit --quiet -m "Publish $id $version" -m "Closes #$issue"
	if git push --quiet "$remote" "HEAD:refs/heads/$branch"; then
		cat "$out" >>"${GITHUB_OUTPUT:?}"
		exit 0
	fi

	echo "push lost a race (attempt $attempt of $attempts); publishing again on the new tip"
	# A spread-out wait, so approvals that collided don't collide again.
	sleep $((attempt * 2 + RANDOM % 5))
	git fetch --quiet --depth 1 "$remote" "$branch"
	git reset --quiet --hard FETCH_HEAD
	git clean -fdq -- addons
done

echo "could not push to $branch after $attempts attempts" >&2
exit 1
