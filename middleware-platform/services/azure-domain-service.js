/**
 * AZURE DOMAIN SERVICE
 * Automates Azure App Service custom domain and SSL certificate setup
 * for new tenant subdomains
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

class AzureDomainService {
  /**
   * Check if Azure CLI is available and user is logged in
   */
  static async checkAzureSetup() {
    try {
      // Check if az CLI is installed
      await execAsync('which az');
      
      // Check if logged in
      const { stdout } = await execAsync('az account show');
      const account = JSON.parse(stdout);
      
      return {
        available: true,
        loggedIn: true,
        subscriptionId: account.id,
        subscriptionName: account.name
      };
    } catch (error) {
      if (error.message.includes('which az')) {
        return {
          available: false,
          loggedIn: false,
          error: 'Azure CLI not installed'
        };
      }
      
      if (error.message.includes('az account show')) {
        return {
          available: true,
          loggedIn: false,
          error: 'Not logged into Azure'
        };
      }
      
      return {
        available: false,
        loggedIn: false,
        error: error.message
      };
    }
  }

  /**
   * Add custom domain to Azure App Service
   * @param {string} subdomain - Tenant subdomain (e.g., "doctor-little")
   * @param {string} rootDomain - Root domain (e.g., "doclittle.site")
   * @param {string} appName - Azure App Service name
   * @param {string} resourceGroup - Azure Resource Group name
   */
  static async addCustomDomain(subdomain, rootDomain, appName, resourceGroup) {
    const fullDomain = `${subdomain}.${rootDomain}`;
    
    try {
      // Check if domain already exists
      const { stdout } = await execAsync(
        `az webapp config hostname list --webapp-name ${appName} --resource-group ${resourceGroup} --query "[?name=='${fullDomain}'].name" --output tsv`
      );
      
      if (stdout.trim() === fullDomain) {
        console.log(`✅ Custom domain ${fullDomain} already exists in Azure`);
        return { success: true, alreadyExists: true, domain: fullDomain };
      }
      
      // Add custom domain
      await execAsync(
        `az webapp config hostname add --webapp-name ${appName} --resource-group ${resourceGroup} --hostname ${fullDomain}`
      );
      
      console.log(`✅ Custom domain ${fullDomain} added to Azure App Service`);
      return { success: true, alreadyExists: false, domain: fullDomain };
    } catch (error) {
      console.error(`❌ Failed to add custom domain ${fullDomain}:`, error.message);
      return { success: false, error: error.message, domain: fullDomain };
    }
  }

  /**
   * Create SSL certificate for subdomain
   * @param {string} subdomain - Tenant subdomain
   * @param {string} rootDomain - Root domain
   * @param {string} appName - Azure App Service name
   * @param {string} resourceGroup - Azure Resource Group name
   * @param {number} maxRetries - Maximum retries for certificate creation (default: 3)
   * @param {number} retryDelayMs - Delay between retries in milliseconds (default: 60000 = 1 minute)
   */
  static async createSSLCertificate(subdomain, rootDomain, appName, resourceGroup, maxRetries = 3, retryDelayMs = 60000) {
    const fullDomain = `${subdomain}.${rootDomain}`;
    
    try {
      // Check if certificate already exists
      let certificate;
      try {
        const { stdout } = await execAsync(
          `az webapp config ssl show --resource-group ${resourceGroup} --certificate-name ${fullDomain} --query thumbprint --output tsv 2>/dev/null || echo ""`
        );
        
        if (stdout.trim()) {
          console.log(`✅ SSL certificate for ${fullDomain} already exists`);
          return { success: true, alreadyExists: true, domain: fullDomain };
        }
      } catch (e) {
        // Certificate doesn't exist yet, continue to create
      }
      
      // Create certificate (may take 2-5 minutes)
      console.log(`📝 Creating SSL certificate for ${fullDomain}...`);
      await execAsync(
        `az webapp config ssl create --resource-group ${resourceGroup} --name ${appName} --hostname ${fullDomain}`
      );
      
      // Wait for certificate to be issued (retry logic)
      let retries = 0;
      let thumbprint = null;
      
      while (retries < maxRetries && !thumbprint) {
        // Wait before checking
        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
        
        try {
          const { stdout } = await execAsync(
            `az webapp config ssl show --resource-group ${resourceGroup} --certificate-name ${fullDomain} --query thumbprint --output tsv`
          );
          
          thumbprint = stdout.trim();
          if (thumbprint) {
            console.log(`✅ SSL certificate created for ${fullDomain} (thumbprint: ${thumbprint})`);
            return { success: true, alreadyExists: false, domain: fullDomain, thumbprint };
          }
        } catch (e) {
          // Certificate not ready yet
          retries++;
          if (retries < maxRetries) {
            console.log(`⏳ Certificate not ready yet, retrying... (${retries}/${maxRetries})`);
          }
        }
      }
      
      if (!thumbprint) {
        console.warn(`⚠️  SSL certificate created but thumbprint not available after ${maxRetries} retries`);
        return { success: true, warning: 'Certificate created but thumbprint not yet available', domain: fullDomain };
      }
      
      return { success: true, alreadyExists: false, domain: fullDomain, thumbprint };
    } catch (error) {
      console.error(`❌ Failed to create SSL certificate for ${fullDomain}:`, error.message);
      return { success: false, error: error.message, domain: fullDomain };
    }
  }

  /**
   * Bind SSL certificate to custom domain
   * @param {string} subdomain - Tenant subdomain
   * @param {string} rootDomain - Root domain
   * @param {string} appName - Azure App Service name
   * @param {string} resourceGroup - Azure Resource Group name
   * @param {string} thumbprint - Certificate thumbprint (optional, will fetch if not provided)
   */
  static async bindSSLCertificate(subdomain, rootDomain, appName, resourceGroup, thumbprint = null) {
    const fullDomain = `${subdomain}.${rootDomain}`;
    
    try {
      // Get thumbprint if not provided
      if (!thumbprint) {
        const { stdout } = await execAsync(
          `az webapp config ssl show --resource-group ${resourceGroup} --certificate-name ${fullDomain} --query thumbprint --output tsv`
        );
        thumbprint = stdout.trim();
        
        if (!thumbprint) {
          return { success: false, error: 'Certificate thumbprint not found', domain: fullDomain };
        }
      }
      
      // Check if already bound
      const { stdout: boundCheck } = await execAsync(
        `az webapp config hostname list --webapp-name ${appName} --resource-group ${resourceGroup} --query "[?name=='${fullDomain}' && sslState=='SniEnabled'].name" --output tsv 2>/dev/null || echo ""`
      );
      
      if (boundCheck.trim() === fullDomain) {
        console.log(`✅ SSL certificate already bound to ${fullDomain}`);
        return { success: true, alreadyBound: true, domain: fullDomain };
      }
      
      // Bind certificate
      await execAsync(
        `az webapp config ssl bind --resource-group ${resourceGroup} --name ${appName} --certificate-thumbprint ${thumbprint} --ssl-type SNI --hostname ${fullDomain}`
      );
      
      console.log(`✅ SSL certificate bound to ${fullDomain}`);
      return { success: true, alreadyBound: false, domain: fullDomain, thumbprint };
    } catch (error) {
      console.error(`❌ Failed to bind SSL certificate to ${fullDomain}:`, error.message);
      return { success: false, error: error.message, domain: fullDomain };
    }
  }

  /**
   * Complete setup: Add custom domain, create SSL, and bind it
   * This is the main function to call after tenant signup
   * @param {string} subdomain - Tenant subdomain
   * @param {Object} options - Configuration options
   */
  static async setupTenantDomain(subdomain, options = {}) {
    const {
      rootDomain = process.env.AZURE_ROOT_DOMAIN || 'doclittle.site',
      appName = process.env.AZURE_APP_NAME || 'doclittle',
      resourceGroup = process.env.AZURE_RESOURCE_GROUP || 'doclittle',
      skipSSL = process.env.AZURE_SKIP_SSL === 'true', // Allow skipping SSL in dev
      maxRetries = 3,
      retryDelayMs = 60000
    } = options;
    
    // Check Azure setup first
    const azureStatus = await this.checkAzureSetup();
    if (!azureStatus.available || !azureStatus.loggedIn) {
      const errorMsg = azureStatus.error || 'Azure CLI not available or not logged in';
      console.warn(`⚠️  Skipping Azure domain setup: ${errorMsg}`);
      return {
        success: false,
        skipped: true,
        reason: errorMsg,
        subdomain
      };
    }
    
    console.log(`🌐 Setting up Azure domain for tenant: ${subdomain}.${rootDomain}`);
    
    const results = {
      subdomain,
      domain: `${subdomain}.${rootDomain}`,
      steps: {}
    };
    
    // Step 1: Add custom domain
    try {
      results.steps.customDomain = await this.addCustomDomain(subdomain, rootDomain, appName, resourceGroup);
      
      if (!results.steps.customDomain.success) {
        return { ...results, success: false, error: 'Failed to add custom domain' };
      }
      
      // Wait a bit for DNS verification (if domain was just added)
      if (!results.steps.customDomain.alreadyExists) {
        console.log('⏳ Waiting 30 seconds for DNS verification...');
        await new Promise(resolve => setTimeout(resolve, 30000));
      }
    } catch (error) {
      console.error(`❌ Error adding custom domain:`, error);
      return { ...results, success: false, error: error.message };
    }
    
    // Step 2: Create SSL certificate (if not skipped)
    if (!skipSSL) {
      try {
        results.steps.sslCertificate = await this.createSSLCertificate(
          subdomain,
          rootDomain,
          appName,
          resourceGroup,
          maxRetries,
          retryDelayMs
        );
        
        if (!results.steps.sslCertificate.success) {
          console.warn(`⚠️  SSL certificate creation failed, but domain is added`);
          results.warning = 'Domain added but SSL certificate creation failed';
        }
      } catch (error) {
        console.error(`❌ Error creating SSL certificate:`, error);
        results.warning = 'Domain added but SSL certificate creation failed';
      }
      
      // Step 3: Bind SSL certificate
      if (results.steps.sslCertificate?.success && results.steps.sslCertificate.thumbprint) {
        try {
          results.steps.sslBinding = await this.bindSSLCertificate(
            subdomain,
            rootDomain,
            appName,
            resourceGroup,
            results.steps.sslCertificate.thumbprint
          );
          
          if (!results.steps.sslBinding.success) {
            console.warn(`⚠️  SSL binding failed, but certificate is created`);
            results.warning = (results.warning || '') + '; SSL binding failed';
          }
        } catch (error) {
          console.error(`❌ Error binding SSL certificate:`, error);
          results.warning = (results.warning || '') + '; SSL binding failed';
        }
      }
    } else {
      console.log(`⏭️  Skipping SSL setup (AZURE_SKIP_SSL=true)`);
      results.steps.sslCertificate = { skipped: true };
      results.steps.sslBinding = { skipped: true };
    }
    
    // Determine overall success
    results.success = results.steps.customDomain?.success && 
                     (skipSSL || results.steps.sslCertificate?.success);
    
    if (results.success) {
      console.log(`✅ Azure domain setup completed for ${subdomain}.${rootDomain}`);
    } else {
      console.warn(`⚠️  Azure domain setup partially completed for ${subdomain}.${rootDomain}`);
    }
    
    return results;
  }
}

module.exports = AzureDomainService;


