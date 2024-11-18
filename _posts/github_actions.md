---
title: "CI / CD with GitHub Actions - deploying on Azure [app & bot service] with GitHub reusable workflows !"
excerpt: "Lets deploy Azure Bicep templates that we build using GitHub actions with few advanced concepts & features"
coverImage: "/assets/blog/github_actions/github_actions.png"
date: "2024-11-14T15:35:07.322Z"
author:
  name: Vibhor Agarwal
  picture: "/assets/blog/authors/techvibhor.png"
ogImage:
  url: "/assets/blog/github_actions/github_actions.png"

---

![](/assets/blog/github_actions/github_actions.png) 

# What are we deploying using Bicep

See here on the Bot framework based application that we had built so far & Bicep scripts to build the infrastructure

Now we deploy both infra and the application code using GitHub Actions

[All about Microsoft Bot Framework (Python), Streaming Content & Azure Deployment for GenAI powered Chatbots](microsoft_bot)

[Infrastructure as Code with Azure Bicep - deploying app service, bot service with several Azure integrations](microsoft_bicep)

## What we would achieve

Use GitHub actions (use an organizational account or even personal) to deploy Bot on Azure with several Azure service integrations.

Using best practices and advanced concepts:

 - Use Azure's OpenID credentials to connect GitHub to Azure
 - Use built bicep templates (from previous step) that accepts few parameters
 - Deploy on Azure, app service, bot service and create several other resources
 - Use deployment slots feature for both staging & prod deployments
 - Support staging and production deployments
 - Deploy on production only on manual approval
 - Ensure same code gets deployed on both environments (possible that you deploy COMMIT_A on staging, a PR is merged to main meanwhile, and your production stage deployment
   picks up COMMIT_B and ends up deploying non-tested code to production !!)
 - Ensure no duplication of workflow steps
 - Deployment should have steps to run unit tests and deployment tests (post deploy) for bot service
 - Use GitHub secrets and variables (per environment) [available on org. accounts only]
 - Allow only one deployment at a time (limit concurrency)


## Generating credentials for GitHub to connect to Azure

This is a 2-step process - generate a client ID (with credentials), configure OpenID for github actions for this client.

You would need 2 different set of credentials and configuration for your 2 different environments (subscriptions) - staging, production.
These steps are for staging environment Azure subscription id <STAGING_SUBS_ID> and for <ENVIRONMENT> as staging

### STEP 1: Generate Service Principal with RBAC access

Create a client application with scopes chosen as desired.
Here we give access to this service principal **contributor** permissions across the subscription

```bash
# need across subscription as we update resources such as Key Vault permissions on a different Resource Group
az ad sp create-for-rbac --name teams-bot --role contributor --scopes /subscriptions/<STAGING_SUBS_ID> --json-auth
```

Note down the client ID, tenant ID & subscription ID.

### STEP 2: Generate Service Principal with RBAC access

Review and replace for your org/repo/branch.

```bash
# use the client ID from above and create federation for github actions
az ad app federated-credential create \
      --id <CLIENT_ID> \
      --parameters '{
        "name": "my-fed-credential",
        "issuer": "https://token.actions.githubusercontent.com",
        "subject": "repo:<ORG>/<REPO>>:environment:staging", //..client:ref:refs/heads/<branch>
        "audiences": ["api://AzureADTokenExchange"],
        "description": "federated identity for teams bot"
}'
```
You can also login to entra.microsoft.com and configure this client for OpenID access in a nice User Interface.

Now when using federated credentials, you can configure GitHub without client password to login to Azure with these parameters:

```yaml
# Using fed identity allows to set up and use (without secret):
client-id: ${{ secrets.AZURE_CLIENT_ID }}
tenant-id: ${{ secrets.AZURE_TENANT_ID }}
subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
```

Here, we have set up the generated attributes as separate secrets in our **staging** environment on GitHub

If you cannot set up the federated identity, instead use this with complete json added to GitHub secret (AZURE_CREDENTIALS)

```yaml
# Using complete JSON
azure-creds: ${{ secrets.AZURE_CREDENTIALS }}
```



## Considerations - actions vs workflows

For reusing code within CI / cd pipeline, there are 2 options - actions and workflows.
Actions have several limitations (read GitHub documentation) and we discarded this approach in favor of 'workflows'


## Prepare - GitHub environments, secrets & variables

On the corporate account, prepare the 2 environments that we need, set up secrets and variables.
On GitHub, access 'Settings' -> 'Environments' and create 2 environments as shown.
For each environment, set up variables that you would need for deployment - they map to variables that we input as parameters to bicep scripts.

Note than 'environments' feature is available on org accounts only, not personal !


![github_environments.png](/assets/blog/github_actions/github_environments.png)


Prepare the secrets and variables that you need.


![github_secrets_vars.png](/assets/blog/github_actions/github_secrets_vars.png)


## Build : .github/workflows/deploy_teams_bot.yml

Here is the main **caller workflow** that gets triggered on ANY push to the branch
Also, we limit concurrency to only 1 at a time.

For some reason (to me, it is an ignored feature in GitHub), when a workflow is in progress, and a new commit triggers the same workflow,
by default, GitHub would start executing it concurrently ! We do not want that - ideally we want the already running workflow to finish while the new action
remains in queue until the first workflow is done, and then the queued workflow starts. But the way GitHub designed it, it would ALWAYS cancel the running workflow
and then replace the running workflow with the queued workflow. Though undesired, lets live with it for now.

https://github.com/orgs/community/discussions/12835


So, here is the main workflow:

 - trigger on main branch commits
 - check out code and set the commit hash as output of this step. Note that subsequent steps or workflows only can use the output
 - in the next job for 'deploy-staging', make it depends on the check-out job
 - 'uses' the 'reusable' or **called workflow** that we would build later, to actually use steps from
 - the main input we send here is 'environment'. The name here can be 'staging' or 'production' and refers to the names that we created on GitHub-> settings-> environments
 - send inputs to reusable workflow - commit hash (for the reusable workflow to check out and work on this commit only), deployment stage
 - no need to explicitly define secrets. Use 'inherit' to allow reusable workflows to use them based on GitHub environment
 - prepare 'deploy-production' job now using workflow again

Note the differences in the staging verses production deployment

 - deployment_stage is different, and this would be used to set up an environment variable for web app for it to use within code
 - note the depends on; production deployment depends on staging deployment as well as step that sets commit hash. Of course, production should depend on success of staging deployment
   but also the 'get-commit-hash' step as this step has the output that contains the commit hash to use for the called workflow to chec kout code from !
   This ensures both staging and production deployment use same version of code to deploy, even if when running a long workflow, new commits may happen to same branch.
 - secrets are different, environment specific secrets will be used in called workflow if it points to the right environment
 - and hence the environment is different, name as the GitHub environment

You CANNOT use the 'environment' in the calling workflow with 'uses'. Only called workflow can refer to an environment !

See https://github.com/orgs/community/discussions/12835




```yaml
name: Teams Bot - deployment

on:
  workflow_dispatch:
  push:
    branches:
     - main

# https://github.com/orgs/community/discussions/12835
# cancels existing job and runs new. No option to wait for existing job to finish while new waits in a queue
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

permissions:
  id-token: write
  contents: read

jobs:

  get-commit-hash:
    name: Fetch commit hash to use for deployment
    runs-on: ubuntu-latest
    outputs:
      commit_hash: ${{ steps.get_commit_hash.outputs.commit_hash }}
    steps:

      - name: Checkout code
        uses: actions/checkout@v4

      - name: Get commit hash
        id: get_commit_hash
        run: |
          echo "commit_hash=$(git rev-parse HEAD)" >> $GITHUB_OUTPUT
          echo "The commit hash for staging deployment is set for next steps"

  deploy-staging:
    name: Deploy Teams Bot to staging
    needs: get-commit-hash
    uses: ./.github/workflows/deploy_teams_bot_workflow.yml
    with:
      environment: staging
      commit_hash:  ${{needs.get-commit-hash.outputs.commit_hash}}
      deployment_stage: 'non-prod'
    secrets: inherit


  deploy-production:
    name: Deploy Teams Bot to production
    uses: ./.github/workflows/deploy_teams_bot_workflow.yml
    needs: [deploy-staging, get-commit-hash]
    with:
      environment: production
      commit_hash: ${{needs.get-commit-hash.outputs.commit_hash}}
      deployment_stage: 'prod'
    secrets: inherit
```


## Build : .github/workflows/deploy_teams_bot_workflow.yml

Here is the re-usable **called workflow** that gets 'used' by **calling workflow**.

The design of called workflow :

 - accept the inputs from caller workflow (add as you need). Note that we did not send 'variables' as inputs !
 - we define one single job called 'deploy'. The key here is 'environment' which would set to either staging or production. This means now the called workflow
   can access the environment specific secrets and variables. 'secrets' are the OpenID credentials to login to Azure, and 'variables' are specific to our application.
 - check out the code from the given 'hash' only ( ensure we use same code for every thing). Note that you **cannot** check out code in calling workflow and pass the
   path or reference to called workflow - GitHub may execute each job on a different runner and code is not available here. Execution of jobs is defined to run in concurrent
   but for dependencies among them
 - persist short commit hash in GitHub environment - we would use this as input to bicep scripts to tag our Azure resources
 - run unit tests. Note that we use specific version of python to do so, controlled by variable for this environment.
 - login to Azure with OpenID credentials - note that called workflow now can acess the inherited secrets **for the environment: ${{ inputs.environment }} it refers to now**
   If "environment" is not given, login would fail errors when trying to use Service Principal, error message may be misleading..
 - deploy the infra next: see bicep scripts that we deploy here: location, userAppSettings, deploymentStage, keyVaultName and keyVaultResourceGroupName are required by bicep scripts
 - once infra is deployed, based on scripts, web app name would be given by the scripts - extract it as we need this to bundle and deploy our  code to
 - next prepare the deployment package, keep the package with only files that are needed, discard everything else !

Note that deployment of code to web app (**az webapp deploy**) is pathetically slow and un-reliable in Azure.
It may take 15-20 minutes to deploy code, it may fail after few seconds, CLI version dependencies are there with this command. You may have unforeseen errors at this step.
Review this with documentation, but as on date this is stable. You can try changing CLI version, and play with parameters.
Some parameters such as 'async' do not work, some do not work with specific CLI versions, there are discrepancies between lookup by this command to the deployment status API
that Azure has etc.

 - run the deployment with a controlled CLI version and command parameters to the **staging slot**. bicep scripts created this slot for us - we deploy here
   We will have staging and production(default) slots for our web app for both staging and production deployments.
   The app service would have a '-staging' suffix for staging slot, nothing for production slot
 - run the 'deploy' tests now. There are problems here again - once previous step is completed, app is still not available !!
   It takes 10-15 minutes for app for it to be up & running !
   The test itself needs APP_SERVICE_DEPLOYMENT_SLOT in environment which we set up just after web app deploy.
 - swap the slots to deploy staging slot code to production, set the slot in environment, log out from Azure and re-run deploy tests on the deployment in this slot


```yaml
name: Deploy Steps

on:
  workflow_call:
    inputs:
      environment:
        required: true
        type: string
      commit_hash:
        required: true
        type: string
      deployment_stage:
        required: true
        type: string

jobs:
  deploy:
    runs-on: ubuntu-latest
    # see https://github.com/orgs/community/discussions/25238
    # environment is allowed here; if configured, reads inherited secrets from this environment
    environment: ${{ inputs.environment }}
    steps:
      - name: Deploy to ${{ inputs.environment }} from ${{ inputs.commit_hash }}
        run: |
            echo "Deploying to ${{ inputs.environment }}" from ${{ inputs.commit_hash }}

      - name: Checkout code in called workflow
        uses: actions/checkout@v4
        with:
          ref: ${{ inputs.commit_hash }}

      - name: Get short commit hash
        run: |
          echo "SHORT_COMMIT_ID=$(git rev-parse --short=7 ${{ github.sha }})" >> $GITHUB_ENV

      - name: Set up Python ${{ vars.PYTHON_VERSION }}
        uses: actions/setup-python@v4
        with:
          python-version: ${{ vars.PYTHON_VERSION }}

      - name: Run unit tests
        run: |
           python -m pip install --upgrade pip
           pip install -r requirements-test.txt
           python -m pytest tests/*.py

      # login with inherited secrets for this job's environment
      - name: Login to azure
        uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      # https://github.com/Azure/azure-cli/issues/30147
      # may see some crypto warnings
      - name: Deploy teams bot infra
        uses: azure/cli@v2
        with:
          azcliversion: latest
          inlineScript: |
              cd infrastructure && \
              az deployment group create \
                --resource-group ${{ vars.TEAMS_BOT_RESOURCE_GROUP_NAME }} \
                --template-file main.bicep \
                --query "properties.outputs" \
                --output json \
                --parameters params.bicepparam \
                 location=${{ vars.LOCATION }} \
                 deploymentStage=${{ inputs.deployment_stage }} \
                 keyVaultName=${{ vars.KEY_VAULT_NAME }} \
                 keyVaultResourceGroupName=${{ vars.KEY_VAULT_RESOURCE_GROUP_NAME }} \
                 userAppSettings="{ \
                  \"COMMIT_ID\":  \"${{ env.SHORT_COMMIT_ID}}\", \
                  \"DEPLOYMENT_STAGE\":  \"${{ inputs.deployment_stage}}\", \
                  \"KEY_VAULT_NAME\": \"${{ vars.KEY_VAULT_NAME }}\", \
                  \"KEY_VAULT_RESOURCE_GROUP_NAME\": \"${{ vars.TEAMS_BOT_RESOURCE_GROUP_NAME }}\" \
                }"

      - name: Retrieve teams bot app name
        id: get-webapp-name
        run: |
          # Get the deployment outputs, 'appServiceDeployment' is fixed in bicep scripts
          output=$(az deployment group show --resource-group ${{ vars.TEAMS_BOT_RESOURCE_GROUP_NAME }} --name appServiceDeployment --query properties.outputs)
          appServiceName=$(echo $output | grep -oP '"appServiceName":\s*{\s*"type":\s*"String",\s*"value":\s*"\K[^"]+')
          echo "APP_SERVICE_NAME=$appServiceName" >> $GITHUB_ENV

      - name: Prepare deployment package
        run: |
          mkdir -p target
          rm -rf target/bot.zip
          zip -r target/bot.zip . -x  '*docs*' '*.git*' -x "*pytest_cache*" -x "*__pycache__*" -x "*.md" -x "*.idea/*" -x "*infrastructure*" "*deployments*" -x "tests*" -x "target*" -x .env

      # https://github.com/Azure/azure-cli/issues/29003  - infinite polling status issue or 202 dpeloyment staus issue
      # INFINITE time to deploy the webapp :( horrible !!
      # Another issue: this may not trigger the deployment at all ! and just fail querying deployment API.
      # try 2.66.0
      - name: Deploy bot code using az 2.66.0 to azure web app (staging slot) - ${{ env.APP_SERVICE_NAME }}
        uses: azure/cli@v2
        with:
          azcliversion: 2.66.0
          inlineScript: |
            az webapp deploy --resource-group ${{ vars.TEAMS_BOT_RESOURCE_GROUP_NAME }} \
            --name ${{ env.APP_SERVICE_NAME }} \
            --async true \
            --slot staging \
            --track-status false \
            --src-path target/bot.zip \
            --type zip \
            --timeout 900
            echo "APP_SERVICE_DEPLOYMENT_SLOT=staging" >> $GITHUB_ENV

      # deploy tests need to wait for the app to come up, which is extremely slow
      - name: Run deploy tests (staging slot)
        id: run-staging-slot-tests
        run: |
           python -m pytest tests/deploy

      - name: Swap staging slot to production
        run: |
            az webapp deployment slot swap --resource-group ${{ vars.TEAMS_BOT_RESOURCE_GROUP_NAME }} \
              --name ${{ env.APP_SERVICE_NAME }} \
              --slot staging \
              --target-slot production
            echo "APP_SERVICE_DEPLOYMENT_SLOT=production" >> $GITHUB_ENV

      - name: Azure logout
        run: |
          az logout

      # deploy tests need to wait for the app to come up, which is extremely slow
      - name: Run deploy tests (production slot)
        id: run-production-slot-tests
        run: |
           python -m pytest tests/deploy
```


## Manual Release to Production

Once the deployment to staging is complete, we need to stop automatic production deployment as we need manual approval as per our requirements.
You can configure this set up on GitHub console for **production** environment to add one or more approvers.

![github_prod_approval.png](/assets/blog/github_actions/github_prod_approval.png)

This would mean when staging deployment is done, the workflow will wait for manual intervention to run the job if the **configured environment** matches
the environment on GitHub configured for approval.


## Run

Make a commit in 'main' branch, and see the workflow in GitHub Console.

For org accounts, the called workflow shows the progress steps as well !

![github_workflow_progress.png](/assets/blog/github_actions/github_workflow_progress.png)
