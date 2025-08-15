import { connect, IClientOptions, MqttClient } from 'mqtt';

// Simple virtual device that:
// 1) Connects to MQTT broker
// 2) Sends provisioning request to $devicehub/devices/{deviceId}/provision/request
// 3) On accepted, publishes periodic telemetry to devices/{deviceId}/telemetry

const MQTT_URL = process.env.MQTT_URL || 'mqtt://localhost:1883';
const MQTT_USERNAME = process.env.MQTT_USERNAME;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD;
const DEVICE_ID = process.env.DEVICE_ID || `vd-${Math.random().toString(36).slice(2, 8)}`;
const TELEMETRY_PERIOD_MS = Number(process.env.TELEMETRY_PERIOD_MS || 3000);

function start() {
  const opts: IClientOptions = {
    username: MQTT_USERNAME,
    password: MQTT_PASSWORD,
    protocolVersion: 5,
    reconnectPeriod: 2000,
    clean: true,
  };
  const client: MqttClient = connect(MQTT_URL, opts);

  let provisioned = false;
  let telemetryTimer: NodeJS.Timeout | null = null;

  const provReqTopic = `$devicehub/devices/${DEVICE_ID}/provision/request`;
  const provAccTopic = `$devicehub/devices/${DEVICE_ID}/provision/accepted`;
  const provRejTopic = `$devicehub/devices/${DEVICE_ID}/provision/rejected`;

  client.on('connect', () => {
    console.log(`[virtual-device] connected → ${MQTT_URL} as ${DEVICE_ID}`);
    // Subscribe to provisioning responses
    client.subscribe([provAccTopic, provRejTopic], { qos: 1 }, (err) => {
      if (err) console.error('[virtual-device] subscribe error', err);
      // Send provisioning request
      const provisionPayload: any = {
        name: `Virtual Device ${DEVICE_ID}`,
        token: process.env.DEVICE_TOKEN || undefined,
        meta: { model: 'simulator', firmware: '0.0.1', startedAt: new Date().toISOString() },
      };
      const uuid = process.env.PROV_UUID || process.env.UUID;
      if (uuid) provisionPayload.uuid = uuid;
      console.log(`[virtual-device] -> ${provReqTopic} ${JSON.stringify(provisionPayload)}`);
      client.publish(provReqTopic, JSON.stringify(provisionPayload), { qos: 1 });
    });
  });

  client.on('message', (topic, payload) => {
    if (topic === provAccTopic) {
      console.log(`[virtual-device] <- accepted: ${payload.toString()}`);
      if (!provisioned) {
        provisioned = true;
        // Start telemetry loop
        const teleTopic = `devices/${DEVICE_ID}/telemetry`;
        telemetryTimer = setInterval(() => {
          const m = {
            ts: Date.now(),
            temperature: 20 + Math.random() * 5,
            voltage: 3.3 + Math.random() * 0.1,
            status: 'ok',
          };
          client.publish(teleTopic, JSON.stringify(m), { qos: 0 });
          console.log(`[virtual-device] -> ${teleTopic} ${JSON.stringify(m)}`);
        }, TELEMETRY_PERIOD_MS);
      }
    } else if (topic === provRejTopic) {
      console.error(`[virtual-device] <- rejected: ${payload.toString()}`);
    }
  });

  client.on('error', (err) => {
    console.error('[virtual-device] error', err);
  });

  client.on('close', () => {
    console.log('[virtual-device] connection closed');
  });

  function shutdown() {
    console.log('[virtual-device] shutting down...');
    if (telemetryTimer) { clearInterval(telemetryTimer); telemetryTimer = null; }
    try { client.end(true, {}, () => process.exit(0)); } catch { process.exit(0); }
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start();
