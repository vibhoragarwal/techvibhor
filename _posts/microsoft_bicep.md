---
title: "Infrastructure as Code with Azure Bicep - deploying app service, bot service with several Azure integrations"
excerpt: "Instead of using default ARM templates provided by Microsoft samples, lets build the bicep templates for deployment of Bot that we build. 
Also add several other resources that we would need generally for any application and even in the bot we built !"
coverImage: "/assets/blog/microsoft_bicep/microsoft_bicep_title.png"
date: "2024-11-12T15:35:07.322Z"
author:
  name: Vibhor Agarwal
  picture: "/assets/blog/authors/techvibhor.png"
ogImage:
  url: "/assets/blog/microsoft_bicep/microsoft_bicep_title.png"

---

![](/assets/blog/microsoft_bicep/microsoft_bicep_title.png) 

# What are we deploying using Bicep

See here on the Bot framework based application that we had built so far.

[All about Microsoft Bot Framework (Python), Streaming Content & Azure Deployment for GenAI powered Chatbots](microsoft_bot)

Microsoft documentation provides basic default ARM templates, which we would replace with Bicep scripts, with several
integrations with Azure services, in a modular design covering several aspects of IaC development with Azure bicep.

# Who is deploying

As a developer, you may run deployment scripts and need at least "Contributor" access **over the subscription**.
Later if you are deploying in CI/CD pipeline, the service principal needs to have "Contributor" access **over the subscription**
Reason is that we could limit access over just the Resource Group where we deploy the bot, but we may need to access say a Key Vault from a different RG.


## What we would achieve

Build IaC using Bicep the Bot web app (app service) along with the Bot service.
We add a bit of complexity also along with the necessary to do things, such as:

 - create app service plan
 - create UserAssignedMSI (user managed identity) for the bot. We would use a password free identity
 - create app service (web app)
 - create bot service
 - create serverless cosmos DB to persist bot's user state
 - create key vault to persist Cosmos DB connection as secrets, also back end API url & secret and later use them in bot
 - use an existing app insights instance to connect the bot, persist the existing connection string in Key Vault as a secret
 - assign required 'user' permissions to the UserAssignedMSI on the key vault

Assume the resource group where we create bot infra exists already, and we skip creation for it.
You may add it.

Also, few more requirements:
 - consistent naming conventions of resources
 - modular design
 - abstracted complexity from module callers
 - comprehensive tagging of resources
 - use latest Azure API's in biceps


## Create modules/key_vault/keyVault.bicep


Note that when deleting resource group multiple times, if soft delete is enabled on vault, it needs to be recovered, if name is same (cannot use the same name).
Hence, here we disable soft delete so that we can use default create mode (other one is 'recover') every time we create the infra.
Key Vault is a global Azure service

```yaml 
param location string
param resourcePrefix string
param commonTags object
param appInsightsKey string
param backEndAPIBaseURL string
param backEndAPIKey string



var botKeyVaultName = '${resourcePrefix}-kv'

resource botKeyVault 'Microsoft.KeyVault/vaults@2024-04-01-preview' = {
  name: botKeyVaultName
  location: location
  tags:union(commonTags, {
    name: botKeyVaultName
  })
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: subscription().tenantId
    accessPolicies: []
    createMode: 'default'
    enableSoftDelete: false // delete always full, we can recreate...
  }
}

// Store the App Insights Conn String
resource appInsightsSecret 'Microsoft.KeyVault/vaults/secrets@2024-04-01-preview' = {
  name: 'app-insights-key'
  parent: botKeyVault
  properties: {
    value: backEndAPIKey
    attributes: {
      enabled: true
    }
  }
}

// Store the  API URL
resource backEndAPIKeySecret 'Microsoft.KeyVault/vaults/secrets@2024-04-01-preview' = {
  name: 'back-end-api-url'
  parent: botKeyVault
  properties: {
    value: backEndAPIBaseURL
    attributes: {
      enabled: true
    }
  }
}

// Store the  API subscription key for teams bot
resource prodAssistSubscriptionSecret 'Microsoft.KeyVault/vaults/secrets@2024-04-01-preview' = {
  name: 'back-end-api-passsword'
  parent: botKeyVault
  properties: {
    value: backEndAPIKey
    attributes: {
      enabled: true
    }
  }
}




output botKeyVaultName string = botKeyVault.name

```


## Create modules/managed_identity_roles/managedIdentityRoles.bicep [wont be used]


If need be, assuming with an existing key vault, that our bot's managed identity wants to use, is configured with Vault Access Policy. 
All we want is to list & get secrets from that Key Vault, then this might be needed.

```yaml 
param keyVaultName string
param managedIdentityPrincipalId string


// Reference the existing Key Vault
resource keyVault 'Microsoft.KeyVault/vaults@2024-04-01-preview' existing = {
  name: keyVaultName
}


// If using VAULT ACCESS POLICY in KEY VAULT, need access to managed identity running in web app
// to be able to list and get secrets for API keys and app insights key
resource keyVaultAccessPolicy 'Microsoft.KeyVault/vaults/accessPolicies@2024-04-01-preview' = {
  parent: keyVault
  name: 'add'
  properties: {
    accessPolicies: [
      {
        tenantId: subscription().tenantId
        objectId: managedIdentityPrincipalId
        permissions: {
          secrets: [
            'get'
            'list'
          ]
        }
      }
    ]
  }
}


// key vault secrets user role id. Always fixed in Azure. ( DO NOT GIVE READER)
//var roleDefinitionId = '4633458b-17de-408a-b874-0445c86b69e6'

// IF USING RBAC in KEY VAULT: Assign the Key Vault Secrets User role to the managed identity for the Key Vault
// resource roleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
//   name: guid(keyVault.id, managedIdentityPrincipalId, roleDefinitionId)
//   scope: keyVault
//   properties: {
//     principalId: managedIdentityPrincipalId
//     roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleDefinitionId)
//     principalType: 'ServicePrincipal'
//   }
// }
```



## Create modules/managed_identity_roles/thisRGmanagedIdentityRoles.bicep

Here, we try to give permissions to the managed identity to use the Key Vault that we created to persist any bot specific secrets
(such as Cosmos DB connection, which we would do a little later) in this Resource Group itself.

```yaml 
param botKeyVaultName string
param managedIdentityPrincipalId string


// Reference the existing Key Vault
resource teamsBotKeyVault 'Microsoft.KeyVault/vaults@2024-04-01-preview' existing = {
  name: botKeyVaultName
}


// If using VAULT ACCESS POLICY in KEY VAULT, need access to managed identity running in web app
// to be able to list and get secrets for cosmos
resource teamsBotKeyVaultAccessPolicy 'Microsoft.KeyVault/vaults/accessPolicies@2024-04-01-preview' = {
  parent: teamsBotKeyVault
  name: 'add'
  properties: {
    accessPolicies: [
      {
        tenantId: subscription().tenantId
        objectId: managedIdentityPrincipalId
        permissions: {
          secrets: [
            'get'
            'list'
          ]
        }
      }
    ]
  }
}
```



## Create modules/managed_identity/managedIdentity.bicep

Create the managed identity and assign permissions to this.
 - permissions to use Key Vault created for bot secrets
 - permissions to use Key Vault that was existing to be used

Important thing to note here is this identity's **client id** would be used in the Bot service's **Microsoft App ID**.
Now we would later use this identifier to create a Teams App that we would deploy to teams. The app is nothing but a bundle of manifest file (JSON)
and icons. Now, you may have restrictions to deploy this again and again, and if you delete the RG or this identity, when scripts are re-run they would
generate a new identity, and hence a new **client id** which becomes a new **Microsoft App ID** for the bot, which means now, the Teams App needs re-deployment to work !

Now you can manually lock the deletion of this identity but you need "owner" permissions or additional permissions with Contributor access.
Here we do not use Bicep to lock the deletion, but use portal to lock it !

Secondly, we don not want the name to be dynamic - running multiple times with changing names would cause new identity to be created and the same issue !
Hence, as an exception, we **fix the name** of this identity across environments.


```yaml
param location string
param resourcePrefix string
param commonTags object
param teamsBotKeyVaultName string

// managed identity be locked for deletion as this would generate client ID (Microsoft App ID) for the bot service, which would be used to create teams app via manifest file
// deleting and recreating means it would generate new identity, and map it to bot in entire IaC and existing teams app would fail to connect
// Also, fix the name so that, we dont change resource prefix in main.bicep resulting in new identity to be created, resulting in new Microsoft App ID for the bot service
var managedIdentityName = 'app-base-name-managed-identity'

// Create the user-assigned managed identity
resource userAssignedIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-07-31-preview' = {
  name: managedIdentityName
  location: location
  tags:union(commonTags, {
    name: managedIdentityName
  })
}

// in the key vault that comes from different RG, enable if needed, accept kvResourceGroupName, kvResourceGroupName here, and pass from caller
// module productAssistantRoleAssignmentModule '../managed_identity_roles/managedIdentityRoles.bicep' = {
//   name: 'otherRGRoleAssignmentModule'
//   scope: resourceGroup(kvResourceGroupName) // this is in some other RG
//   params: {
//     keyVaultName: keyVaultName
//     managedIdentityPrincipalId: userAssignedIdentity.properties.principalId
//   }
// }


// in the teams RG itself
module botRGRoleAssignmentModule '../managed_identity_roles/thisRGmanagedIdentityRoles.bicep' = {
  name: 'botRGRoleAssignmentModule'
  params: {
    botKeyVaultName: teamsBotKeyVaultName
    managedIdentityPrincipalId: userAssignedIdentity.properties.principalId
  }
}


output userAssignedIdentityId string = userAssignedIdentity.id
output userAssignedTenantId string = userAssignedIdentity.properties.tenantId
output userAssignedClientId string = userAssignedIdentity.properties.clientId
```



## Create modules/database_cosmos/databaseCosmos.bicep

Create the Cosmos DB serverless where we would persist user states.
Also, lookup the key vault that we created for this purpose and create secrets for Cosmos DB connection string & secret key !

```yaml 
param location string
param resourcePrefix string
param commonTags object
param botKeyVaultName string

var databaseAccountName = '${resourcePrefix}-cosmos'

resource databaseAccount 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: databaseAccountName
  location: location
  tags:union(commonTags, {
    name: databaseAccountName
  })
  kind: 'GlobalDocumentDB'
  identity: {
    type: 'None'
  }
  properties: {
    publicNetworkAccess: 'Enabled'
    enableAutomaticFailover: false
    enableMultipleWriteLocations: false
    isVirtualNetworkFilterEnabled: false
    virtualNetworkRules: []
    disableKeyBasedMetadataWriteAccess: false
    enableFreeTier: false
    enableAnalyticalStorage: false
    analyticalStorageConfiguration: {
      schemaType: 'WellDefined'
    }
    databaseAccountOfferType: 'Standard'
    defaultIdentity: 'FirstPartyIdentity'
    networkAclBypass: 'None'
    disableLocalAuth: false
    enablePartitionMerge: false
    enableBurstCapacity: false
    minimalTlsVersion: 'Tls12'
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
      maxIntervalInSeconds: 5
      maxStalenessPrefix: 100
    }
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    cors: []
    capabilities: [
      {
        name: 'EnableServerless'
      }
    ]
    ipRules: []
    backupPolicy: {
      type: 'Periodic'
      periodicModeProperties: {
        backupIntervalInMinutes: 240
        backupRetentionIntervalInHours: 8
        backupStorageRedundancy: 'Geo'
      }
    }
    networkAclBypassResourceIds: []
  }
}


// Reference the existing Key Vault
resource teamsBotKeyVault 'Microsoft.KeyVault/vaults@2024-04-01-preview' existing = {
  name: botKeyVaultName
  scope: resourceGroup()
}

// Store the Cosmos DB account endpoint
resource endpointSecret 'Microsoft.KeyVault/vaults/secrets@2024-04-01-preview' = {
  name: 'teams-bot-cosmos-endpoint'
  parent: teamsBotKeyVault
  properties: {
    value: 'https://${databaseAccount.name}.documents.azure.com:443/'
  }
}

// Store the Cosmos DB account key
resource keySecret 'Microsoft.KeyVault/vaults/secrets@2024-04-01-preview' = {
  name: 'teams-bot-cosmos-key'
  parent: teamsBotKeyVault
  properties: {
    value: databaseAccount.listKeys().primaryMasterKey
  }
}

output databaseAccountName string = databaseAccount.name
output databaseAccountId string = databaseAccount.id
```



## Create modules/app_service_plan/appServicePlan.bicep

Create the App Service Plan.
Note that depending on the deployment stage ( we just have 2 - non-prod or staging and prod), we can use different SKUs
However, in example below, the SKU used is always 'Standard', for the reason that we would later use deployment slots
(staging, production) for deployment and swap them once tests pass on staging slot.
To enable slots, we cannot work with Free Tier plan - Azure does not allow this, hence the 'Standard'.
You can choose your own plan.

```yaml
param resourcePrefix string
param location string
param deploymentStage string
param commonTags object

var appServicePlanName = '${resourcePrefix}-app-plan'
// need non free for 2 slots
var appServicePlanSKU = (deploymentStage == 'prod') ? {
  name: 'S1'
  tier: 'Standard'
  size: 'S1'
  family: 'S'
  capacity: 1
} : {
  name: 'S1'
  tier: 'Standard'
  size: 'S1'
  family: 'S'
  capacity: 1
}

resource appServicePlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: appServicePlanName
  location: location
  sku: appServicePlanSKU
  kind: 'linux'
  properties: {
    perSiteScaling: false
    reserved: true
    targetWorkerCount: 0
    targetWorkerSizeId: 0
  }
  tags:union(commonTags, {
    name: appServicePlanName
  })
}

output appServicePlanId string = appServicePlan.id
```

## Create modules/app_service/appService.bicep

Create the App Service itself, which includes creating a site configuration also.
We need the identity & app service plan here.

Also, we need the key Vault we created here, so that we can look this up in our bot code to fetch Cosmos DB connection

Here we would also create a 'staging' slot (default slot is 'production' and is always present !)
Note that configuration of the slot should be same as the app service configuration, hence use this configuration
as a variable.

Try to abstract all complexity of app to this module, such as:

 - configure python version here
 - allow user application settings 'as is' that come from parameter to the main script
 - pre-build commands
 - gunicorn WSGI wrapped main command (note name of our main bot file is **app.py**)
 - set common variables such as PYTHONUNBUFFERED, to flush logs in python immediately

```yaml 
param resourcePrefix string
param location string
param commonTags object
param appId string
param userAssignedIdentityId string
param appTenantId string
param userAppSettings object
param botKeyVaultName string
param appServicePlanId string

var appServiceName = '${resourcePrefix}-web-app'
var linuxFxVersion = 'python|3.11'
var pythonVersion = split(linuxFxVersion, '|')[1]


// https://github.com/Azure/azure-quickstart-templates/blob/master/quickstarts/microsoft.web/web-app-loganalytics/main.bicep

// config.py will use these environment properties to decide credentials flow in code
var defaultAppSettings = {
  WEBSITES_PORT: 8081
  BOT_KEY_VAULT_NAME: botKeyVaultName
  MicrosoftAppId: appId
  PYTHONUNBUFFERED: 1
  AZURE_CLIENT_ID: appId
  MicrosoftAppType: 'UserAssignedMSI'
  MicrosoftAppTenantId: appTenantId
  MicrosoftAppPassword: ''
  PRE_BUILD_COMMAND: 'python3 -m pip install --upgrade pip'
  SCM_DO_BUILD_DURING_DEPLOYMENT: 'true'
}


// add , appInsightsSettings if need web app to read it from env. Better way is to hide this in env, and read from secrets in code.
var mergedAppSettings = union(defaultAppSettings, userAppSettings)

 // go in environment
 var mergedAppSettingsList  = [
  for setting in items(mergedAppSettings): {
    name: setting.key
    value: setting.value
  }
]

var siteConfiguration =  {
  acrUseManagedIdentityCreds: true
  acrUserManagedIdentityID: userAssignedIdentityId
  alwaysOn: false
  appCommandLine: 'gunicorn --bind 0.0.0.0 --worker-class aiohttp.worker.GunicornWebWorker --timeout 600 app:app'
  // go in environment
  appSettings: mergedAppSettingsList
  autoHealEnabled: false
  cors:{
      allowedOrigins: [
        'https://botservice.hosting.portal.azure.net'
        'https://hosting.onecloud.azure-test.net/'
      ]
    }
  defaultDocuments: [
    'Default.htm'
    'Default.html'
    'Default.asp'
    'index.htm'
    'index.html'
    'iisstart.htm'
    'default.aspx'
    'index.php'
    'hostingstart.html'
  ]
  detailedErrorLoggingEnabled: false
  ftpsState: 'AllAllowed'
  httpLoggingEnabled: true
  linuxFxVersion: linuxFxVersion
  loadBalancing: 'LeastRequests'
  logsDirectorySizeLimit: 35
  managedPipelineMode: 'Integrated'
  minTlsVersion: '1.2'
  numberOfWorkers: 1
  publishingUsername: appServiceName
  pythonVersion: pythonVersion
  requestTracingEnabled: false
  remoteDebuggingEnabled: false
  remoteDebuggingVersion: 'VS2022'
  scmType: 'None'
  use32BitWorkerProcess: true
  virtualApplications: [
    {
      virtualPath: '/'
      physicalPath: 'site\\wwwroot'
      preloadEnabled: false
      virtualDirectories: null
    }
  ]
  webSocketsEnabled: false
}

resource appServiceApp 'Microsoft.Web/sites@2023-12-01' = {
  name: appServiceName
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
     '${userAssignedIdentityId}': {}
    }
  }
  tags: union(commonTags, {name: appServiceName})
  location: location
  kind: 'app,linux'
  properties: {
    serverFarmId: appServicePlanId
    httpsOnly: true
    siteConfig: siteConfiguration
  }
}


// Define the deployment slot with same properties as appService and webConfig
resource staging 'Microsoft.Web/sites/slots@2023-12-01' = {
  parent: appServiceApp
  name: 'staging'
  location: location
  kind: 'app,linux'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
     '${userAssignedIdentityId}': {}
    }
  }
  tags: union(commonTags, { name: 'staging' })
  properties: {
    serverFarmId: appServicePlanId
    httpsOnly: true
    siteConfig: siteConfiguration
  }
}

output appServiceName string = appServiceName
output defaultDomain string = appServiceApp.properties.defaultHostName
```


## Create modules/bot_service/botService.bicep

Create the Bot service.
Here you can choose SKUs depending on the deployment stage.
Also enable the teams channel - we are building app for teams !


```yaml 
param resourcePrefix string
param location string
param commonTags object
param appId string
param tenantId string
param appMSIResourceId string
param domain string
param deploymentStage string

// FO and S1 ARE ONLY allowed
var botServiceSKU = (deploymentStage == 'prod') ? 'S1' : 'F0'

var botServiceName = '${resourcePrefix}-bot-service'
var botDisplayName = (deploymentStage == 'prod') ? 'My Bot' : 'My Bot (testing)' 

// endpoint is in app.py
var endPoint = 'https://${domain}/api/messages'

resource botService 'Microsoft.BotService/botServices@2023-09-15-preview' = {
  kind: 'azurebot'
  location: location
  name: botServiceName
  properties: {
    description: 'Bot Service'
    displayName: botDisplayName
    msaAppMSIResourceId: appMSIResourceId
    msaAppId: appId
    msaAppTenantId:tenantId
    endpoint: endPoint
    msaAppType:'UserAssignedMSI'
  }
  sku: {
    name: botServiceSKU
  }
  tags:union(commonTags, {
    name: botServiceName
  })
}


resource teamsChannel 'Microsoft.BotService/botServices/channels@2023-09-15-preview' = {
  name: 'MsTeamsChannel'
  parent: botService
  location: location
  properties: {
    channelName: 'MsTeamsChannel'
    properties: {
        enableCalling: false
        isEnabled: true
    }
  }
}
```



## Create params.bicepparam

Note that bot cannot be deployed to all regions
Also note that default values for each param is required in bicep

```yaml 
using './main.bicep'

param location = 'westeurope'
param deploymentStage = 'non-prod'
param userAppSettings = {}

//existing
param appInsightsKey =  ''
param backEndAPIBaseURL =''
param backEndAPIKey =''
```

## Create main.bicep

Stitch them together.

'depends on' has been added for clarity.

Observed an issue with bicep (not seen with terraform)- params when being passed to the modules
should have a non-conflicting name with params defined in **main.bicep** such as 'keyVaultResourceGroupName'
or even as defined for other modules !!


```yaml
@description('The location of resource. Defaults to location of resource group. Note that bot service is not supported in all regions')
param location string = resourceGroup().location

@secure()
@description('Existing Application Insights instance connection string')
param appInsightsKey string

@secure()
@description('API URL')
param backEndAPIBaseURL string

@secure()
@description('API key')
param backEndAPIKey string

@description('Deployment type - prod, non-prod')
@allowed([
  'prod'
  'non-prod'
])
param deploymentStage string

@secure()
@description('App service settings from the user. Contains sensitive data.')
param userAppSettings object

@description('Current date and time for tagging')
param deploymentDate string = utcNow('yyyy-MM-ddTHH:mm:ssZ')


var application = 'app-base-name'
var deploymentStageLower =  (deploymentStage != null ? toLower(deploymentStage) : '')
var resourcePrefix =  (deploymentStageLower != '' && deploymentStageLower != 'prod') ? '${application}-stg' : application
var commitId = (userAppSettings.?COMMIT_ID ?? 'NA')

var commonTags = {
   resourceGroupName: resourceGroup().name
   application: application
   deploymentDate: deploymentDate
   deploymentStage: deploymentStage
   commitId: commitId
}

module botKeyVaultModule 'modules/key_vault/keyVault.bicep' = {
  name: 'botKeyVaultDeployment'
  params: {
    resourcePrefix: resourcePrefix
    location: location
    commonTags: commonTags
    appInsightsKey: appInsightsKey
    backEndAPIBaseURL: backEndAPIBaseURL
    backEndAPIKey: backEndAPIKey
  }
}

// identity to have USER permissions on both key vaults
module managedIdentityModule 'modules/managed_identity/managedIdentity.bicep' = {
  name: 'managedIdentityDeployment'
  params: {
    resourcePrefix: resourcePrefix
    teamsBotKeyVaultName: botKeyVaultModule.outputs.botKeyVaultName
    location: location
    commonTags: commonTags
  }
  dependsOn: [
    botKeyVaultModule
  ]
}

module cosmosDBModule 'modules/database_cosmos/databaseCosmos.bicep' = {
  name: 'cosmosDBDeployment'
  params: {
    resourcePrefix: resourcePrefix
    location: location
    commonTags: commonTags
    // dont use name teamsBotKeyVaultName as used already
    botKeyVaultName: botKeyVaultModule.outputs.botKeyVaultName
  }
  dependsOn: [
    botKeyVaultModule
  ]
}


module appServicePlanModule 'modules/app_service_plan/appServicePlan.bicep' = {
  name: 'appServicePlanDeployment'
  params: {
    resourcePrefix: resourcePrefix
    deploymentStage: deploymentStage
    location: location
    commonTags: commonTags
  }
}

module appServiceModule 'modules/app_service/appService.bicep' = {
  name: 'appServiceDeployment'
  params: {
    resourcePrefix: resourcePrefix
    appId: managedIdentityModule.outputs.userAssignedClientId
    userAssignedIdentityId: managedIdentityModule.outputs.userAssignedIdentityId
    // using tenantId instead of appTenantId fails in bicep!
    appTenantId: managedIdentityModule.outputs.userAssignedTenantId
    location: location
    userAppSettings: userAppSettings
    appServicePlanId: appServicePlanModule.outputs.appServicePlanId
    botKeyVaultName: botKeyVaultModule.outputs.botKeyVaultName
    commonTags: commonTags
  }
  dependsOn: [
    botKeyVaultModule
    managedIdentityModule
    appServicePlanModule
  ]
}


module botServiceModule 'modules/bot_service/botService.bicep' = {
  name: 'botServiceDeployment'
  params: {
    resourcePrefix: resourcePrefix
    appId:  managedIdentityModule.outputs.userAssignedClientId
    tenantId: managedIdentityModule.outputs.userAssignedTenantId
    // using userAssignedIdentityId instead of appMSIResourceId fails in bicep!
    appMSIResourceId: managedIdentityModule.outputs.userAssignedIdentityId
    location: location
    commonTags: commonTags
    deploymentStage: deploymentStage
    domain: appServiceModule.outputs.defaultDomain
  }
  dependsOn: [
    managedIdentityModule
    appServiceModule
  ]
}


output appServiceName string = appServiceModule.outputs.appServiceName
output defaultDomain string = appServiceModule.outputs.defaultDomain
output appServicePlanId string = appServicePlanModule.outputs.appServicePlanId
output teamsBotKeyVaultName string = botKeyVaultModule.outputs.botKeyVaultName
output teamsBotCosmosDBAccountName string = cosmosDBModule.outputs.databaseAccountName
output teamsBotCosmosDBAccountId string = cosmosDBModule.outputs.databaseAccountId

```
## Create .env file

```text


# use this to create resource names, also set as app setting on web app, for using stage in code
DEPLOYMENT_STAGE='non-prod'

# bot connects to a back end API to respond to queries
BACK_END_API_BASE_URL='https://my.back.end/'
BACK_END_API_KEY='key'

# existing instance
APP_INSIGHTS_KEY='InstrumentationKey=...'



# where do we deploy the webapp
LOCATION='westeurope'

# an existing Resource Group where we do do deployment, subscription admin creates this
TEAMS_BOT_RESOURCE_GROUP_NAME='existing-resource-group-for-this-app'

# some web ap env settings
SOME_OTHER_APP_SETTING='abc'
```



## Deploy the infrastructure

Since we kept the web app name dynamic, it should not be set in environment, as post this script, we would set it to deploy code to the web app.
The script below can be run after "az login", and would ask for confirmation.

Tip: Use **AI** to generate this.

Run this as : ```./deploy.sh non-prod```

Note the path of **.env** file, correct as necessary.

We would improve this later to use GitHub actions !!

```bash
#!/bin/bash

# Check if the variable is set in the environment

if [ ! -z "${APP_SERVICE_NAME}" ]; then
  echo "Error: Environment variable found: APP_SERVICE_NAME. Please UNSET it, as this script would set this for the app deployment script"
  exit 1
fi


# Check if the deployment stage is provided
if [ -z "$1" ]; then
  echo "Usage: $0 <deploymentStage>"
  exit 1
else
  # Rename $1 to $deploymentType
  deploymentStage="$1"
  echo "Deployment Stage: $deploymentStage"
fi


# List of required environment variables
required_env_vars=("LOCATION" "TEAMS_BOT_RESOURCE_GROUP_NAME" "BACK_END_API_BASE_URL" "BACK_END_API_KEY" "APP_INSIGHTS_KEY" "SOME_OTHER_APP_SETTING")

# Load environment variables from .env file
if [ -f ../.env ]; then
  source ../.env
else
  echo "Error: ../.env file not found. Expected to be in this parent folder"
  exit 1
fi


# Check if all required environment variables are set
for var in "${required_env_vars[@]}"; do
  if [ -z "${!var}" ]; then
    echo "Error: $var environment variable is not set."
    exit 1
  fi
done

# Log the enviornment details.
echo "Using account details for deployment..."
az account show


# Prompt the user for confirmation
read -p "Verify account details & deployment stage that you provided and confirm if you want to proceed? (Y/N): " confirm

# Check the user's response
if [[ "$confirm" =~ ^[Yy]$ ]]; then
  echo "Proceeding with the operation..."
  # Place your script's main logic here
else
  echo "Operation cancelled."
  exit 1
fi


commitId=$(git rev-parse --short=7 HEAD)

echo "The short commit ID is: $commitId"


# Run the deployment command, did not use name as we have each resource deployment name in bicep
az deployment group create \
  --resource-group $TEAMS_BOT_RESOURCE_GROUP_NAME \
  --template-file main.bicep \
  --query "properties.outputs" \
  --output json \
  --parameters params.bicepparam \
   location=$LOCATION \
   deploymentStage=$deploymentStage \
   appInsightsKey=$APP_INSIGHTS_KEY \
   backEndAPIBaseURL=$BACK_END_API_BASE_URL \
   backEndAPIKey=$BACK_END_API_KEY \
   userAppSettings="{ \
    \"SOME_OTHER_APP_SETTING\": \"$SOME_OTHER_APP_SETTING\", \
    \"COMMIT_ID\":  \"$commitId\", \
    \"DEPLOYMENT_STAGE\": \"$deploymentStage\" \
  }"

# Get the deployment outputs, 'appServiceDeployment' is fixed in bicep scripts
output=$(az deployment group show --resource-group $TEAMS_BOT_RESOURCE_GROUP_NAME --name appServiceDeployment --query properties.outputs)


# Extract the appServiceName using grep and sed
appServiceName=$(echo $output | grep -oP '"appServiceName":\s*{\s*"type":\s*"String",\s*"value":\s*"\K[^"]+')

# Set the appServiceName as an environment variable
export APP_SERVICE_NAME=$appServiceName

# Print the environment variable to verify
echo "App Service Name: $APP_SERVICE_NAME"

echo "Run on terminal before executing app deployment script: export APP_SERVICE_NAME=$APP_SERVICE_NAME"
```


## Deploy the web app bot code

On the terminal, run:

```shell
export APP_SERVICE_NAME=<obtained from infra deploy step>
```

Run this as : ```./app-deploy.sh```

```shell
#!/bin/bash

# List of required environment variables
required_env_vars=("TEAMS_BOT_RESOURCE_GROUP_NAME" "APP_SERVICE_NAME")

# Load environment variables from .env file
if [ -f ../.env ]; then
  source ../.env
else
  echo "Error: ../env file not found. Expected to be in this parent folder"
  exit 1
fi


# Check if all required environment variables are set
for var in "${required_env_vars[@]}"; do
  if [ -z "${!var}" ]; then
    echo "Error: $var environment variable is not set."
    exit 1
  fi
done

# Log the enviornment details.
echo "Using account details for app code deployment..."
az account show

echo "App service where the code would be deployed: $APP_SERVICE_NAME"

# Prompt the user for confirmation
read -p "Verify account details & app service name and confirm if you want to proceed? (Y/N): " confirm

# Check the user's response
if [[ "$confirm" =~ ^[Yy]$ ]]; then
  echo "Proceeding with the operation..."
  # Place your script's main logic here
else
  echo "Deployment cancelled."
  exit 1
fi

echo "Deploying code in resource group $TEAMS_BOT_RESOURCE_GROUP_NAME on bot app $APP_SERVICE_NAME..."

cd ..
mkdir -p target
rm -rf target/bot.zip
zip -r target/bot.zip . -x  '*docs*' '*.git*' -x "*pytest_cache*" -x "*__pycache__*" -x "*.md" -x "*.idea/*" -x "*infrastructure*" "*deployments*" -x "tests*" -x "target*" -x .env


# Run the deployment command
# Run the deployment command, first time is too slow as python image is downloaded, installed and several other hidden init activities..
az webapp deploy --resource-group $TEAMS_BOT_RESOURCE_GROUP_NAME\
  --name $APP_SERVICE_NAME\
  --src-path target/bot.zip\
  --track-status false \
  --type zip \
  --async true \
  --timeout 900


python -m pytest ../tests/deploy
```


# GitHub Actions as CI / CD

In the next blog, we would integrate these scripts in CI / CD pipeline, in a very pretty & usable manner with GitHub actions.

[CI / CD with GitHub Actions - deploying on Azure [app & bot service] with GitHub reusable workflows !](github_actions.md)
