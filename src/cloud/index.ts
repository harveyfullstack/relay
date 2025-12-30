/**
 * Agent Relay Cloud - Main Entry Point
 *
 * One-click server provisioning for AI agent orchestration.
 */

export { createServer } from './server.js';
export { getConfig, loadConfig, CloudConfig } from './config.js';

// Services
export { CredentialVault } from './vault/index.js';
export { WorkspaceProvisioner, ProvisionConfig, Workspace, WorkspaceStatus } from './provisioner/index.js';

// Billing
export * from './billing/index.js';

// Run if executed directly
if (require.main === module) {
  (async () => {
    try {
      const { createServer } = await import('./server.js');
      const server = await createServer();
      await server.start();

      // Graceful shutdown
      const shutdown = async () => {
        console.log('\nShutting down...');
        await server.stop();
        process.exit(0);
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    } catch (error) {
      console.error('Failed to start server:', error);
      process.exit(1);
    }
  })();
}
