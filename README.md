# CHT Product Template Repository

This is a template repository for CHT Products. You can generate a new repository with the same directory structure and files as in this repository.

## Create a repository from this template

When [creating a new repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository) under the Medic organization, select `cht-repo-template` as a template to use for the new repository.

You can also create a repository directly from the template by following the steps [here](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-repository-from-a-template).

_Note_: You can read more about CHT Product repositories [in the CHT documentation](https://docs.communityhealthtoolkit.org/contribute/code/repository-checklist). 

## Existing default configurations

- The `main` branch is locked via [branch protection rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/managing-a-branch-protection-rule).
- Merges are done through PRs.
- Automatically delete head branches.
- Issue templates exist.
- PR template exists.
- PRs reference related issues.
- Commit formats follow the [guidelines](https://docs.communityhealthtoolkit.org/contribute/code/workflow/#commits). More info about linting Git commit messages with Husky [here](https://remarkablemark.org/blog/2019/05/29/git-husky-commitlint/).
- The following files exist:
    - `LICENSE` specifying AGPL-3.0 ([example](https://github.com/medic/cht-core/blob/master/LICENSE))
    - `README.md`
- The PR template contains a code review checklist.
- A reviewer for a PR merge is enforced by policy.
- A linter is set up. [Here](https://github.com/medic/eslint-config)'s more info on how to use the `eslint` configurations.

The PR and issue template content can be adjusted according to the product's purpose.

Additionally, the person who creates the repository might need to share repository access with appropriate teams (this may require admin access).

## Items to consider when developing the CHT Product

To ensure quality, the CHT Products should also follow the guidelines below:

### CI/CD

- Repository runs GitHub Actions CI with automated build and test on each PR.

### Testing

- Unit tests and successful builds for PR merges are set up.
- Unit tests cover the majority of the code.
- If applicable, integration tests run to test the solution e2e.

### Observability

- Application faults and errors are logged.
- Logging configuration can be modified without code changes (eg: verbose mode).
