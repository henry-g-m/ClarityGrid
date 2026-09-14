targetScope = 'resourceGroup'

@description('Environment name used to derive resource names (azd convention).')
param environmentName string

@description('Azure region for the compute resources.')
param location string = resourceGroup().location

@secure()
@description('Postgres connection string for the backend service.')
param databaseUrl string

@description('Container image to deploy. Placeholder on first provision; azd overwrites this on deploy.')
param backendImage string = 'mcr.microsoft.com/k8se/quickstart:latest'

var resourceToken = uniqueString(resourceGroup().id, environmentName)
var tags = {
  'azd-env-name': environmentName
}

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-claritygrid-${environmentName}'
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-claritygrid-${environmentName}'
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
    IngestionMode: 'LogAnalytics'
  }
}

resource containerAppsEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-claritygrid-${environmentName}'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

resource containerRegistry 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: 'crclaritygrid${resourceToken}'
  location: location
  tags: tags
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
  }
}

resource backendIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-claritygrid-backend-${environmentName}'
  location: location
  tags: tags
}

resource acrPullRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(containerRegistry.id, backendIdentity.id, 'AcrPull')
  scope: containerRegistry
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
    principalId: backendIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource backendApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'ca-claritygrid-backend'
  location: location
  tags: union(tags, {
    'azd-service-name': 'backend'
  })
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${backendIdentity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerAppsEnv.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 8000
        transport: 'auto'
        allowInsecure: false
      }
      registries: [
        {
          server: containerRegistry.properties.loginServer
          identity: backendIdentity.id
        }
      ]
      secrets: [
        {
          name: 'database-url'
          value: databaseUrl
        }
        {
          name: 'appinsights-connection-string'
          value: appInsights.properties.ConnectionString
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'backend'
          image: backendImage
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            {
              name: 'DATABASE_URL'
              secretRef: 'database-url'
            }
            {
              // TODO(phase2): replace with the real frontend origin once the UI is deployed
              name: 'CLARITYGRID_CORS_ORIGINS'
              value: '*'
            }
            {
              name: 'CLARITYGRID_APP_NAME'
              value: 'ClarityGrid Backend'
            }
            {
              name: 'CLARITYGRID_ENVIRONMENT'
              value: 'production'
            }
            {
              name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
              secretRef: 'appinsights-connection-string'
            }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 2
      }
    }
  }
  dependsOn: [
    acrPullRoleAssignment
  ]
}

output AZURE_CONTAINER_REGISTRY_ENDPOINT string = containerRegistry.properties.loginServer
output APPLICATIONINSIGHTS_CONNECTION_STRING string = appInsights.properties.ConnectionString
output BACKEND_URL string = 'https://${backendApp.properties.configuration.ingress.fqdn}'
