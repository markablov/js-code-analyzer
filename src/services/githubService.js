const { Octokit } = require('@octokit/rest');

const client = new Octokit({ auth: process.env.GITHUB_PERSONAL_ACCESS_TOKEN });

/*
 * Method to list all repositories for organization
 */
const listOrgRepos = ({ organization }) => (
  client.paginate(client.repos.listForOrg.endpoint.merge({ org: organization }))
);

module.exports = {
  listOrgRepos,
};
