// index.js

// 只解构 getContext() 返回的对象中确实存在的属性
const {
    extensionSettings,
    deleteLastMessage, // 导入删除最后一条消息的函数
    saveSettingsDebounced, // 导入保存设置的函数
} = SillyTavern.getContext();

// getContext 函数是全局 SillyTavern 对象的一部分，我们不需要从别处导入它
// 在需要时直接调用 SillyTavern.getContext() 即可

// 从 script.js 导入所有需要的公共API函数
import {
    eventSource,
    event_types,
    getPastCharacterChats,
    sendMessageAsUser,
    doNewChat,
    selectCharacterById,
    openCharacterChat,
    Generate,
    setExternalAbortController,
} from "../../../../script.js";

const MODULE_NAME = 'SillyTavern-Telegram-Connector';
const DEFAULT_SETTINGS = {
    bridgeUrl: 'ws://127.0.0.1:2333',
    autoConnect: true,
};

let ws = null; // WebSocket实例
let lastProcessedChatId = null; // 用于存储最后处理过的Telegram chatId

// 添加一个全局变量来跟踪当前是否处于流式模式
let isStreamingMode = false;

// --- 工具函数 ---
function getSettings() {
    if (!extensionSettings[MODULE_NAME]) {
        extensionSettings[MODULE_NAME] = { ...DEFAULT_SETTINGS };
    }
    return extensionSettings[MODULE_NAME];
}

function updateStatus(message, color) {
    const statusEl = document.getElementById('telegram_connection_status');
    if (statusEl) {
        statusEl.textContent = `Status: ${message}`;
        statusEl.style.color = color;
    }
}

function reloadPage() {
    window.location.reload();
}
// ---

// 连接到WebSocket服务器
function connect() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        console.log('[Telegram Bridge] Already connected');
        return;
    }

    const settings = getSettings();
    if (!settings.bridgeUrl) {
        updateStatus('URL not set!', 'red');
        return;
    }

    updateStatus('Connecting...', 'orange');
    console.log(`[Telegram Bridge] Connecting to ${settings.bridgeUrl}...`);

    ws = new WebSocket(settings.bridgeUrl);

    ws.onopen = () => {
        console.log('[Telegram Bridge] Connected!');
        updateStatus('Connected', 'green');
    };

    ws.onmessage = async (event) => {
        let data;
        try {
            data = JSON.parse(event.data);

            // --- 用户消息处理 ---
            if (data.type === 'user_message') {
                console.log('[Telegram Bridge] Received user message.', data);

                // 存储当前处理的chatId
                lastProcessedChatId = data.chatId;

                // 默认情况下，假设不是流式模式
                isStreamingMode = false;

                // 1. 立即向Telegram发送“输入中”状态（无论是否流式）
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'typing_action', chatId: data.chatId }));
                }

                // 2. 将用户消息添加到SillyTavern
                await sendMessageAsUser(data.text);

                // 3. 设置流式传输的回调
                const streamCallback = (cumulativeText) => {
                    // 标记为流式模式
                    isStreamingMode = true;
                    // 将每个文本块通过WebSocket发送到服务端
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            type: 'stream_chunk',
                            chatId: data.chatId,
                            text: cumulativeText,
                        }));
                    }
                };
                eventSource.on(event_types.STREAM_TOKEN_RECEIVED, streamCallback);

                // 4. 定义一个清理函数
                const cleanup = () => {
                    eventSource.removeListener(event_types.STREAM_TOKEN_RECEIVED, streamCallback);
                    if (ws && ws.readyState === WebSocket.OPEN && isStreamingMode) {
                        // 仅在没有错误且确实处于流式模式时发送stream_end
                        if (!data.error) {
                            ws.send(JSON.stringify({ type: 'stream_end', chatId: data.chatId }));
                        }
                    }
                    // 注意：不在这里重置isStreamingMode，让handleFinalMessage函数来处理
                };

                // 5. 监听生成结束事件，确保无论成功与否都执行清理
                // 注意: 我们现在使用once来确保这个监听器只执行一次，避免干扰后续的全局监听器
                eventSource.once(event_types.GENERATION_ENDED, cleanup);
                // 添加对手动停止生成的处理
                eventSource.once(event_types.GENERATION_STOPPED, cleanup);

                // 6. 触发SillyTavern的生成流程，并用try...catch包裹
                try {
                    const abortController = new AbortController();
                    setExternalAbortController(abortController);
                    await Generate('normal', { signal: abortController.signal });
                } catch (error) {
                    console.error("[Telegram Bridge] Generate() error:", error);

                    // a. 从SillyTavern聊天记录中删除导致错误的用户消息
                    await deleteLastMessage();
                    console.log('[Telegram Bridge] Deleted the user message that caused the error.');

                    // b. 准备并发送错误信息到服务端
                    const errorMessage = `Sorry, the AI encountered an error while generating a reply.\nYour last message has been withdrawn — please try again or send something different.\n\nError details: ${error.message || 'Unknown error'}`;
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            type: 'error_message',
                            chatId: data.chatId,
                            text: errorMessage,
                        }));
                    }

                    // c. 标记错误以便cleanup函数知道
                    data.error = true;
                    cleanup(); // 确保清理监听器
                }

                return;
            }

            // --- 系统命令处理 ---
            if (data.type === 'system_command') {
                console.log('[Telegram Bridge] Received system command', data);
                if (data.command === 'reload_ui_only') {
                    console.log('[Telegram Bridge] Reloading UI...');
                    setTimeout(reloadPage, 500);
                }
                return;
            }

            // --- 执行命令处理 ---
            if (data.type === 'execute_command') {
                console.log('[Telegram Bridge] Executing command', data);

                // 显示“输入中”状态
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'typing_action', chatId: data.chatId }));
                }

                let replyText = 'Command failed. Please try again later.';

                // 直接调用全局的 SillyTavern.getContext()
                const context = SillyTavern.getContext();
                let commandSuccess = false;

                try {
                    switch (data.command) {
                        case 'new':
                            await doNewChat({ deleteCurrentChat: false });
                            replyText = 'A new chat has started.';
                            commandSuccess = true;
                            break;
                        case 'listchars': {
                            const characters = context.characters.slice(1);
                            if (characters.length > 0) {
                                replyText = 'Available characters:\n\n';
                                characters.forEach((char, index) => {
                                    replyText += `${index + 1}. /switchchar_${index + 1} - ${char.name}\n`;
                                });
                                replyText += '\nUse /switchchar_<number> or /switchchar <character name> to switch characters';
                            } else {
                                replyText = 'No available characters found.';
                            }
                            commandSuccess = true;
                            break;
                        }
                        case 'switchchar': {
                            if (!data.args || data.args.length === 0) {
                                replyText = 'Please provide a character name or number. Usage: /switchchar <character name> or /switchchar_<number>';
                                break;
                            }
                            const targetName = data.args.join(' ');
                            const characters = context.characters;
                            const targetChar = characters.find(c => c.name === targetName);

                            if (targetChar) {
                                const charIndex = characters.indexOf(targetChar);
                                await selectCharacterById(charIndex);
                                replyText = `Switched to character "${targetName}".`;
                                commandSuccess = true;
                            } else {
                                replyText = `Character "${targetName}" not found.`;
                            }
                            break;
                        }
                        case 'listchats': {
                            if (context.characterId === undefined) {
                                replyText = 'Please select a character first.';
                                break;
                            }
                            const chatFiles = await getPastCharacterChats(context.characterId);
                            if (chatFiles.length > 0) {
                                replyText = 'Chat history for the current character:\n\n';
                                chatFiles.forEach((chat, index) => {
                                    const chatName = chat.file_name.replace('.jsonl', '');
                                    replyText += `${index + 1}. /switchchat_${index + 1} - ${chatName}\n`;
                                });
                                replyText += '\nUse /switchchat_<number> or /switchchat <chat name> to switch chats';
                            } else {
                                replyText = 'The current character has no chat history.';
                            }
                            commandSuccess = true;
                            break;
                        }
                        case 'switchchat': {
                            if (!data.args || data.args.length === 0) {
                                replyText = 'Please provide a chat name. Usage: /switchchat <chat name>';
                                break;
                            }
                            const targetChatFile = `${data.args.join(' ')}`;
                            try {
                                await openCharacterChat(targetChatFile);
                                replyText = `Chat loaded: ${targetChatFile}`;
                                commandSuccess = true;
                            } catch (err) {
                                console.error(err);
                                replyText = `Failed to load chat "${targetChatFile}". Please make sure the name is exactly correct.`;
                            }
                            break;
                        }
                        default: {
                            // 处理特殊格式的命令，如 switchchar_1, switchchat_2 等
                            const charMatch = data.command.match(/^switchchar_(\d+)$/);
                            if (charMatch) {
                                const index = parseInt(charMatch[1]) - 1;
                                const characters = context.characters.slice(1);
                                if (index >= 0 && index < characters.length) {
                                    const targetChar = characters[index];
                                    const charIndex = context.characters.indexOf(targetChar);
                                    await selectCharacterById(charIndex);
                                    replyText = `Switched to character "${targetChar.name}".`;
                                    commandSuccess = true;
                                } else {
                                    replyText = `Invalid character number: ${index + 1}. Use /listchars to see available characters.`;
                                }
                                break;
                            }

                            const chatMatch = data.command.match(/^switchchat_(\d+)$/);
                            if (chatMatch) {
                                if (context.characterId === undefined) {
                                    replyText = 'Please select a character first.';
                                    break;
                                }
                                const index = parseInt(chatMatch[1]) - 1;
                                const chatFiles = await getPastCharacterChats(context.characterId);

                                if (index >= 0 && index < chatFiles.length) {
                                    const targetChat = chatFiles[index];
                                    const chatName = targetChat.file_name.replace('.jsonl', '');
                                    try {
                                        await openCharacterChat(chatName);
                                        replyText = `Chat loaded: ${chatName}`;
                                        commandSuccess = true;
                                    } catch (err) {
                                        console.error(err);
                                        replyText = `Failed to load chat.`;
                                    }
                                } else {
                                    replyText = `Invalid chat number: ${index + 1}. Use /listchats to see available chats.`;
                                }
                                break;
                            }

                            replyText = `Unknown command: /${data.command}. Use /help to see all commands.`;
                        }
                    }
                } catch (error) {
                    console.error('[Telegram Bridge] Error executing command:', error);
                    replyText = `Error executing command: ${error.message || 'Unknown error'}`;
                }

                // 发送命令执行结果
                if (ws && ws.readyState === WebSocket.OPEN) {
                    // 发送命令执行结果到Telegram
                    ws.send(JSON.stringify({ type: 'ai_reply', chatId: data.chatId, text: replyText }));

                    // 发送命令执行状态反馈到服务器
                    ws.send(JSON.stringify({
                        type: 'command_executed',
                        command: data.command,
                        success: commandSuccess,
                        message: replyText
                    }));
                }

                return;
            }
        } catch (error) {
            console.error('[Telegram Bridge] Error handling request:', error);
            if (data && data.chatId && ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'error_message', chatId: data.chatId, text: 'An internal error occurred while processing your request.' }));
            }
        }
    };

    ws.onclose = () => {
        console.log('[Telegram Bridge] Connection closed.');
        updateStatus('Disconnected', 'red');
        ws = null;
    };

    ws.onerror = (error) => {
        console.error('[Telegram Bridge] WebSocket error:', error);
        updateStatus('Connection error', 'red');
        ws = null;
    };
}

function disconnect() {
    if (ws) {
        ws.close();
    }
}

// 扩展加载时执行的函数
jQuery(async () => {
    console.log('[Telegram Bridge] Loading settings UI...');
    try {
        const settingsHtml = await $.get(`/scripts/extensions/third-party/${MODULE_NAME}/settings.html`);
        $('#extensions_settings').append(settingsHtml);
        console.log('[Telegram Bridge] Settings UI should now be added.');

        const settings = getSettings();
        $('#telegram_bridge_url').val(settings.bridgeUrl);
        $('#telegram_auto_connect').prop('checked', settings.autoConnect);

        $('#telegram_bridge_url').on('input', () => {
            const settings = getSettings();
            settings.bridgeUrl = $('#telegram_bridge_url').val();
            // 确保调用saveSettingsDebounced保存设置
            saveSettingsDebounced();
        });

        $('#telegram_auto_connect').on('change', function () {
            const settings = getSettings();
            settings.autoConnect = $(this).prop('checked');
            // 确保调用saveSettingsDebounced保存设置
            console.log(`[Telegram Bridge] Auto-connect setting changed to: ${settings.autoConnect}`);
            saveSettingsDebounced();
        });

        $('#telegram_connect_button').on('click', connect);
        $('#telegram_disconnect_button').on('click', disconnect);

        if (settings.autoConnect) {
            console.log('[Telegram Bridge] Auto-connect enabled, connecting...');
            connect();
        }

    } catch (error) {
        console.error('[Telegram Bridge] Failed to load settings HTML.', error);
    }
    console.log('[Telegram Bridge] Extension loaded.');
});

// 全局事件监听器，用于最终消息更新
function handleFinalMessage(lastMessageIdInChatArray) {
    // 确保WebSocket已连接，并且我们有一个有效的chatId来发送更新
    if (!ws || ws.readyState !== WebSocket.OPEN || !lastProcessedChatId) {
        return;
    }

    const lastMessageIndex = lastMessageIdInChatArray - 1;
    if (lastMessageIndex < 0) return;

    // 延迟以确保DOM更新完成
    setTimeout(() => {
        // 直接调用全局的 SillyTavern.getContext()
        const context = SillyTavern.getContext();
        const lastMessage = context.chat[lastMessageIndex];

        // 确认这是我们刚刚通过Telegram触发的AI回复
        if (lastMessage && !lastMessage.is_user && !lastMessage.is_system) {
            const messageElement = $(`#chat .mes[mesid="${lastMessageIndex}"]`);

            if (messageElement.length > 0) {
                // 获取消息文本元素
                const messageTextElement = messageElement.find('.mes_text');

                // 获取HTML内容并替换<br>和</p><p>为换行符
                let renderedText = messageTextElement.html()
                    .replace(/<br\s*\/?>/gi, '\n')
                    .replace(/<\/p>\s*<p>/gi, '\n\n')
                // .replace(/<[^>]*>/g, ''); // 移除所有其他HTML标签

                // 解码HTML实体
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = renderedText;
                renderedText = tempDiv.textContent;

                console.log(`[Telegram Bridge] Captured final rendered text, sending update to chatId: ${lastProcessedChatId}`);

                // 判断是流式还是非流式响应
                if (isStreamingMode) {
                    // 流式响应 - 发送final_message_update
                    ws.send(JSON.stringify({
                        type: 'final_message_update',
                        chatId: lastProcessedChatId,
                        text: renderedText,
                    }));
                    // 重置流式模式标志
                    isStreamingMode = false;
                } else {
                    // 非流式响应 - 直接发送ai_reply
                    ws.send(JSON.stringify({
                        type: 'ai_reply',
                        chatId: lastProcessedChatId,
                        text: renderedText,
                    }));
                }

                // 重置chatId，避免意外更新其他用户的消息
                lastProcessedChatId = null;
            }
        }
    }, 100);
}

// 全局事件监听器，用于最终消息更新
eventSource.on(event_types.GENERATION_ENDED, handleFinalMessage);

// 添加对手动停止生成的处理
eventSource.on(event_types.GENERATION_STOPPED, handleFinalMessage);