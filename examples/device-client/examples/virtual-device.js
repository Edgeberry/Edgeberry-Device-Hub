import { EdgeberryDeviceHubClient } from '../device-client.js';
import { spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

/**
 * Virtual Device Implementation
 * 
 * This example demonstrates a complete virtual device that:
 * - Performs device provisioning with CSR generation
 * - Connects using mTLS with device certificates
 * - Sends realistic telemetry data
 * - Handles direct method calls
 * - Manages device twin properties
 * - Implements proper lifecycle management
 */

class VirtualDevice {
  constructor(options = {}) {
    this.options = {
      // Device identification
      deviceId: options.deviceId || `vd-${Math.random().toString(36).slice(2, 8)}`,
      provisioningUuid: options.provisioningUuid || options.deviceId || `vd-${Math.random().toString(36).slice(2, 8)}`,
      
      // Connection settings
      host: options.host || '127.0.0.1',
      provisioningPort: options.provisioningPort || 8883,
      runtimePort: options.runtimePort || 8883,
      
      // Provisioning API
      provisioningApiBase: options.provisioningApiBase || 'https://127.0.0.1:8080',
      
      // Device metadata
      deviceName: options.deviceName || `Virtual Device ${options.deviceId || 'Unknown'}`,
      deviceModel: options.deviceModel || 'EdgeberryVirtualDevice',
      firmwareVersion: options.firmwareVersion || '1.0.0',
      
      // Telemetry settings
      telemetryInterval: options.telemetryInterval || 5000,
      
      // Certificate paths (optional overrides)
      deviceCertOut: options.deviceCertOut,
      deviceKeyOut: options.deviceKeyOut,
      
      ...options
    };

    this.state = {
      phase: 'initializing', // initializing, provisioning, provisioned, running, error
      provisioned: false,
      connected: false,
      deviceCertPath: null,
      deviceKeyPath: null,
      caPath: null
    };

    this.client = null;
    this.telemetryTimer = null;
    this.sensorData = this.initializeSensorData();
  }

  initializeSensorData() {
    return {
      temperature: { value: 22.0, trend: 0.1 },
      humidity: { value: 50.0, trend: 0.2 },
      pressure: { value: 1013.25, trend: 0.05 },
      cpuUsage: { value: 25.0, trend: 0.5 },
      memoryUsage: { value: 512, trend: 1.0 },
      networkLatency: { value: 10, trend: 0.1 }
    };
  }

  /**
   * Generate RSA key pair and CSR using OpenSSL
   */
  async generateKeyAndCsr() {
    return new Promise((resolve, reject) => {
      const tmpDir = mkdtempSync(path.join(tmpdir(), 'edgeberry-vd-'));
      const keyPath = path.join(tmpDir, `${this.options.provisioningUuid}.key`);
      const csrPath = path.join(tmpDir, `${this.options.provisioningUuid}.csr`);

      // Generate private key
      const genKey = spawn('openssl', ['genrsa', '-out', keyPath, '2048']);
      
      genKey.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Failed to generate private key: exit code ${code}`));
          return;
        }

        // Generate CSR
        const genCsr = spawn('openssl', [
          'req', '-new', '-key', keyPath,
          '-subj', `/CN=${this.options.provisioningUuid}`,
          '-out', csrPath
        ]);

        genCsr.on('close', (code) => {
          if (code !== 0) {
            reject(new Error(`Failed to generate CSR: exit code ${code}`));
            return;
          }

          try {
            const keyPem = readFileSync(keyPath, 'utf8');
            const csrPem = readFileSync(csrPath, 'utf8');
            
            // Store key path for later use
            this.state.deviceKeyPath = this.options.deviceKeyOut || keyPath;
            if (this.options.deviceKeyOut) {
              writeFileSync(this.options.deviceKeyOut, keyPem);
            }

            resolve({ keyPem, csrPem });
          } catch (error) {
            reject(error);
          }
        });

        genCsr.on('error', reject);
      });

      genKey.on('error', reject);
    });
  }

  /**
   * Fetch provisioning certificates from the API
   */
  async fetchProvisioningCertificates() {
    const baseUrl = this.options.provisioningApiBase.replace(/\/$/, '');
    
    try {
      // Try authenticated endpoint first, fallback to public
      const endpoints = [
        `${baseUrl}/api/provisioning/certs`,
        `${baseUrl}/provisioning/certs`
      ];

      let certs = null;
      for (const endpoint of endpoints) {
        try {
          const responses = await Promise.all([
            fetch(`${endpoint}/ca.crt`),
            fetch(`${endpoint}/provisioning.crt`),
            fetch(`${endpoint}/provisioning.key`)
          ]);

          if (responses.every(r => r.ok)) {
            certs = {
              ca: await responses[0].text(),
              cert: await responses[1].text(),
              key: await responses[2].text()
            };
            break;
          }
        } catch (error) {
          console.log(`Failed to fetch from ${endpoint}:`, error.message);
        }
      }

      if (!certs) {
        throw new Error('Failed to fetch provisioning certificates from all endpoints');
      }

      // Validate PEM format
      const isPem = (content) => /-----BEGIN [A-Z ]+-----/.test(content);
      if (!isPem(certs.ca) || !isPem(certs.cert) || !isPem(certs.key)) {
        throw new Error('Invalid certificate format received');
      }

      return certs;
    } catch (error) {
      throw new Error(`Failed to fetch provisioning certificates: ${error.message}`);
    }
  }

  /**
   * Perform device provisioning
   */
  async provisionDevice() {
    console.log('🔧 Starting device provisioning...');
    this.state.phase = 'provisioning';

    try {
      // 1. Fetch provisioning certificates
      console.log('📥 Fetching provisioning certificates...');
      const provCerts = await this.fetchProvisioningCertificates();

      // 2. Generate device key and CSR
      console.log('🔑 Generating device key and CSR...');
      const { csrPem } = await this.generateKeyAndCsr();

      // 3. Create provisioning client
      const provisioningClient = EdgeberryDeviceHubClient.createSecureClient({
        deviceId: this.options.provisioningUuid,
        host: this.options.host,
        port: this.options.provisioningPort,
        ca: Buffer.from(provCerts.ca),
        cert: Buffer.from(provCerts.cert),
        key: Buffer.from(provCerts.key),
        rejectUnauthorized: false // Allow self-signed for development
      });

      // 4. Connect and request provisioning
      await provisioningClient.connect();
      console.log('✅ Connected with provisioning certificates');

      // 5. Send provisioning request
      const provisioningRequest = {
        csrPem,
        name: this.options.deviceName,
        uuid: this.options.provisioningUuid,
        meta: {
          model: this.options.deviceModel,
          firmware: this.options.firmwareVersion,
          startedAt: new Date().toISOString()
        }
      };

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Provisioning timeout'));
        }, 30000);

        // Subscribe to provisioning responses
        const provAccTopic = `$devicehub/devices/${this.options.provisioningUuid}/provision/accepted`;
        const provRejTopic = `$devicehub/devices/${this.options.provisioningUuid}/provision/rejected`;

        provisioningClient.client.subscribe([provAccTopic, provRejTopic], { qos: 1 });

        provisioningClient.client.on('message', (topic, message) => {
          clearTimeout(timeout);
          
          if (topic === provAccTopic) {
            try {
              const response = JSON.parse(message.toString());
              console.log('✅ Provisioning accepted');
              
              if (!response.certPem) {
                reject(new Error('Missing device certificate in response'));
                return;
              }

              // Save device certificate
              const certPath = this.options.deviceCertOut || 
                path.join(tmpdir(), `${this.options.deviceId}.crt`);
              writeFileSync(certPath, response.certPem);
              this.state.deviceCertPath = certPath;

              // Save CA chain if provided
              if (response.caChainPem) {
                const caPath = path.join(tmpdir(), `${this.options.deviceId}-ca.crt`);
                writeFileSync(caPath, response.caChainPem);
                this.state.caPath = caPath;
              }

              this.state.provisioned = true;
              this.state.phase = 'provisioned';
              
              provisioningClient.disconnect();
              resolve(response);
              
            } catch (error) {
              reject(new Error(`Failed to parse provisioning response: ${error.message}`));
            }
          } else if (topic === provRejTopic) {
            const error = message.toString();
            reject(new Error(`Provisioning rejected: ${error}`));
          }
        });

        // Send provisioning request
        const reqTopic = `$devicehub/devices/${this.options.provisioningUuid}/provision/request`;
        provisioningClient.client.publish(reqTopic, JSON.stringify(provisioningRequest), { qos: 1 });
        console.log('📤 Sent provisioning request');
      });

    } catch (error) {
      this.state.phase = 'error';
      throw error;
    }
  }

  /**
   * Start the virtual device runtime
   */
  async start() {
    try {
      console.log(`🚀 Starting virtual device: ${this.options.deviceId}`);

      // Provision device if not already done
      if (!this.state.provisioned) {
        await this.provisionDevice();
      }

      // Create runtime client with device certificates
      console.log('🔌 Connecting with device certificates...');
      this.client = EdgeberryDeviceHubClient.createSecureClient({
        deviceId: this.options.deviceId,
        host: this.options.host,
        port: this.options.runtimePort,
        caPath: this.state.caPath,
        certPath: this.state.deviceCertPath,
        keyPath: this.state.deviceKeyPath,
        rejectUnauthorized: false
      });

      // Set up event handlers
      this.setupEventHandlers();

      // Connect to Device Hub
      await this.client.connect();
      this.state.connected = true;
      this.state.phase = 'running';

      console.log('✅ Virtual device is running');

      // Start telemetry
      this.startTelemetry();

      // Report initial device state
      this.reportDeviceState();

    } catch (error) {
      console.error('❌ Failed to start virtual device:', error.message);
      this.state.phase = 'error';
      throw error;
    }
  }

  /**
   * Set up event handlers for the client
   */
  setupEventHandlers() {
    this.client.on('connected', () => {
      console.log('🔗 Connected to Device Hub');
      
      // Publish online status
      this.client.sendEvent('status', { status: 'online', timestamp: new Date().toISOString() });
    });

    this.client.on('disconnected', () => {
      console.log('🔌 Disconnected from Device Hub');
      this.state.connected = false;
    });

    this.client.on('error', (error) => {
      console.error('❌ Client error:', error.message);
    });

    // Handle direct method calls
    this.client.on('directMethod', ({ methodName, requestId, payload, respond }) => {
      this.handleDirectMethod(methodName, payload, respond);
    });

    // Handle twin desired property changes
    this.client.on('twinDesired', (properties) => {
      this.handleTwinDesired(properties);
    });
  }

  /**
   * Handle direct method calls
   */
  async handleDirectMethod(methodName, payload, respond) {
    console.log(`📞 Direct method: ${methodName}`);

    try {
      switch (methodName) {
        case 'identify':
          console.log('🔍 Device identification requested');
          respond({
            status: 200,
            payload: {
              message: 'Virtual device identified',
              deviceId: this.options.deviceId,
              model: this.options.deviceModel,
              firmware: this.options.firmwareVersion
            }
          });
          break;

        case 'getStatus':
          respond({
            status: 200,
            payload: {
              phase: this.state.phase,
              connected: this.state.connected,
              uptime: process.uptime(),
              memoryUsage: process.memoryUsage(),
              sensorData: this.getCurrentSensorReadings()
            }
          });
          break;

        case 'updateTelemetryInterval':
          const newInterval = payload.interval;
          if (newInterval && newInterval >= 1000) {
            this.options.telemetryInterval = newInterval;
            this.restartTelemetry();
            respond({
              status: 200,
              payload: { message: `Telemetry interval updated to ${newInterval}ms` }
            });
          } else {
            respond({
              status: 400,
              payload: { error: 'Invalid interval (minimum 1000ms)' }
            });
          }
          break;

        case 'reboot':
          console.log('🔄 Reboot requested');
          respond({
            status: 200,
            payload: { message: 'Reboot initiated' }
          });
          
          // Simulate reboot
          setTimeout(async () => {
            await this.simulateReboot();
          }, 2000);
          break;

        default:
          respond({
            status: 404,
            payload: { error: `Unknown method: ${methodName}` }
          });
      }
    } catch (error) {
      respond({
        status: 500,
        payload: { error: error.message }
      });
    }
  }

  /**
   * Handle twin desired property changes
   */
  handleTwinDesired(properties) {
    console.log('🔄 Twin desired properties:', properties);

    // Update local configuration based on desired properties
    if (properties.telemetryInterval) {
      this.options.telemetryInterval = properties.telemetryInterval;
      this.restartTelemetry();
    }

    // Report back the acknowledged properties
    this.client.updateTwinReported({
      ...properties,
      lastUpdated: new Date().toISOString(),
      acknowledgedAt: new Date().toISOString()
    });
  }

  /**
   * Start sending telemetry data
   */
  startTelemetry() {
    if (this.telemetryTimer) {
      clearInterval(this.telemetryTimer);
    }

    this.telemetryTimer = setInterval(() => {
      if (this.state.connected) {
        const telemetryData = this.generateTelemetryData();
        this.client.sendTelemetry(telemetryData);
      }
    }, this.options.telemetryInterval);

    console.log(`📊 Telemetry started (interval: ${this.options.telemetryInterval}ms)`);
  }

  /**
   * Restart telemetry with new interval
   */
  restartTelemetry() {
    console.log(`🔄 Restarting telemetry with interval: ${this.options.telemetryInterval}ms`);
    this.startTelemetry();
  }

  /**
   * Generate realistic telemetry data
   */
  generateTelemetryData() {
    // Update sensor values with realistic variations
    this.updateSensorData();

    return {
      timestamp: new Date().toISOString(),
      deviceId: this.options.deviceId,
      sensors: this.getCurrentSensorReadings(),
      system: {
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        cpuUsage: this.sensorData.cpuUsage.value,
        networkLatency: this.sensorData.networkLatency.value
      },
      metadata: {
        firmware: this.options.firmwareVersion,
        model: this.options.deviceModel
      }
    };
  }

  /**
   * Update sensor data with realistic variations
   */
  updateSensorData() {
    const time = Date.now() / 1000;

    // Temperature with daily cycle and noise
    this.sensorData.temperature.value = 22 + 
      Math.sin(time / 3600) * 5 + // Hourly variation
      (Math.random() - 0.5) * 2; // Noise

    // Humidity with inverse temperature correlation
    this.sensorData.humidity.value = Math.max(20, Math.min(80, 
      60 - (this.sensorData.temperature.value - 22) * 2 + 
      (Math.random() - 0.5) * 10
    ));

    // Pressure with slow variations
    this.sensorData.pressure.value = 1013.25 + 
      Math.sin(time / 7200) * 10 + 
      (Math.random() - 0.5) * 2;

    // CPU usage with spikes
    this.sensorData.cpuUsage.value = Math.max(5, Math.min(95,
      25 + Math.sin(time / 300) * 20 + 
      (Math.random() > 0.9 ? Math.random() * 40 : 0) + // Occasional spikes
      (Math.random() - 0.5) * 10
    ));

    // Memory usage with gradual increase
    this.sensorData.memoryUsage.value += (Math.random() - 0.48) * 5; // Slight upward trend
    this.sensorData.memoryUsage.value = Math.max(100, Math.min(2048, this.sensorData.memoryUsage.value));

    // Network latency with occasional spikes
    this.sensorData.networkLatency.value = Math.max(1, 
      10 + (Math.random() > 0.95 ? Math.random() * 100 : 0) + // Occasional high latency
      (Math.random() - 0.5) * 5
    );
  }

  /**
   * Get current sensor readings
   */
  getCurrentSensorReadings() {
    return {
      temperature: Math.round(this.sensorData.temperature.value * 100) / 100,
      humidity: Math.round(this.sensorData.humidity.value * 100) / 100,
      pressure: Math.round(this.sensorData.pressure.value * 100) / 100
    };
  }

  /**
   * Report initial device state
   */
  reportDeviceState() {
    this.client.updateTwinReported({
      deviceInfo: {
        model: this.options.deviceModel,
        firmware: this.options.firmwareVersion,
        deviceId: this.options.deviceId,
        name: this.options.deviceName
      },
      configuration: {
        telemetryInterval: this.options.telemetryInterval
      },
      status: {
        phase: this.state.phase,
        connected: this.state.connected,
        provisioned: this.state.provisioned,
        startupTime: new Date().toISOString()
      }
    });
  }

  /**
   * Simulate device reboot
   */
  async simulateReboot() {
    console.log('🔄 Simulating reboot...');
    
    // Send offline status
    this.client.sendEvent('status', { status: 'rebooting', timestamp: new Date().toISOString() });
    
    // Stop telemetry
    if (this.telemetryTimer) {
      clearInterval(this.telemetryTimer);
      this.telemetryTimer = null;
    }

    // Disconnect
    await this.client.disconnect();
    
    // Wait for "reboot"
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Reconnect
    await this.client.connect();
    
    // Restart telemetry
    this.startTelemetry();
    
    // Send online status
    this.client.sendEvent('status', { status: 'online', timestamp: new Date().toISOString() });
    
    console.log('✅ Reboot completed');
  }

  /**
   * Stop the virtual device
   */
  async stop() {
    console.log('🛑 Stopping virtual device...');

    if (this.telemetryTimer) {
      clearInterval(this.telemetryTimer);
      this.telemetryTimer = null;
    }

    if (this.client && this.state.connected) {
      // Send offline status
      this.client.sendEvent('status', { status: 'offline', timestamp: new Date().toISOString() });
      
      // Update twin with offline status
      this.client.updateTwinReported({
        status: {
          phase: 'offline',
          connected: false,
          shutdownTime: new Date().toISOString()
        }
      });

      await this.client.disconnect();
    }

    this.state.connected = false;
    this.state.phase = 'stopped';
    
    console.log('✅ Virtual device stopped');
  }
}

// Example usage and CLI
async function runVirtualDevice() {
  const deviceId = process.env.DEVICE_ID || `vd-${Math.random().toString(36).slice(2, 8)}`;
  
  const device = new VirtualDevice({
    deviceId,
    provisioningUuid: process.env.PROV_UUID || deviceId,
    host: process.env.MQTT_HOST || '127.0.0.1',
    provisioningApiBase: process.env.PROV_API_BASE || 'https://127.0.0.1:8080',
    telemetryInterval: parseInt(process.env.TELEMETRY_INTERVAL) || 5000,
    deviceName: process.env.DEVICE_NAME || `Virtual Device ${deviceId}`,
    deviceModel: process.env.DEVICE_MODEL || 'EdgeberryVirtualDevice',
    firmwareVersion: process.env.FIRMWARE_VERSION || '1.0.0'
  });

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down virtual device...');
    await device.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n🛑 Terminating virtual device...');
    await device.stop();
    process.exit(0);
  });

  try {
    await device.start();
    console.log('✨ Virtual device is running. Press Ctrl+C to stop.');
  } catch (error) {
    console.error('❌ Failed to start virtual device:', error.message);
    process.exit(1);
  }
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runVirtualDevice().catch(console.error);
}

export { VirtualDevice };
export default runVirtualDevice;
