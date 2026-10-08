# Telegram Bridge Server

This is the server-side component of the SillyTavern Telegram Connector. It bridges the Telegram bot and the SillyTavern extension.

## Features

- Receive messages from Telegram users and forward them to SillyTavern
- Receive AI replies from SillyTavern and forward them back to Telegram
- Handle special commands such as character switching and chat management
- Maintain WebSocket connection state

## Installation

### Prerequisites

- Node.js 14.0 or higher
- A created Telegram bot and its Bot Token

### Setup steps

1. Install dependencies:
   ```bash
   npm install node-telegram-bot-api ws
   ```

2. Configure:
   - Copy the `config.example.js` file to `config.js`:
   ```bash
   # Linux/macOS
   cp ../config.example.js ../config.js

   # Windows
   copy ..\config.example.js ..\config.js
   ```
   - Edit the `config.js` file, replacing `telegramToken` with your Telegram Bot Token
   - To change the default port (2333), modify the `wssPort` setting

3. Start the server:
   ```bash
   node server.js
   ```

## Usage

After the server starts, the console shows:
- `Telegram Bot started...`
- `WebSocket server listening on port XXXX...`

When the SillyTavern extension connects, it shows:
- `SillyTavern extension connected!`

### Security notes

- By default, the server only accepts local connections. For remote access, consider:
  - Encrypting connections with HTTPS/WSS
  - Implementing proper authentication
  - Restricting IP access
  - Keeping the `config.js` file private (already covered by .gitignore)

- Do not publicly share code containing your Bot Token

## Troubleshooting

- **Server won't start**: check whether the port is occupied and Node.js is installed correctly
- **Config file not found**: make sure you copied `config.example.js` to `config.js` in the right location
- **Telegram Bot not responding**: verify the Bot Token is correct and check the Telegram API connection
- **WebSocket connection failed**: make sure the firewall isn't blocking the port, and check the network setup

## Developer info

To modify or extend the server, the main file is `server.js`, which contains:
- WebSocket server setup
- Telegram Bot initialization and message handling
- Command parsing and handling logic

Config now lives in the `config.js` file in the project root directory, including:
- Telegram Bot Token
- WebSocket server port
