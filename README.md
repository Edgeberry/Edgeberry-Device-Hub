![Edgeberry Banner](https://raw.githubusercontent.com/Edgeberry/.github/main/brand/Edgeberry_banner_device_hub.png)

<img src="documentation/devicehub.png" align="right" width="50%"/>

**A self-hostable device management service for Edgeberry devices.**

**Edgeberry Device Hub** is the single control plane for your Edgeberry fleet — a dashboard and API to onboard devices, manage their digital twins, and observe the system in real time.

**Keep your data private** • **Add devices instantly** • **Stay secure by default** • **Monitor your fleet** • **Control remotely** • **Troubleshoot easily** • **Integrate anywhere** • **Run offline** • **Scale as needed**

<br clear="right"/>

## Installation
Turn your `Debian` system into an **Edgeberry Device Hub**:
```bash
wget -O install.sh https://github.com/Edgeberry/Edgeberry-Device-Hub/releases/latest/download/install.sh;
chmod +x ./install.sh;
sudo ./install.sh -y;
```

## What You Get

**Web Dashboard**: A modern, responsive interface to manage your entire device fleet from any browser. Monitor device status, view telemetry data, and control devices remotely.

**Secure Device Onboarding**: Automatically provision new devices with certificates and secure connections. Simply add device UUIDs to the whitelist and devices connect automatically.

**Real-time Monitoring**: See device status, telemetry data, and system health in real-time. Get instant notifications when devices go online or offline.

**Device Management**: Organize devices, update configurations, and perform remote actions like reboots or firmware updates through the intuitive web interface.

**Data Privacy**: All data stays on your infrastructure. No cloud dependencies, no data sharing with third parties.

## Key Features

**Device Fleet Overview**: View all your devices at a glance with real-time status indicators, search and filter capabilities, and organized tile or list views.

**Secure Device Provisioning**: Add devices to your whitelist individually or in batches. Devices automatically receive certificates and connect securely.

**System Health Monitoring**: Built-in diagnostics show system performance, service status, and health metrics with visual indicators and alerts.

**Remote Device Control**: Send commands to devices, update configurations, and manage device lifecycles directly from the web interface.

**Data Visualization**: View device telemetry data, event history, and system metrics with real-time charts and historical trends.

## Getting Started

After installation, access your Device Hub at `http://your-server-ip` to:

1. **Add Device UUIDs**: Use the admin panel to add device UUIDs to the whitelist
2. **Connect Devices**: Devices with whitelisted UUIDs will automatically provision and connect
3. **Monitor Fleet**: View device status, telemetry, and system health in real-time
4. **Manage Remotely**: Send commands, update configurations, and control devices

> **First Login**: Default admin credentials are created during installation. Change them immediately after first login.

## Updates & Maintenance

The Device Hub automatically preserves your data (certificates, device registry, telemetry history) during updates. Simply run the installer again to update to the latest version:

```bash
wget -O install.sh https://github.com/Edgeberry/Edgeberry-Device-Hub/releases/latest/download/install.sh
sudo bash install.sh -y
```

**System Requirements:**
- Debian/Ubuntu Linux system
- 1GB RAM minimum (2GB recommended)
- 10GB disk space
- Network connectivity for device communication

## Integration & Development

Connect your applications and devices using our client libraries:

**For Device Integration:**
```bash
npm install @edgeberry/devicehub-device-client
```
Build IoT devices that automatically connect, send telemetry, and respond to remote commands.

**For Application Integration:**
```bash
npm install @edgeberry/devicehub-app-client
```
Create dashboards, monitoring tools, or integrate with existing systems using REST API and WebSocket connections.

**Node-RED Integration:**
Visual programming nodes for drag-and-drop device integration and data processing workflows.

> **Documentation**: See `documentation/alignment.md` for detailed API references, architecture details, and development guides.

## License & Collaboration
**Copyright 2025 Sanne 'SpuQ' Santens**. The Edgeberry Device Hub project is licensed under the **[GNU GPLv3](LICENSE.txt)**. The [Rules & Guidelines](https://github.com/Edgeberry/.github/blob/main/brand/Edgeberry_Trademark_Rules_and_Guidelines.md) apply to the usage of the Edgeberry brand.

### Collaboration

If you'd like to contribute to this project, please follow these guidelines:
1. Fork the repository and create your branch from `main`.
2. Make your changes and ensure they adhere to the project's coding style and conventions.
3. Test your changes thoroughly.
4. Ensure your commits are descriptive and well-documented.
5. Open a pull request, describing the changes you've made and the problem or feature they address.