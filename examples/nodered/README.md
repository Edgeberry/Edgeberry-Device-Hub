# node-red-contrib-edgeberry-hub

Node-RED nodes for Edgeberry Device Hub integration.

## Installation

Install via npm:

```bash
npm install node-red-contrib-edgeberry-hub
```

Or install directly from the Node-RED palette manager:
1. Open Node-RED
2. Go to Menu → Manage palette
3. Search for `node-red-contrib-edgeberry-hub`
4. Click Install

## Nodes

### Edgeberry Device

The **Edgeberry Device** node provides integration with Edgeberry Device Hub instances.

#### Configuration

The node requires the following configuration:

- **Name** *(optional)*: A descriptive name for this node instance
- **Host** *(required)*: The Device Hub endpoint URL (e.g., `https://devicehub.local` or `https://devicehub.example.com`)
- **Device ID** *(required)*: The identifier of the device this node represents (e.g., `device-001`)
- **Host Access Token** *(required)*: Authentication token for Device Hub API access *(stored as credential)*

> **Note**: Access token functionality is not yet implemented in the current version.

#### Usage

1. Drag the **Edgeberry Device** node from the **Edgeberry Hub** category in the palette
2. Double-click to configure the required fields
3. Connect input and output as needed in your flow
4. Deploy the flow

#### Current Behavior

- Logs "hello world" message when receiving input
- Passes input messages through unchanged
- Validates configuration on startup

## License & Collaboration
**Copyright 2025 Sanne 'SpuQ' Santens**. The Edgeberry Device Hub project is licensed under the **GNU GPLv3**. The [Rules & Guidelines](https://github.com/Edgeberry/.github/blob/main/brand/Edgeberry_Trademark_Rules_and_Guidelines.md) apply to the usage of the Edgeberry brand.

### Collaboration

If you'd like to contribute to this project, please follow these guidelines:
1. Fork the repository and create your branch from `main`.
2. Make your changes and ensure they adhere to the project's coding style and conventions.
3. Test your changes thoroughly.
4. Ensure your commits are descriptive and well-documented.
5. Open a pull request, describing the changes you've made and the problem or feature they address.
