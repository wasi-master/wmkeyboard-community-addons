/**
 * The few REST calls the bot makes, on `fetch` with the job's GITHUB_TOKEN.
 * No Octokit: the surface is small and every call is visible here.
 */
import { STICKY_MARKER } from './constants.ts';

export interface IssueComment {
	id: number;
	body: string;
	user: { login: string; type: string } | null;
}

export interface Issue {
	number: number;
	state: string;
	body: string | null;
	user: { login: string; id: number };
	labels: ({ name: string } | string)[];
	pull_request?: unknown;
}

/** The account GITHUB_TOKEN acts as. Comments by anyone else are never trusted as the bot's. */
export const BOT_LOGIN = 'github-actions[bot]';

export class GitHub {
	constructor(
		private readonly token: string,
		readonly repo: string,
		private readonly fetchImpl: typeof fetch = fetch,
		private readonly api = 'https://api.github.com',
	) {}

	static fromEnv(): GitHub {
		const token = process.env.GITHUB_TOKEN;
		const repo = process.env.GITHUB_REPOSITORY;
		if (!token || !repo) throw new Error('GITHUB_TOKEN and GITHUB_REPOSITORY must be set');
		return new GitHub(token, repo);
	}

	async request<T>(method: string, path: string, body?: unknown, allow404 = false): Promise<T | null> {
		const response = await this.fetchImpl(`${this.api}${path}`, {
			method,
			headers: {
				authorization: `Bearer ${this.token}`,
				accept: 'application/vnd.github+json',
				'x-github-api-version': '2022-11-28',
				...(body === undefined ? {} : { 'content-type': 'application/json' }),
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		if (allow404 && response.status === 404) return null;
		if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`);
		return response.status === 204 ? null : ((await response.json()) as T);
	}

	private path(rest: string): string {
		return `/repos/${this.repo}${rest}`;
	}

	getIssue(n: number) {
		return this.request<Issue>('GET', this.path(`/issues/${n}`)) as Promise<Issue>;
	}

	async listComments(n: number): Promise<IssueComment[]> {
		const all: IssueComment[] = [];
		for (let page = 1; page <= 30; page++) {
			const batch = (await this.request<IssueComment[]>('GET', this.path(`/issues/${n}/comments?per_page=100&page=${page}`))) ?? [];
			all.push(...batch);
			if (batch.length < 100) break;
		}
		return all;
	}

	comment(n: number, body: string) {
		return this.request<IssueComment>('POST', this.path(`/issues/${n}/comments`), { body });
	}

	editComment(id: number, body: string) {
		return this.request<IssueComment>('PATCH', this.path(`/issues/comments/${id}`), { body });
	}

	addLabels(n: number, labels: string[]) {
		return this.request('POST', this.path(`/issues/${n}/labels`), { labels });
	}

	async removeLabels(n: number, labels: string[], current: string[]) {
		for (const label of labels) {
			if (current.includes(label)) await this.request('DELETE', this.path(`/issues/${n}/labels/${encodeURIComponent(label)}`), undefined, true);
		}
	}

	close(n: number, reason: 'completed' | 'not_planned') {
		return this.request('PATCH', this.path(`/issues/${n}`), { state: 'closed', state_reason: reason });
	}

	/** `admin`, `maintain`, `write`, `triage`, `read` or `none`, from the API rather than any name list. */
	async permission(login: string): Promise<string> {
		const r = await this.request<{ permission: string; role_name?: string }>('GET', this.path(`/collaborators/${encodeURIComponent(login)}/permission`), undefined, true);
		return r?.role_name === 'maintain' ? 'maintain' : (r?.permission ?? 'none');
	}

	dispatch(workflow: string, ref: string, inputs: Record<string, string>) {
		return this.request('POST', this.path(`/actions/workflows/${workflow}/dispatches`), { ref, inputs });
	}

	/** Edits the bot's one marked comment in place, or posts it the first time. */
	async upsertSticky(n: number, body: string): Promise<void> {
		const sticky = findSticky(await this.listComments(n));
		if (sticky) await this.editComment(sticky.id, body);
		else await this.comment(n, body);
	}
}

export function findSticky(comments: IssueComment[]): IssueComment | undefined {
	return comments.find((c) => c.user?.login === BOT_LOGIN && c.body.includes(STICKY_MARKER));
}

export function labelNames(issue: Pick<Issue, 'labels'>): string[] {
	return issue.labels.map((l) => (typeof l === 'string' ? l : l.name));
}

export function canWrite(permission: string): boolean {
	return ['admin', 'maintain', 'write'].includes(permission);
}
