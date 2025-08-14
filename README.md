![Edgeberry Banner](https://raw.githubusercontent.com/Edgeberry/.github/main/brand/Edgeberry_banner_fleethub.png)

**A self-hostable device management service for Edgeberry devices.**

**Edgeberry Fleet Hub** acts as the central coordination layer in the Edgeberry ecosystem. It provides a structured way to onboard, monitor, and interact with your fleet of Edgeberry devices - serving as the interface between physical devices and their digital presence.

It’s designed to be lightweight, transparent, and fully under your control.

## Getting Started
[ToDo]

## Description

Edgeberry Fleet Hub is a self-hostable device management server for Edgeberry devices. It provides a single, secure control plane to provision devices (MQTT + mTLS), observe telemetry, manage digital twins, and expose a clean HTTP API and UI. Internally, independent microservices communicate over D-Bus; devices communicate via MQTT.

## Microservices

- **API (`api/`)**
  - Public HTTP surface for the Fleet Hub. Handles authn/z, exposes REST and WebSocket endpoints, talks to internal services over D-Bus, and attributes MQTT events to devices.

- **Provisioning Service (`provisioning-service/`)**
  - Handles bootstrap and certificate lifecycle via MQTT-only CSR flow. Subscribes to `$fleethub/certificates/create-from-csr`, signs CSRs, and returns signed certs. No digital twin responsibilities.

- **Device Twin Service (`twin-service/`)**
  - Owns desired/reported twin state. Persists state, generates deltas, and publishes twin updates over `$fleethub/devices/{deviceId}/twin/#`. Provides D-Bus methods for the API to read/update twin state.

- **Device Registry Service (`registry-service/`)**
  - Authoritative inventory for devices. Stores identity anchors (device ID, cert metadata, optional manufacturer UUID hash), status, and operational context. Exposes a D-Bus interface to query/update registry data.

- **Web UI (`fleet-hub-ui/`)**
  - React SPA for dashboards, devices, events, and twin management. Consumes only public API/WebSocket endpoints.

See `alignment.md` for architecture and interface details.

## License & Collaboration
**Copyright 2024 Sanne 'SpuQ' Santens**. The Edgeberry Fleet Hub project is licensed under the **[GNU GPLv3](LICENSE.txt)**. The [Rules & Guidelines](https://github.com/Edgeberry/.github/blob/main/brand/Edgeberry_Trademark_Rules_and_Guidelines.md) apply to the usage of the Edgeberry brand.

### Collaboration

If you'd like to contribute to this project, please follow these guidelines:
1. Fork the repository and create your branch from `main`.
2. Make your changes and ensure they adhere to the project's coding style and conventions.
3. Test your changes thoroughly.
4. Ensure your commits are descriptive and well-documented.
5. Open a pull request, describing the changes you've made and the problem or feature they address.