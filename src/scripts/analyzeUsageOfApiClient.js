/* eslint-disable no-console */

require('dotenv-defaults/config');

const fs = require('fs');
const path = require('path');
const unzipper = require('unzipper');
const babelParser = require('@babel/parser');

const { listOrgRepos, getFileContent, downloadArchive } = require('../services/githubService.js');
const { runInParallel } = require('../workers/promisePool.js');
const { findAllUsageForModuleMethods } = require('../workers/ASTWorker.js');

const ORGANIZATION = 'motorway';
const TASKS_CONCURRENCY = 5;
const ZIP_EXTRACT_CONCURRENCY = 5;

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
 * Remove top directory from archive
 */
const excludeRootDirectoryFromZip = (archive) => {
  const rootDir = archive.files.reduce(
    (shortest, { path: zipPath }) => (shortest && (shortest.length < zipPath.length) ? shortest : zipPath),
    null,
  );

  archive.files.forEach((file) => {
    file.path = file.path.replace(rootDir, '');
  });
};

/*
 * Download whole repository
 */
const downloadAndUnzip = async (repo) => {
  const repoDir = path.join(temporaryFolder, repo);
  if (fs.existsSync(repoDir)) {
    return repoDir;
  }
  fs.mkdirSync(repoDir);

  const { data: arrayBuffer } = await downloadArchive({ organization: ORGANIZATION, repo });
  const data = new Uint8Array(arrayBuffer);
  const archive = await unzipper.Open.buffer(data);
  excludeRootDirectoryFromZip(archive);
  await archive.extract({ path: repoDir, concurrency: ZIP_EXTRACT_CONCURRENCY });

  return repoDir;
};

/*
 * Get list of all JS files from directory
 */
const listAllNonTestJSFiles = (directory) => {
  const jsFiles = [];

  for (const fileName of fs.readdirSync(directory)) {
    const filePath = path.join(directory, fileName);
    if (fs.statSync(filePath).isDirectory()) {
      jsFiles.push(...listAllNonTestJSFiles(filePath));
    } else if (fileName.endsWith('.js') && !fileName.endsWith('.test.js')) {
      jsFiles.push(filePath);
    }
  }

  return jsFiles;
};

/*
 * Analyze single file
 */
const analyzeJSFile = (fileName, stats) => {
  const sourceCode = fs.readFileSync(fileName, 'utf8');
  const ast = babelParser.parse(
    sourceCode,
    {
      allowReturnOutsideFunction: true,
      sourceType: 'unambiguous',
      plugins: ['jsx', 'exportDefaultFrom'],
    },
  );

  const { calls, mentions } = findAllUsageForModuleMethods(
    ast,
    (requiredPath) => {
      const requiredPathParts = requiredPath.split('/');
      // actual clients are placed on the root of module, so path should be 'motorway-api-client/some-client'
      return requiredPathParts[0] === 'motorway-api-client' && requiredPathParts.length === 2;
    },
  );

  mentions.filter(({ type }) => type === 'unknown').forEach(({ name, position: { line, column } }) => (
    stats.warnings.push(`Couldn't recognize usage type for ${name} at ${fileName} ${line}:${column}`)
  ));

  stats.apiClientTotalCalls++;

  calls.filter(({ args }) => args.length > 1).forEach(({ method, position: { line, column } }) => (
    stats.warnings.push(`API client call with more than 1 argument. ${method} at ${fileName} ${line}:${column}`)
  ));
};

/*
 * Main worker for repo analysis
 */
const analyzeRepoSource = async (repo, stats) => {
  stats.reposChecked++;

  const packageJson = await getPackageJsonForRepo(repo);
  if (!packageJson) {
    return;
  }
  stats.reposHavePackageJson++;

  if (!packageJson.dependencies || !Object.keys(packageJson.dependencies).includes('motorway-api-client')) {
    return;
  }
  stats.reposUseApiClient++;

  const repoDir = await downloadAndUnzip(repo);
  const jsFiles = listAllNonTestJSFiles(repoDir);
  for (const jsFile of jsFiles) {
    try {
      analyzeJSFile(jsFile, stats);
    } catch (err) {
      err.fileName = jsFile;
      throw err;
    }
  }

  console.log(`[+] analyzed ${repo}`);
};

const main = async () => {
  const repos = await listOrgRepos({ organization: ORGANIZATION });

  if (!fs.existsSync(temporaryFolder)) {
    fs.mkdirSync(temporaryFolder);
  }

  const appList = repos
    .filter(({ private: isPrivate, archived, disabled }) => isPrivate && !archived && !disabled)
    .map(({ name }) => name);

  const stats = {
    reposTotal: repos.length,
    reposChecked: 0,
    reposHavePackageJson: 0,
    reposUseApiClient: 0,
    apiClientTotalCalls: 0,
    warnings: [],
  };

  await runInParallel(
    TASKS_CONCURRENCY,
    appList.map((appName) => ({ id: appName })),
    analyzeRepoSource,
    [stats],
  );

  console.log(stats);
};

main().catch((err) => {
  console.log(err.stack);
  const extraInfo = Object.entries(err);
  for (const [key, value] of extraInfo) {
    console.log(`  ${key} = ${JSON.stringify(value)}`);
  }
});
