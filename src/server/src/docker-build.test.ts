import { execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';

describe('Docker Build Tests', () => {
  const projectRoot = path.resolve(__dirname, '../../..');
  
  // Skip tests if Docker is not available
  const dockerAvailable = (): boolean => {
    try {
      execSync('docker --version', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  };

  beforeAll(() => {
    if (!dockerAvailable()) {
      console.warn('Docker is not available. Skipping Docker build tests.');
    }
  });

  // Run Docker tests serially to avoid race conditions
  // Jest will run tests in this describe block sequentially
  // Note: Client is now built into nginx image, so no separate Dockerfile.client test

  describe('Dockerfile.server', () => {
    it('should build successfully', () => {
      if (!dockerAvailable()) {
        return; // Skip test if Docker is not available
      }

      const dockerfilePath = path.join(projectRoot, 'Dockerfile.server');
      expect(existsSync(dockerfilePath)).toBe(true);

      let buildError: Error | null = null;
      try {
        execSync(
          `docker build -f ${dockerfilePath} -t livescore-server-test:test .`,
          { 
            cwd: projectRoot,
            stdio: 'pipe',
            timeout: 300000 // 5 minutes timeout
          }
        );
        
        // Verify image was created
        const images = execSync('docker images livescore-server-test:test --format "{{.Repository}}:{{.Tag}}"', {
          encoding: 'utf-8'
        });
        const imageName = images.trim();
        if (!imageName || imageName !== 'livescore-server-test:test') {
          buildError = new Error(`Image verification failed. Expected 'livescore-server-test:test', got '${imageName}'`);
        }
      } catch (error: unknown) {
        buildError = error instanceof Error ? error : new Error(String(error));
      } finally {
        // Always cleanup, ignore cleanup errors
        try {
          execSync('docker rmi livescore-server-test:test', { stdio: 'ignore' });
        } catch {
          // Ignore cleanup errors
        }
      }
      
      if (buildError) {
        throw new Error(`Dockerfile.server build failed: ${buildError.message}`);
      }
    });
  });

  describe('Dockerfile.nginx', () => {
    it('should build successfully', () => {
      if (!dockerAvailable()) {
        return; // Skip test if Docker is not available
      }

      const dockerfilePath = path.join(projectRoot, 'Dockerfile.nginx');
      expect(existsSync(dockerfilePath)).toBe(true);

      let buildError: Error | null = null;
      try {
        execSync(
          `docker build -f ${dockerfilePath} -t livescore-nginx-test:test .`,
          { 
            cwd: projectRoot,
            stdio: 'pipe',
            timeout: 300000 // 5 minutes timeout
          }
        );
        
        // Verify image was created
        const images = execSync('docker images livescore-nginx-test:test --format "{{.Repository}}:{{.Tag}}"', {
          encoding: 'utf-8'
        });
        const imageName = images.trim();
        if (!imageName || imageName !== 'livescore-nginx-test:test') {
          buildError = new Error(`Image verification failed. Expected 'livescore-nginx-test:test', got '${imageName}'`);
        }
      } catch (error: unknown) {
        buildError = error instanceof Error ? error : new Error(String(error));
      } finally {
        // Always cleanup, ignore cleanup errors
        try {
          execSync('docker rmi livescore-nginx-test:test', { stdio: 'ignore' });
        } catch {
          // Ignore cleanup errors
        }
      }
      
      if (buildError) {
        throw new Error(`Dockerfile.nginx build failed: ${buildError.message}`);
      }
    });
  });
});
