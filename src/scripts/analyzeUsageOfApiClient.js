/* eslint-disable no-console */

require('dotenv-defaults/config');

const ORGANIZATION = 'motorway';

const { listOrgRepos } = require('../services/githubService.js');

const main = async () => {
  const repos = await listOrgRepos({ organization: ORGANIZATION });
  console.log(`[+] Found ${repos.length} repositories for organization.`);
};

main().catch((err) => console.error(err));
