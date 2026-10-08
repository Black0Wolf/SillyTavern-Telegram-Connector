## About This Project
Sorry — due to increasingly busy work and life commitments, I may no longer be able to maintain this project.  
This project's code is fully open source; anyone is welcome to fork it at any time for their own development and improvements.  
If you are interested in this project, feel free to use it as the starting point for your own project, no extra permission needed.  
Thank you for your understanding and support.

# SillyTavern Telegram Connector

SillyTavern Telegram Connector is an extension designed for SillyTavern that lets users interact with AI characters in SillyTavern via Telegram. The extension bridges SillyTavern and a Telegram bot, so users can chat with their favorite AI characters anytime, anywhere from a mobile device.  
[![License](https://img.shields.io/github/license/qiqi20020612/SillyTavern-Telegram-Connector)](https://github.com/qiqi20020612/SillyTavern-Telegram-Connector/blob/main/LICENSE)
[![stars](https://img.shields.io/github/stars/qiqi20020612/SillyTavern-Telegram-Connector)](https://github.com/qiqi20020612/SillyTavern-Telegram-Connector)

## Features

- **Telegram integration**: chat with AI characters in SillyTavern through the Telegram app
- **Real-time sync**: conversations in Telegram sync to the SillyTavern UI in real time, and vice versa
- **Command support**: a variety of Telegram commands for managing chats and characters
  - `/help` - show all available commands
  - `/new` - start a new chat
  - `/listchars` - list all available characters
  - `/switchchar <character name>` - switch to the specified character
  - `/listchats` - list all chat histories for the current character
  - `/switchchat <chat name>` - switch to the specified chat history
- **Simple setup**: connects over WebSocket, easy to set up and use

## Installation and Usage

### Extension installation

1. In SillyTavern, navigate to the "Extensions" tab
2. Click "Install Extension"
3. Enter the following URL: `https://github.com/qiqi20020612/SillyTavern-Telegram-Connector`
4. Click the "Install" button
5. After installation, restart SillyTavern

### Server setup

1. Clone or download this repository to your computer
2. Enter the `server` directory
3. Install dependencies:
   ```
   npm install node-telegram-bot-api ws
   ```
4. Copy the `config.example.js` file to `config.js`:
   ```
   cp config.example.js config.js
   ```
   Or on Windows:
   ```
   copy config.example.js config.js
   ```
5. Edit the `config.js` file, replacing `YOUR_TELEGRAM_BOT_TOKEN_HERE` with your Telegram Bot Token
   (you can get one from [@BotFather](https://t.me/BotFather) on Telegram)
6. Start the server:
   ```
   node server.js
   ```

### Connection setup

1. In SillyTavern, go to the "Extensions" tab
2. Find the "Telegram Connector" section
3. Enter the WebSocket server address in the "Bridge Server WebSocket URL" field
   (default is `ws://127.0.0.1:2333`)
4. Click the "Connect" button
5. Once the status shows "Connected", you're ready to go

### Using Telegram

1. In Telegram, search for and start a conversation with the bot you created
2. Send any message to start chatting
3. Your message is forwarded to SillyTavern, and the AI's reply is sent back to Telegram automatically
4. Use the `/help` command to see all available commands

## System Requirements

- Node.js 14.0 or higher
- A running SillyTavern instance
- Internet connection (for the Telegram API)
- If the server is publicly accessible, HTTPS/WSS is recommended

## Troubleshooting

- **Connection issues**: make sure the WebSocket server is running and the URL is configured correctly
- **Bot not responding**: check that the Telegram Bot Token is correct and look for errors in the server logs
- **Messages out of sync**: make sure the SillyTavern extension is connected to the WebSocket server

## Support and Contributing

If you run into issues or have suggestions, reach out via:

- Open a GitHub Issue
- Contact the author: ZMou
- Author's homepage: https://zmoutech.cn

Pull Requests to improve this extension are welcome!

## License

This project is licensed under the GNU General Public License v3.0 (GPL-3.0) — see the LICENSE file for details.

## TODO

- **Group chat enhancements**:
  - [ ] Respond to messages that @mention the bot in group chats

- **Media support**:
  - [ ] Support sending images

- **Message formatting**:
  - [ ] Implement Markdown escaping
  - [ ] Parse bot messages as HTML instead

- **Architecture improvements**:
  - [x] Commands are handled by the server; the frontend no longer parses commands
  - [ ] Convert the server into a standard server-side plugin following the [SillyTavern server plugin spec](https://docs.sillytavern.app/for-contributors/server-plugins/)

- **UX improvements**:
  - [x] Tuned the frequency of message edits
  - [x] Streaming optimization: only show the initial message after enough characters have been generated
  - [ ] Keep the "typing" status active for the whole streaming response
  - [x] New `/ping` command to check Bridge and SillyTavern connection status anytime

- **Settings menu**:
  - [ ] Add a whitelist setting to the extension settings page
  - [ ] Control whether web activities such as character switches send notifications to Telegram

- **Error handling & stability**:
  - [ ] `/exit` command always reports "exit operation timed out, process force-exited"
  - [x] Handle the "stop generation" button click in ST (GENERATION_STOPPED instead of GENERATION_ENDED)
  - [ ] Handle new messages arriving mid-generation (intercept them and tell the user generation is in progress instead of submitting to ST)
  - [ ] After `/switchchar` or `/switchchat`, notify the server to clear old cached state

- **Technical optimizations**:
  - [ ] Implement a WebSocket heartbeat to detect whether the browser is alive
  - [ ] Improve the setTimeout-based waiting for DOM updates
