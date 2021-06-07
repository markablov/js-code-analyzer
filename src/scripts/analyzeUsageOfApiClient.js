/* eslint-disable no-console */

require('dotenv-defaults/config');

const fs = require('fs');
const path = require('path');
const unzipper = require('unzipper');
const babelParser = require('@babel/parser');

const { listOrgRepos, getFileContent, downloadArchive } = require('../services/githubService.js');
const { runInParallel } = require('../workers/promisePool.js');
const { findAllVariablesForRequiredModule } = require('../workers/ASTWorker.js');

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
const listAllJSFiles = (directory) => {
  const jsFiles = [];

  for (const fileName of fs.readdirSync(directory)) {
    const filePath = path.join(directory, fileName);
    if (fs.statSync(filePath).isDirectory()) {
      jsFiles.push(...listAllJSFiles(filePath));
    } else if (fileName.endsWith('.js')) {
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

  const { variables, requires } = findAllVariablesForRequiredModule(ast, 'motorway-api-client');
  if (!variables?.length) {
    return;
  }

  // sanity check, we want to be sure that we have recognized all requires for 'motorway-api-client'
  const apiClientStrOccurrences = sourceCode.split('motorway-api-client');
  const mocksApiClient = apiClientStrOccurrences.reduce((acc, s) => (s.endsWith('jest.mock(\'') ? acc + 1 : acc), 0);
  if (apiClientStrOccurrences.length - 1 - mocksApiClient !== requires.length) {
    throw Error('Something strange. String "motorway-api-client" appears more times than require() calls.');
  }

  requires.forEach((requirePath) => stats.apiClientsInUse.add(requirePath));
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
  const jsFiles = listAllJSFiles(repoDir);
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
    apiClientsInUse: new Set(),
  };

  await runInParallel(
    TASKS_CONCURRENCY,
    appList.map((appName) => ({ id: appName })),
    analyzeRepoSource,
    [stats],
  );
};

main().catch((err) => {
  console.log(err.stack);
  const extraInfo = Object.entries(err);
  for (const [key, value] of extraInfo) {
    console.log(`  ${key} = ${JSON.stringify(value)}`);
  }
});
