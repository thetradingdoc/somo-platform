@description('Base name applied to all resources (lowercase, no spaces)')
param namePrefix string

@description('Azure region')
@allowed([
  'westus2'
  'eastus'
  'centralus'
  'eastus2'
])
param location string = 'westus2'

@description('App Service plan SKU')
@allowed([
  'B1'
  'P1v3'
  'P2v3'
])
param appServiceSku string = 'B1'

@description('Postgres SKU name (flexible server)')
@allowed([
  'Standard_B1ms'
  'Standard_B2s'
])
param postgresSku string = 'Standard_B1ms'

@description('Postgres admin username')
param adminLogin string

@secure()
@description('Postgres admin password')
param adminPassword string

var appServicePlanName = '${namePrefix}-plan'
var appServiceName = '${namePrefix}-api'
var postgresName = '${namePrefix}-pg'
var postgresDbName = 'middleware'

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: appServicePlanName
  location: location
  sku: {
    name: appServiceSku
    tier: appServiceSku == 'B1' ? 'Basic' : 'PremiumV3'
    size: appServiceSku
    capacity: 1
  }
  properties: {
    reserved: true
    perSiteScaling: false
  }
}

resource site 'Microsoft.Web/sites@2023-12-01' = {
  name: appServiceName
  location: location
  properties: {
    serverFarmId: plan.id
    siteConfig: {
      linuxFxVersion: 'NODE|20-lts'
      alwaysOn: true
      appSettings: [
        { name: 'NODE_ENV'; value: 'production' }
        { name: 'PORT'; value: '4000' }
        { name: 'POSTGRES_URL'; value: '$(postgresConnectionString)' }
        { name: 'DEFAULT_CLINIC_ID'; value: 'clinic-default' }
        { name: 'RETELL_API_KEY'; value: '' }
        { name: 'RETELL_AGENT_ID'; value: '' }
        { name: 'TWILIO_ACCOUNT_SID'; value: '' }
        { name: 'TWILIO_AUTH_TOKEN'; value: '' }
        { name: 'TWILIO_PHONE_NUMBER'; value: '' }
        { name: 'AZURE_COMMUNICATION_CONNECTION_STRING'; value: '' }
        { name: 'AZURE_EMAIL_SENDER'; value: '' }
      ]
    }
  }
  identity: {
    type: 'SystemAssigned'
  }
  dependsOn: [
    plan
  ]
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2023-03-01-preview' = {
  name: postgresName
  location: location
  properties: {
    administratorLogin: adminLogin
    administratorLoginPassword: adminPassword
    version: '15'
    storage: {
      storageSizeGB: 128
    }
    highAvailability: {
      mode: 'Disabled'
    }
    network: {
      publicNetworkAccess: 'Disabled'
    }
    backup: {
      backupRetentionDays: 7
    }
  }
  sku: {
    name: postgresSku
    tier: 'GeneralPurpose'
    capacity: 2
  }
}

resource postgresDb 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2023-03-01-preview' = {
  name: '${postgres.name}/${postgresDbName}'
  properties: {
    charset: 'UTF8'
    collation: 'en_US.UTF-8'
  }
}

var postgresConnectionString = 'postgresql://${adminLogin}:${adminPassword}@${postgres.name}.postgres.database.azure.com:5432/${postgresDbName}?sslmode=require'

output appServiceUrl string = 'https://${site.name}.azurewebsites.net'
output postgresHost string = '${postgres.name}.postgres.database.azure.com'
output connectionString string = postgresConnectionString

