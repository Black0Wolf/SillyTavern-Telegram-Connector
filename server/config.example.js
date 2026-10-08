// config.example.js
// Telegram Bot config example
// Usage: copy this file to config.js, then edit the settings below

module.exports = {
    // Replace with your own Telegram Bot Token
    telegramToken: 'YOUR_TELEGRAM_BOT_TOKEN_HERE',

    // WebSocket server port
    wssPort: 2333,

    // Whitelist of Telegram user IDs allowed to interact with the bot
    // Add your own Telegram User ID (and any other user IDs you allow) to the array.
    // You can get your ID by chatting with @userinfobot on Telegram.
    // An empty array `[]` means all users are allowed.
    // Example: [123456789, 987654321]
    allowedUserIds: []
};
