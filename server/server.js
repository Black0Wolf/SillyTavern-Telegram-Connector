// server.js
const TelegramBot = require('node-telegram-bot-api');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

// 添加日志记录函数，带有时间戳
function logWithTimestamp(level, ...args) {
    const now = new Date();

    // 使用本地时区格式化时间
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');

    const timestamp = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    const prefix = `[${timestamp}]`;

    switch (level) {
        case 'error':
            console.error(prefix, ...args);
            break;
        case 'warn':
            console.warn(prefix, ...args);
            break;
        default:
            console.log(prefix, ...args);
    }
}

// 重启保护 - 防止循环重启
const RESTART_PROTECTION_FILE = path.join(__dirname, '.restart_protection');
const MAX_RESTARTS = 3;
const RESTART_WINDOW_MS = 60000; // 1分钟

// 检查是否可能处于循环重启状态
function checkRestartProtection() {
    try {
        if (fs.existsSync(RESTART_PROTECTION_FILE)) {
            const data = JSON.parse(fs.readFileSync(RESTART_PROTECTION_FILE, 'utf8'));
            const now = Date.now();

            // 清理过期的重启记录
            data.restarts = data.restarts.filter(time => now - time < RESTART_WINDOW_MS);

            // 添加当前重启时间
            data.restarts.push(now);

            // 如果在时间窗口内重启次数过多，则退出
            if (data.restarts.length > MAX_RESTARTS) {
                logWithTimestamp('error', `Possible restart loop detected! Restarted ${data.restarts.length} times within ${RESTART_WINDOW_MS / 1000} seconds.`);
                logWithTimestamp('error', 'Exiting to prevent resource exhaustion. Please investigate and fix the issue before starting again.');

                // 如果有通知chatId，尝试发送错误消息
                if (process.env.RESTART_NOTIFY_CHATID) {
                    const chatId = parseInt(process.env.RESTART_NOTIFY_CHATID);
                    if (!isNaN(chatId)) {
                        // 创建临时bot发送错误消息
                        try {
                            const tempBot = new TelegramBot(require('./config').telegramToken, { polling: false });
                            tempBot.sendMessage(chatId, 'Restart loop detected! The server has stopped to prevent resource exhaustion. Please investigate the issue manually.')
                                .finally(() => process.exit(1));
                        } catch (e) {
                            process.exit(1);
                        }
                        return; // 等待消息发送后退出
                    }
                }

                process.exit(1);
            }

            // 保存更新后的重启记录
            fs.writeFileSync(RESTART_PROTECTION_FILE, JSON.stringify(data));
        } else {
            // 创建新的重启保护文件
            fs.writeFileSync(RESTART_PROTECTION_FILE, JSON.stringify({ restarts: [Date.now()] }));
        }
    } catch (error) {
        logWithTimestamp('error', 'Restart protection check failed:', error);
        // 出错时继续执行，不要阻止服务器启动
    }
}

// 启动时检查重启保护
checkRestartProtection();

// 检查配置文件是否存在
const configPath = path.join(__dirname, './config.js');
if (!fs.existsSync(configPath)) {
    logWithTimestamp('error', 'Error: config file config.js not found!');
    logWithTimestamp('error', 'Copy config.example.js to config.js in the server directory and set your Telegram Bot Token');
    process.exit(1); // 终止程序
}

const config = require('./config');

// --- 配置 ---
// 从配置文件中获取Telegram Bot Token和WebSocket端口
const token = config.telegramToken;
// WebSocket服务器端口
const wssPort = config.wssPort;

// 检查是否修改了默认token
if (token === 'TOKEN' || token === 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
    logWithTimestamp('error', 'Error: please set your Telegram Bot Token in config.js first!');
    logWithTimestamp('error', 'Find the line telegramToken: \'YOUR_TELEGRAM_BOT_TOKEN_HERE\' and replace it with the token you got from BotFather');
    process.exit(1); // 终止程序
}

// 初始化Telegram Bot，但不立即启动轮询
const bot = new TelegramBot(token, { polling: false });
logWithTimestamp('log', 'Initializing Telegram Bot...');

// 手动清除所有未处理的消息，然后启动轮询
(async function clearAndStartPolling() {
    try {
        logWithTimestamp('log', 'Clearing Telegram message queue...');

        // 检查是否是重启，如果是则使用更彻底的清除方式
        const isRestart = process.env.TELEGRAM_CLEAR_UPDATES === '1';
        if (isRestart) {
            logWithTimestamp('log', 'Restart flag detected, performing a thorough message queue cleanup...');
            // 获取更新并丢弃所有消息
            let updates;
            let lastUpdateId = 0;

            // 循环获取所有更新直到没有更多更新
            do {
                updates = await bot.getUpdates({
                    offset: lastUpdateId,
                    limit: 100,
                    timeout: 0
                });

                if (updates && updates.length > 0) {
                    lastUpdateId = updates[updates.length - 1].update_id + 1;
                    logWithTimestamp('log', `Cleaned up ${updates.length} messages, current offset: ${lastUpdateId}`);
                }
            } while (updates && updates.length > 0);

            // 清除环境变量
            delete process.env.TELEGRAM_CLEAR_UPDATES;
            logWithTimestamp('log', 'Message queue cleanup complete');
        } else {
            // 普通启动时的清理
            const updates = await bot.getUpdates({ limit: 100, timeout: 0 });
            if (updates && updates.length > 0) {
                // 如果有更新，获取最后一个更新的ID并设置offset为它+1
                const lastUpdateId = updates[updates.length - 1].update_id;
                await bot.getUpdates({ offset: lastUpdateId + 1, limit: 1, timeout: 0 });
                logWithTimestamp('log', `Cleared ${updates.length} pending messages`);
            } else {
                logWithTimestamp('log', 'No pending messages to clear');
            }
        }

        // 启动轮询
        bot.startPolling({
            restart: true,
            clean: true
        });
        logWithTimestamp('log', 'Telegram Bot polling started');
    } catch (error) {
        logWithTimestamp('error', 'Error clearing message queue or starting polling:', error);
        // 如果清除失败，仍然尝试启动轮询
        bot.startPolling({ restart: true, clean: true });
        logWithTimestamp('log', 'Telegram Bot polling started (after queue cleanup failure)');
    }
})();

// 初始化WebSocket服务器
const wss = new WebSocket.Server({ port: wssPort });
logWithTimestamp('log', `WebSocket server listening on port ${wssPort}...`);

let sillyTavernClient = null; // 用于存储连接的SillyTavern扩展客户端

// 用于存储正在进行的流式会话，调整会话结构，使用Promise来处理messageId
// 结构: { messagePromise: Promise<number> | null, lastText: String, timer: NodeJS.Timeout | null, isEditing: boolean }
const ongoingStreams = new Map();

// 重载服务器函数
function reloadServer(chatId) {
    logWithTimestamp('log', 'Reloading server component...');
    Object.keys(require.cache).forEach(function (key) {
        if (key.indexOf('node_modules') === -1) {
            delete require.cache[key];
        }
    });
    try {
        delete require.cache[require.resolve('./config.js')];
        const newConfig = require('./config.js');
        Object.assign(config, newConfig);
        logWithTimestamp('log', 'Config file reloaded');
    } catch (error) {
        logWithTimestamp('error', 'Error reloading config file:', error);
        if (chatId) bot.sendMessage(chatId, 'Error reloading config file: ' + error.message);
        return;
    }
    logWithTimestamp('log', 'Server component reloaded');
    if (chatId) bot.sendMessage(chatId, 'Server component reloaded successfully.');
}

// 重启服务器函数
function restartServer(chatId) {
    logWithTimestamp('log', 'Restarting server component...');

    // 首先停止Telegram Bot轮询
    bot.stopPolling().then(() => {
        logWithTimestamp('log', 'Telegram Bot polling stopped');

        // 然后关闭WebSocket服务器
        if (wss) {
            wss.close(() => {
                logWithTimestamp('log', 'WebSocket server closed, preparing to restart...');
                setTimeout(() => {
                    const { spawn } = require('child_process');
                    const serverPath = path.join(__dirname, 'server.js');
                    logWithTimestamp('log', `Restarting server: ${serverPath}`);
                    const cleanEnv = {
                        PATH: process.env.PATH,
                        NODE_PATH: process.env.NODE_PATH,
                        TELEGRAM_CLEAR_UPDATES: '1' // 添加标记，表示这是一次重启
                    };
                    if (chatId) cleanEnv.RESTART_NOTIFY_CHATID = chatId.toString();
                    const child = spawn(process.execPath, [serverPath], { detached: true, stdio: 'inherit', env: cleanEnv });
                    child.unref();
                    process.exit(0);
                }, 1000);
            });
        } else {
            // 如果没有WebSocket服务器，直接重启
            setTimeout(() => {
                const { spawn } = require('child_process');
                const serverPath = path.join(__dirname, 'server.js');
                logWithTimestamp('log', `Restarting server: ${serverPath}`);
                const cleanEnv = {
                    PATH: process.env.PATH,
                    NODE_PATH: process.env.NODE_PATH,
                    TELEGRAM_CLEAR_UPDATES: '1' // 添加标记，表示这是一次重启
                };
                if (chatId) cleanEnv.RESTART_NOTIFY_CHATID = chatId.toString();
                const child = spawn(process.execPath, [serverPath], { detached: true, stdio: 'inherit', env: cleanEnv });
                child.unref();
                process.exit(0);
            }, 1000);
        }
    }).catch(err => {
        logWithTimestamp('error', 'Error stopping Telegram Bot polling:', err);
        // 即使出错也继续重启过程
        if (wss) {
            wss.close(() => {
                // 重启代码...
                setTimeout(() => {
                    const { spawn } = require('child_process');
                    const serverPath = path.join(__dirname, 'server.js');
                    logWithTimestamp('log', `Restarting server: ${serverPath}`);
                    const cleanEnv = {
                        PATH: process.env.PATH,
                        NODE_PATH: process.env.NODE_PATH,
                        TELEGRAM_CLEAR_UPDATES: '1' // 添加标记，表示这是一次重启
                    };
                    if (chatId) cleanEnv.RESTART_NOTIFY_CHATID = chatId.toString();
                    const child = spawn(process.execPath, [serverPath], { detached: true, stdio: 'inherit', env: cleanEnv });
                    child.unref();
                    process.exit(0);
                }, 1000);
            });
        } else {
            // 如果没有WebSocket服务器，直接重启
            setTimeout(() => {
                const { spawn } = require('child_process');
                const serverPath = path.join(__dirname, 'server.js');
                logWithTimestamp('log', `Restarting server: ${serverPath}`);
                const cleanEnv = {
                    PATH: process.env.PATH,
                    NODE_PATH: process.env.NODE_PATH,
                    TELEGRAM_CLEAR_UPDATES: '1' // 添加标记，表示这是一次重启
                };
                if (chatId) cleanEnv.RESTART_NOTIFY_CHATID = chatId.toString();
                const child = spawn(process.execPath, [serverPath], { detached: true, stdio: 'inherit', env: cleanEnv });
                child.unref();
                process.exit(0);
            }, 1000);
        }
    });
}

// 退出服务器函数
function exitServer() {
    logWithTimestamp('log', 'Shutting down server...');
    const forceExitTimeout = setTimeout(() => {
        logWithTimestamp('error', 'Exit operation timed out, force-exiting process');
        process.exit(1);
    }, 10000);
    try {
        if (fs.existsSync(RESTART_PROTECTION_FILE)) {
            fs.unlinkSync(RESTART_PROTECTION_FILE);
            logWithTimestamp('log', 'Restart protection file cleaned up');
        }
    } catch (error) {
        logWithTimestamp('error', 'Failed to clean up restart protection file:', error);
    }
    const finalExit = () => {
        clearTimeout(forceExitTimeout);
        logWithTimestamp('log', 'Server component shut down successfully');
        process.exit(0);
    };
    if (wss) {
        wss.close(() => {
            logWithTimestamp('log', 'WebSocket server closed');
            bot.stopPolling().finally(finalExit);
        });
    } else {
        bot.stopPolling().finally(finalExit);
    }
}

function handleSystemCommand(command, chatId) {
    logWithTimestamp('log', `Executing system command: ${command}`);

    // 处理 ping 命令 - 返回连接状态信息
    if (command === 'ping') {
        const bridgeStatus = 'Bridge status: connected ✅';
        const stStatus = sillyTavernClient && sillyTavernClient.readyState === WebSocket.OPEN ?
            'SillyTavern status: connected ✅' :
            'SillyTavern status: not connected ❌';
        bot.sendMessage(chatId, `${bridgeStatus}\n${stStatus}`);
        return;
    }

    let responseMessage = '';
    switch (command) {
        case 'reload':
            responseMessage = 'Reloading server component...';
            // 如果SillyTavern已连接，则执行刷新UI
            if (sillyTavernClient && sillyTavernClient.readyState === WebSocket.OPEN) {
                sillyTavernClient.commandToExecuteOnClose = { command, chatId };
                sillyTavernClient.send(JSON.stringify({ type: 'system_command', command: 'reload_ui_only', chatId }));
            } else {
                // 如果未连接，直接重载服务器
                bot.sendMessage(chatId, responseMessage);
                reloadServer(chatId);
            }
            break;
        case 'restart':
            responseMessage = 'Restarting server component...';
            // 如果SillyTavern已连接，则执行刷新UI
            if (sillyTavernClient && sillyTavernClient.readyState === WebSocket.OPEN) {
                sillyTavernClient.commandToExecuteOnClose = { command, chatId };
                sillyTavernClient.send(JSON.stringify({ type: 'system_command', command: 'reload_ui_only', chatId }));
            } else {
                // 如果未连接，直接重启服务器
                bot.sendMessage(chatId, responseMessage);
                restartServer(chatId);
            }
            break;
        case 'exit':
            responseMessage = 'Shutting down server component...';
            // 如果SillyTavern已连接，则执行刷新UI
            if (sillyTavernClient && sillyTavernClient.readyState === WebSocket.OPEN) {
                sillyTavernClient.commandToExecuteOnClose = { command, chatId };
                sillyTavernClient.send(JSON.stringify({ type: 'system_command', command: 'reload_ui_only', chatId }));
            } else {
                // 如果未连接，直接退出服务器
                bot.sendMessage(chatId, responseMessage);
                exitServer();
            }
            break;
        default:
            logWithTimestamp('warn', `Unknown system command: ${command}`);
            bot.sendMessage(chatId, `Unknown system command: /${command}`);
            return;
    }

    // 只有在SillyTavern已连接的情况下，消息才会在上面的switch语句中发送
    // 所以这里只在SillyTavern已连接时发送响应消息
    if (sillyTavernClient && sillyTavernClient.readyState === WebSocket.OPEN) {
        bot.sendMessage(chatId, responseMessage);
    }
}

// 处理Telegram命令
async function handleTelegramCommand(command, args, chatId) {
    logWithTimestamp('log', `Handling Telegram command: /${command} ${args.join(' ')}`);

    // 显示"输入中"状态
    bot.sendChatAction(chatId, 'typing').catch(error =>
        logWithTimestamp('error', 'Failed to send "typing" status:', error));

    // 默认回复
    let replyText = `Unknown command: /${command}. Use /help to see all commands.`;

    // 特殊处理help命令，无论SillyTavern是否连接都可以显示
    if (command === 'help') {
        replyText = `SillyTavern Telegram Bridge commands:\n\n`;
        replyText += `Chat management\n`;
        replyText += `/new - Start a new chat with the current character.\n`;
        replyText += `/listchats - List all saved chats for the current character.\n`;
        replyText += `/switchchat <chat_name> - Load a specific chat.\n`;
        replyText += `/switchchat_<number> - Load a chat by number.\n\n`;
        replyText += `Character management\n`;
        replyText += `/listchars - List all available characters.\n`;
        replyText += `/switchchar <char_name> - Switch to the specified character.\n`;
        replyText += `/switchchar_<number> - Switch characters by number.\n\n`;
        replyText += `System management\n`;
        replyText += `/reload - Reload the plugin's server component and refresh the ST page.\n`;
        replyText += `/restart - Refresh the ST page and restart the plugin's server component.\n`;
        replyText += `/exit - Shut down the plugin's server component.\n`;
        replyText += `/ping - Check connection status.\n\n`;
        replyText += `Help\n`;
        replyText += `/help - Show this help message.`;

        // 发送帮助信息并返回
        bot.sendMessage(chatId, replyText).catch(err => {
            logWithTimestamp('error', `Failed to send command reply: ${err.message}`);
        });
        return;
    }

    // 检查SillyTavern是否连接
    if (!sillyTavernClient || sillyTavernClient.readyState !== WebSocket.OPEN) {
        bot.sendMessage(chatId, 'SillyTavern is not connected, so character and chat commands cannot run. Make sure SillyTavern is open with the Telegram extension enabled.');
        return;
    }

    // 根据命令类型处理
    switch (command) {
        case 'new':
            // 发送命令到前端执行
            sillyTavernClient.send(JSON.stringify({
                type: 'execute_command',
                command: 'new',
                chatId: chatId
            }));
            return; // 前端会发送响应，所以这里直接返回
        case 'listchars':
            // 发送命令到前端执行
            sillyTavernClient.send(JSON.stringify({
                type: 'execute_command',
                command: 'listchars',
                chatId: chatId
            }));
            return;
        case 'switchchar':
            if (args.length === 0) {
                replyText = 'Please provide a character name or number. Usage: /switchchar <character name> or /switchchar_<number>';
            } else {
                // 发送命令到前端执行
                sillyTavernClient.send(JSON.stringify({
                    type: 'execute_command',
                    command: 'switchchar',
                    args: args,
                    chatId: chatId
                }));
                return;
            }
            break;
        case 'listchats':
            // 发送命令到前端执行
            sillyTavernClient.send(JSON.stringify({
                type: 'execute_command',
                command: 'listchats',
                chatId: chatId
            }));
            return;
        case 'switchchat':
            if (args.length === 0) {
                replyText = 'Please provide a chat name. Usage: /switchchat <chat name>';
            } else {
                // 发送命令到前端执行
                sillyTavernClient.send(JSON.stringify({
                    type: 'execute_command',
                    command: 'switchchat',
                    args: args,
                    chatId: chatId
                }));
                return;
            }
            break;
        default:
            // 处理特殊格式的命令，如 switchchar_1, switchchat_2 等
            const charMatch = command.match(/^switchchar_(\d+)$/);
            if (charMatch) {
                // 发送命令到前端执行
                sillyTavernClient.send(JSON.stringify({
                    type: 'execute_command',
                    command: command, // 保持原始命令格式
                    chatId: chatId
                }));
                return;
            }

            const chatMatch = command.match(/^switchchat_(\d+)$/);
            if (chatMatch) {
                // 发送命令到前端执行
                sillyTavernClient.send(JSON.stringify({
                    type: 'execute_command',
                    command: command, // 保持原始命令格式
                    chatId: chatId
                }));
                return;
            }
    }

    // 发送回复
    bot.sendMessage(chatId, replyText).catch(err => {
        logWithTimestamp('error', `Failed to send command reply: ${err.message}`);
    });
}

// --- WebSocket服务器逻辑 ---
wss.on('connection', ws => {
    logWithTimestamp('log', 'SillyTavern extension connected!');
    sillyTavernClient = ws;

    ws.on('message', async (message) => { // 将整个回调设为async
        let data; // 在 try 块外部声明 data
        try {
            data = JSON.parse(message);

            // --- 处理流式文本块 ---
            if (data.type === 'stream_chunk' && data.chatId) {
                let session = ongoingStreams.get(data.chatId);

                // 1. 如果会话不存在，立即同步创建一个占位会话，创建会话和messagePromise
                if (!session) {
                    // 使用let声明，以便在Promise内部访问
                    let resolveMessagePromise;
                    const messagePromise = new Promise(resolve => {
                        resolveMessagePromise = resolve;
                    });

                    session = {
                        messagePromise: messagePromise,
                        lastText: data.text,
                        timer: null,
                        isEditing: false, // 新增状态锁
                    };
                    ongoingStreams.set(data.chatId, session);

                    // 异步发送第一条消息并更新 session
                    bot.sendMessage(data.chatId, 'Thinking...')
                        .then(sentMessage => {
                            // 当消息发送成功时，解析Promise并传入messageId
                            resolveMessagePromise(sentMessage.message_id);
                        }).catch(err => {
                            logWithTimestamp('error', 'Failed to send initial Telegram message:', err);
                            ongoingStreams.delete(data.chatId); // 出错时清理
                        });
                } else {
                    // 2. 如果会话存在，只更新最新文本
                    session.lastText = data.text;
                }

                // 3. 尝试触发一次编辑（节流保护）
                // 确保 messageId 已经获取到，并且当前没有正在进行的编辑或定时器
                // 使用 await messagePromise 来确保messageId可用
                const messageId = await session.messagePromise;

                if (messageId && !session.isEditing && !session.timer) {
                    session.timer = setTimeout(async () => { // 定时器回调也设为async
                        const currentSession = ongoingStreams.get(data.chatId);
                        if (currentSession) {
                            const currentMessageId = await currentSession.messagePromise;
                            if (currentMessageId) {
                                currentSession.isEditing = true;
                                bot.editMessageText(currentSession.lastText + ' ...', {
                                    chat_id: data.chatId,
                                    message_id: currentMessageId,
                                }).catch(err => {
                                    if (!err.message.includes('message is not modified'))
                                        logWithTimestamp('error', 'Failed to edit Telegram message:', err.message);
                                }).finally(() => {
                                    if (ongoingStreams.has(data.chatId)) ongoingStreams.get(data.chatId).isEditing = false;
                                });
                            }
                            currentSession.timer = null;
                        }
                    }, 2000);
                }
                return;
            }

            // --- 处理流式结束信号 ---
            if (data.type === 'stream_end' && data.chatId) {
                const session = ongoingStreams.get(data.chatId);
                // 只有当存在会话时才处理，这表明确实是流式传输
                if (session) {
                    if (session.timer) {
                        clearTimeout(session.timer);
                    }
                    logWithTimestamp('log', `Received stream-end signal, waiting for final rendered text update...`);
                    // 注意：我们不在这里清理会话，而是等待final_message_update
                }
                // 如果不存在会话但收到stream_end，这是一个异常情况
                // 可能是由于某些原因会话被提前清理了
                else {
                    logWithTimestamp('warn', `Received stream-end signal but found no matching session for ChatID ${data.chatId}`);
                    // 为安全起见，我们仍然发送消息，但这种情况不应该发生
                    await bot.sendMessage(data.chatId, data.text || "Message generation complete").catch(err => {
                        logWithTimestamp('error', 'Failed to send stream-end message:', err.message);
                    });
                }
                return;
            }

            // --- 处理最终渲染后的消息更新 ---
            if (data.type === 'final_message_update' && data.chatId) {
                const session = ongoingStreams.get(data.chatId);

                // 如果会话存在，说明是流式传输的最终更新
                if (session) {
                    // 使用 await messagePromise
                    const messageId = await session.messagePromise;
                    if (messageId) {
                        logWithTimestamp('log', `Received final streamed rendered text, updating message ${messageId}`);
                        await bot.editMessageText(data.text, {
                            chat_id: data.chatId,
                            message_id: messageId,
                            // 可选：在这里指定 parse_mode: 'MarkdownV2' 或 'HTML'
                            // parse_mode: 'HTML',
                        }).catch(err => {
                            if (!err.message.includes('message is not modified'))
                                logWithTimestamp('error', 'Failed to edit final formatted Telegram message:', err.message);
                        });
                        logWithTimestamp('log', `Final streaming update sent for ChatID ${data.chatId}.`);
                    } else {
                        logWithTimestamp('warn', `Received final_message_update but could not get the messageId of the streaming session.`);
                    }
                    // 清理流式会话
                    ongoingStreams.delete(data.chatId);
                    logWithTimestamp('log', `Streaming session for ChatID ${data.chatId} completed and cleaned up.`);
                }
                // 如果会话不存在，说明这是一个完整的非流式回复
                // 注意：这种情况不应该发生，因为我们已经在客户端修复了这个问题
                // 但为了健壮性，我们仍然保留这个处理
                else {
                    logWithTimestamp('log', `Received complete non-streaming reply, sending new message to ChatID ${data.chatId}`);
                    await bot.sendMessage(data.chatId, data.text, {
                        // 可选：在这里指定 parse_mode
                    }).catch(err => {
                        logWithTimestamp('error', 'Failed to send non-streaming reply:', err.message);
                    });
                }
                return;
            }

            // --- 其他消息处理逻辑 ---
            if (data.type === 'error_message' && data.chatId) {
                logWithTimestamp('error', `Received error report from SillyTavern, forwarding to Telegram user ${data.chatId}: ${data.text}`);
                bot.sendMessage(data.chatId, data.text);
            } else if (data.type === 'ai_reply' && data.chatId) {
                logWithTimestamp('log', `Received non-streaming AI reply, sending to Telegram user ${data.chatId}`);
                // 确保在发送消息前清理可能存在的流式会话
                if (ongoingStreams.has(data.chatId)) {
                    logWithTimestamp('log', `Cleaning up streaming session for ChatID ${data.chatId} because a non-streaming reply arrived`);
                    ongoingStreams.delete(data.chatId);
                }
                // 发送非流式回复
                await bot.sendMessage(data.chatId, data.text).catch(err => {
                    logWithTimestamp('error', `Failed to send non-streaming AI reply: ${err.message}`);
                });
            } else if (data.type === 'typing_action' && data.chatId) {
                logWithTimestamp('log', `Showing "typing" status to Telegram user ${data.chatId}`);
                bot.sendChatAction(data.chatId, 'typing').catch(error =>
                    logWithTimestamp('error', 'Failed to send "typing" status:', error));
            } else if (data.type === 'command_executed') {
                // 处理前端命令执行结果
                logWithTimestamp('log', `Command ${data.command} finished, result: ${data.success ? 'success' : 'failure'}`);
                if (data.message) {
                    logWithTimestamp('log', `Command result message: ${data.message}`);
                }
            }
        } catch (error) {
            logWithTimestamp('error', 'Error handling SillyTavern message:', error);
            // 确保即使在解析JSON失败时也能清理
            if (data && data.chatId) {
                ongoingStreams.delete(data.chatId);
            }
        }
    });

    ws.on('close', () => {
        logWithTimestamp('log', 'SillyTavern extension disconnected.');
        if (ws.commandToExecuteOnClose) {
            const { command, chatId } = ws.commandToExecuteOnClose;
            logWithTimestamp('log', `Client disconnected, now executing scheduled command: ${command}`);
            if (command === 'reload') reloadServer(chatId);
            if (command === 'restart') restartServer(chatId);
            if (command === 'exit') exitServer(chatId);
        }
        sillyTavernClient = null;
        ongoingStreams.clear();
    });

    ws.on('error', (error) => {
        logWithTimestamp('error', 'WebSocket error:', error);
        if (sillyTavernClient) {
            sillyTavernClient.commandToExecuteOnClose = null; // 清除标记，防止意外执行
        }
        sillyTavernClient = null;
        ongoingStreams.clear();
    });
});

// 检查是否需要发送重启完成通知
if (process.env.RESTART_NOTIFY_CHATID) {
    const chatId = parseInt(process.env.RESTART_NOTIFY_CHATID);
    if (!isNaN(chatId)) {
        setTimeout(() => {
            bot.sendMessage(chatId, 'Server component restarted successfully and is ready')
                .catch(err => logWithTimestamp('error', 'Failed to send restart notification:', err))
                .finally(() => {
                    delete process.env.RESTART_NOTIFY_CHATID;
                });
        }, 2000);
    }
}

// 监听Telegram消息
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    const userId = msg.from.id;
    const username = msg.from.username || 'N/A';

    // 检查白名单是否已配置且不为空
    if (config.allowedUserIds && config.allowedUserIds.length > 0) {
        // 如果当前用户的ID不在白名单中
        if (!config.allowedUserIds.includes(userId)) {
            logWithTimestamp('log', `Rejected access from non-whitelisted user:\n  - User ID: ${userId}\n  - Username: @${username}\n  - Chat ID: ${chatId}\n  - Message: "${text}"`);
            // 向该用户发送一条拒绝消息
            bot.sendMessage(chatId, 'Sorry, you are not authorized to use this bot.').catch(err => {
                logWithTimestamp('error', `Failed to send rejection message to ${chatId}:`, err.message);
            });
            // 终止后续处理
            return;
        }
    }

    if (!text) return;

    if (text.startsWith('/')) {
        const parts = text.slice(1).trim().split(/\s+/);
        const command = parts[0].toLowerCase();
        const args = parts.slice(1);

        // 系统命令由服务器直接处理
        if (['reload', 'restart', 'exit', 'ping'].includes(command)) {
            handleSystemCommand(command, chatId);
            return;
        }

        // 其他命令也由服务器处理，但可能需要前端执行
        handleTelegramCommand(command, args, chatId);
        return;
    }

    // 处理普通消息
    if (sillyTavernClient && sillyTavernClient.readyState === WebSocket.OPEN) {
        logWithTimestamp('log', `Received message from Telegram user ${chatId}: "${text}"`);
        const payload = JSON.stringify({ type: 'user_message', chatId, text });
        sillyTavernClient.send(payload);
    } else {
        logWithTimestamp('warn', 'Received Telegram message, but the SillyTavern extension is not connected.');
        bot.sendMessage(chatId, 'Sorry, I cannot reach SillyTavern right now. Make sure SillyTavern is open with the Telegram extension enabled.');
    }
});