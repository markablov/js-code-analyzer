const { Octokit } = require('@octokit/rest');

const client = new Octokit({ auth: process.env.GITHUB_PERSONAL_ACCESS_TOKEN });

const PAGINATED_REQUEST_URLS = new Set([
  'https://api.github.com/orgs/motorway/repos',
]);

/*
 * Checks if request is performed via .paginate() helper
 */
const isPaginationRequest = (options) => {
  if (PAGINATED_REQUEST_URLS.has(options.url)) {
    return true;
  }

  try {
    const url = new URL(options.url);
    return url.searchParams.has('page');
  } catch {
    return false;
  }
};

client.hook.wrap('request', async (request, options) => {
  const response = await request(options);
  return isPaginationRequest(options) ? response : response.data;
});

/*
 * Method to list all repositories for organization
 */
const listOrgRepos = ({ organization }) => (
  client.paginate(client.repos.listForOrg.endpoint.merge({ org: organization }))
);

/*
 * Get content of small file
 */
const getFileContent = ({ organization, repo, path }) => (
  client.repos.getContent({ owner: organization, repo, path })
);

module.exports = {
  getFileContent,
  listOrgRepos,
};
