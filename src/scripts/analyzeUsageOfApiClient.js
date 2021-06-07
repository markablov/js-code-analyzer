/* eslint-disable no-console */

require('dotenv-defaults/config');

const fs = require('fs');
const path = require('path');

const { listOrgRepos, getFileContent } = require('../services/githubService.js');
const { runInParallel } = require('../workers/promisePool.js');

const ORGANIZATION = 'motorway';
const TASKS_CONCURRENCY = 5;

const temporaryFolder = path.resolve(__dirname, 'tempFiles');

/*
 * Get content of package.json
 */
const getPackageJsonForRepo = async (repo) => {
  try {
    const { content: packageBase64 } = await getFileContent({ organization: ORGANIZATION, repo, path: 'package.json' });
    const packageString = Buffer.from(packageBase64, 'base64').toString('utf8');
    return JSON.parse(packageString);
  } catch (err) {
    return null;
  }
};

/*
 * Main worker for repo analysis
 */
const analyzeRepoSource = async (repo) => {
  const packageJson = await getPackageJsonForRepo(repo);
  if (!packageJson) {
    console.log(`[-] skipping ${repo}: no package.json`);
    return;
  }

  if (!Object.keys(packageJson.dependencies).includes('motorway-api-client')) {
    console.log(`[-] skipping ${repo}: there is no dependency on api-client`);
  }
};

const main = async () => {
  const repos = await listOrgRepos({ organization: ORGANIZATION });
  console.log(`[+] Found ${repos.length} repositories for organization.`);

  if (!fs.existsSync(temporaryFolder)) {
    fs.mkdirSync(temporaryFolder);
  }

  const appList = repos
    .filter(({ private: isPrivate, archived, disabled }) => isPrivate && !archived && !disabled)
    .map(({ name }) => name);
  console.log(`[+] ${appList.length} repositories are active.`);

  await runInParallel(
    TASKS_CONCURRENCY,
    appList.map((appName) => ({ id: appName })),
    analyzeRepoSource,
  );
};

main().catch((err) => console.error(err));
