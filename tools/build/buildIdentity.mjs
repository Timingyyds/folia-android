// dev/build/buildIdentity.mjs
// 构建期解析「这份构建来自哪个仓库、哪个 commit」，写进请求 AMLL TTML DB 官方 API 的 UA，
// 方便上游区分官方构建和 fork（#515）。
//
// 仓库名不写死：写死的话 fork 会原样继承，流量就和官方混在一起了。
// fork 在自己的 Actions / Vercel 上构建时，环境变量自然是 fork 的仓库名。

// 只有本仓库自己的 GitHub Actions 构建出来的才算官方版本。这里必须写死：
// fork 的 Actions 里 GITHUB_REPOSITORY 是 fork 自己，本地构建根本没有 GITHUB_ACTIONS。
export const OFFICIAL_BUILD_REPO = 'chthollyphile/folia-major';

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const COMMIT_PATTERN = /^[0-9a-f]{7,40}$/i;

// 解析 GitHub 远端地址，支持 git@github.com:owner/repo.git 与 https://github.com/owner/repo(.git)
export function parseGitHubRepo(remoteUrl) {
  // 主机名前必须是开头、@ 或 /，避免 evilgithub.com 之类的域名被当成 GitHub
  const match = String(remoteUrl ?? '').trim().match(/(?:^|[@/])github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/i);
  return match && REPO_PATTERN.test(match[1]) ? match[1] : null;
}

// 按优先级取第一个合法的仓库名；都拿不到返回 'unknown'。
// readOriginUrl 只在前面的环境变量都没有时才调用（本地构建），失败视为拿不到。
export function resolveBuildRepo(env, readOriginUrl) {
  const candidates = [
    () => env.FOLIA_BUILD_REPO,
    () => env.GITHUB_REPOSITORY,
    () => (env.VERCEL_GIT_REPO_OWNER && env.VERCEL_GIT_REPO_SLUG
      ? `${env.VERCEL_GIT_REPO_OWNER}/${env.VERCEL_GIT_REPO_SLUG}`
      : undefined),
    () => parseGitHubRepo(readOriginUrl()),
  ];

  for (const candidate of candidates) {
    let value;
    try {
      value = candidate()?.trim();
    } catch {
      value = undefined;
    }
    if (value && REPO_PATTERN.test(value)) {
      return value;
    }
  }
  return 'unknown';
}

// UA 里的 commit 只接受十六进制短哈希；拿不到时 vite.config 的兜底值含空格逗号，不能直接放进 UA
export function normalizeBuildCommit(commitHash) {
  const value = String(commitHash ?? '').trim();
  return COMMIT_PATTERN.test(value) ? value.toLowerCase() : 'dev';
}

// 构建类别：
// - self-hosted：文档里给出的自部署方式——Docker 镜像（gateway.Dockerfile 设了 APP_RELEASE_CHANNEL=docker，
//   官方 CI 推的镜像也算，因为服务是用户自己托管的）、Vercel、Cloudflare（Pages / Workers Builds）；
// - official：本仓库 GitHub Actions 构建的（桌面版 release、nightly、canary）；
// - unofficial：其余一切——fork 的 CI、本地构建、他人打包。
// host 是自部署平台（docker / vercel / cloudflare），其他类别为 null。
// 环境变量能被手动伪造，这个标记防的是「别人打包后把问题反馈到本仓库」，不是防恶意冒充。
export function resolveBuildKind(env) {
  if (env.APP_RELEASE_CHANNEL?.trim().toLowerCase() === 'docker') return { kind: 'self-hosted', host: 'docker' };
  if (env.VERCEL === '1') return { kind: 'self-hosted', host: 'vercel' };
  if (env.CF_PAGES === '1' || env.WORKERS_CI === '1') return { kind: 'self-hosted', host: 'cloudflare' };
  if (env.GITHUB_ACTIONS === 'true' && String(env.GITHUB_REPOSITORY ?? '').trim() === OFFICIAL_BUILD_REPO) {
    return { kind: 'official', host: null };
  }
  return { kind: 'unofficial', host: null };
}
