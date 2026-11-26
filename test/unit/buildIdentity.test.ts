import { describe, expect, it, vi } from 'vitest';
import { normalizeBuildCommit, parseGitHubRepo, resolveBuildKind, resolveBuildRepo, resolveDevBuildKindOverride } from '../../dev/build/buildIdentity.mjs';

// test/unit/buildIdentity.test.ts

const noOrigin = () => {
    throw new Error('not a git repository');
};

describe('parseGitHubRepo', () => {
    it('parses ssh and https GitHub remotes', () => {
        expect(parseGitHubRepo('git@github.com:chthollyphile/folia-major.git\n')).toBe('chthollyphile/folia-major');
        expect(parseGitHubRepo('https://github.com/someone/folia-fork')).toBe('someone/folia-fork');
        expect(parseGitHubRepo('https://github.com/someone/folia-fork.git/')).toBe('someone/folia-fork');
    });

    it('rejects non-GitHub or malformed remotes', () => {
        expect(parseGitHubRepo('https://gitlab.com/someone/folia')).toBeNull();
        expect(parseGitHubRepo('https://evilgithub.com/someone/folia')).toBeNull();
        expect(parseGitHubRepo('')).toBeNull();
        expect(parseGitHubRepo(undefined)).toBeNull();
    });
});

describe('resolveBuildRepo', () => {
    it('follows FOLIA_BUILD_REPO > GITHUB_REPOSITORY > Vercel > git origin', () => {
        const origin = () => 'git@github.com:local/clone.git';
        const vercel = { VERCEL_GIT_REPO_OWNER: 'vercel-owner', VERCEL_GIT_REPO_SLUG: 'vercel-repo' };

        expect(resolveBuildRepo({ FOLIA_BUILD_REPO: 'manual/override', GITHUB_REPOSITORY: 'gh/repo', ...vercel }, origin)).toBe('manual/override');
        expect(resolveBuildRepo({ GITHUB_REPOSITORY: 'gh/repo', ...vercel }, origin)).toBe('gh/repo');
        expect(resolveBuildRepo(vercel, origin)).toBe('vercel-owner/vercel-repo');
        expect(resolveBuildRepo({}, origin)).toBe('local/clone');
    });

    it('does not read git origin when an environment variable is set', () => {
        const origin = vi.fn(() => 'git@github.com:local/clone.git');
        resolveBuildRepo({ GITHUB_REPOSITORY: 'gh/repo' }, origin);
        expect(origin).not.toHaveBeenCalled();
    });

    it('skips values that would break the UA and falls back to unknown', () => {
        expect(resolveBuildRepo({ FOLIA_BUILD_REPO: 'bad value (x)', GITHUB_REPOSITORY: 'gh/repo' }, noOrigin)).toBe('gh/repo');
        expect(resolveBuildRepo({ VERCEL_GIT_REPO_OWNER: 'only-owner' }, noOrigin)).toBe('unknown');
        expect(resolveBuildRepo({}, noOrigin)).toBe('unknown');
    });
});

describe('normalizeBuildCommit', () => {
    it('keeps hex hashes and replaces anything else with dev', () => {
        expect(normalizeBuildCommit('537FA57')).toBe('537fa57');
        expect(normalizeBuildCommit('unknown, probably dev version')).toBe('dev');
        expect(normalizeBuildCommit('')).toBe('dev');
        expect(normalizeBuildCommit(undefined)).toBe('dev');
    });
});

describe('resolveBuildKind', () => {
    const upstreamCi = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'chthollyphile/folia-major' };

    it('only treats GitHub Actions runs of the upstream repository as official', () => {
        expect(resolveBuildKind(upstreamCi)).toEqual({ kind: 'official', host: null });
    });

    it('treats the documented deployments as self-hosted, including official Docker images', () => {
        expect(resolveBuildKind({ ...upstreamCi, APP_RELEASE_CHANNEL: 'docker' })).toEqual({ kind: 'self-hosted', host: 'docker' });
        expect(resolveBuildKind({ APP_RELEASE_CHANNEL: 'docker' })).toEqual({ kind: 'self-hosted', host: 'docker' });
        expect(resolveBuildKind({ VERCEL: '1', VERCEL_GIT_REPO_OWNER: 'someone', VERCEL_GIT_REPO_SLUG: 'folia-major' })).toEqual({ kind: 'self-hosted', host: 'vercel' });
        expect(resolveBuildKind({ CF_PAGES: '1' })).toEqual({ kind: 'self-hosted', host: 'cloudflare' });
        expect(resolveBuildKind({ WORKERS_CI: '1' })).toEqual({ kind: 'self-hosted', host: 'cloudflare' });
    });

    it('marks fork CI and local builds as unofficial', () => {
        expect(resolveBuildKind({ GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'someone/folia-major' }).kind).toBe('unofficial');
        expect(resolveBuildKind({ GITHUB_REPOSITORY: 'chthollyphile/folia-major' }).kind).toBe('unofficial');
        expect(resolveBuildKind({ FOLIA_BUILD_REPO: 'chthollyphile/folia-major' }).kind).toBe('unofficial');
        expect(resolveBuildKind({}).kind).toBe('unofficial');
    });
});

describe('resolveDevBuildKindOverride', () => {
    it('pins the dev server to the requested kind', () => {
        expect(resolveDevBuildKindOverride('serve', { FOLIA_DEV_BUILD_KIND: 'official' })).toEqual({ kind: 'official', host: null });
        expect(resolveDevBuildKindOverride('serve', { FOLIA_DEV_BUILD_KIND: ' Unofficial ' })).toEqual({ kind: 'unofficial', host: null });
        expect(resolveDevBuildKindOverride('serve', { FOLIA_DEV_BUILD_KIND: 'self-hosted' })).toEqual({ kind: 'self-hosted', host: null });
    });

    it('never applies to builds, and ignores unknown or missing values', () => {
        // 打包产物的类别只由 resolveBuildKind 决定：这个变量冒充不了官方构建。
        expect(resolveDevBuildKindOverride('build', { FOLIA_DEV_BUILD_KIND: 'official' })).toBeNull();
        expect(resolveDevBuildKindOverride('serve', { FOLIA_DEV_BUILD_KIND: 'trusted' })).toBeNull();
        expect(resolveDevBuildKindOverride('serve', {})).toBeNull();
    });
});
