// DOM Elements
const btnRecord = document.getElementById('btn-record');
const textRecord = document.getElementById('text-record');
const iconRecord = btnRecord.querySelector('i');
const recordingStatus = document.getElementById('recording-status');
const btnClear = document.getElementById('btn-clear');
const btnExport = document.getElementById('btn-export');
const btnSettings = document.getElementById('btn-settings');
const recordingStatusText = document.getElementById('recording-status-text');
const transcriptContainer = document.getElementById('transcript-container');
const emptyStateTranscript = document.getElementById('empty-state-transcript');
const finalTextEl = document.getElementById('final-text');
const interimTextEl = document.getElementById('interim-text');
const qaContainer = document.getElementById('qa-container');
const emptyStateQa = document.getElementById('empty-state-qa');
const btnFloatingAsk = document.getElementById('btn-floating-ask');

// Settings Modal Elements
const modalSettings = document.getElementById('modal-settings');
const modalContent = document.getElementById('modal-content');
const btnCloseSettings = document.getElementById('btn-close-settings');
const btnCancelSettings = document.getElementById('btn-cancel-settings');
const btnSaveSettings = document.getElementById('btn-save-settings');
const selectProvider = document.getElementById('select-provider');
const inputApiKey = document.getElementById('input-api-key');
const inputBaseUrl = document.getElementById('input-base-url');
const inputModel = document.getElementById('input-model');
const providerLink = document.getElementById('provider-link');
const providerLinkContainer = document.getElementById('provider-link-container');
const advancedSettings = document.getElementById('advanced-settings');
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toast-message');

// State
let isRecording = false;
let recognition = null;
let finalTranscript = ''; // Note: with contenteditable, this will be synchronized with DOM
let qaHistory = [];
let highlightTimers = {}; // Store timers for question highlights

// AI Configuration
const AI_PROVIDERS = {
    deepseek: {
        baseUrl: 'https://api.deepseek.com/chat/completions',
        model: 'deepseek-chat',
        link: 'https://platform.deepseek.com/api_keys',
        linkText: '获取 DeepSeek API Key'
    },
    kimi: {
        baseUrl: 'https://api.moonshot.cn/v1/chat/completions',
        model: 'moonshot-v1-8k',
        link: 'https://platform.moonshot.cn/console/api-keys',
        linkText: '获取 Kimi API Key'
    },
    custom: {
        baseUrl: '',
        model: '',
        link: '',
        linkText: ''
    }
};

let aiConfig = {
    provider: 'deepseek',
    apiKey: '',
    baseUrl: AI_PROVIDERS.deepseek.baseUrl,
    model: AI_PROVIDERS.deepseek.model
};

// Load initial state from local storage
function loadState() {
    // Load AI Config
    const savedConfig = localStorage.getItem('ai_config');
    if (savedConfig) {
        try {
            aiConfig = { ...aiConfig, ...JSON.parse(savedConfig) };
        } catch (e) {
            console.error('Failed to load AI config', e);
        }
    } else {
        // Fallback for old version
        const oldKey = localStorage.getItem('deepseek_api_key');
        if (oldKey) {
            aiConfig.apiKey = oldKey;
            saveConfig();
            localStorage.removeItem('deepseek_api_key');
        }
    }
    const savedText = localStorage.getItem('lecture_text');
    if (savedText) {
        finalTextEl.innerHTML = savedText; // Use innerHTML to preserve spans if any
        finalTranscript = finalTextEl.innerText; // Keep plain text in sync
        emptyStateTranscript.style.display = 'none';
        // Re-bind events to any saved highlights
        bindHighlightEvents();
    }

    const savedQa = localStorage.getItem('lecture_qa');
    if (savedQa) {
        try {
            qaHistory = JSON.parse(savedQa);
            if (qaHistory.length > 0) {
                emptyStateQa.style.display = 'none';
                qaHistory.forEach(qa => renderQaCard(qa));
            }
        } catch (e) {
            console.error('Failed to load QA history', e);
        }
    }
}

// Save state to local storage
function saveState() {
    localStorage.setItem('lecture_text', finalTextEl.innerHTML); // Save HTML to keep highlights
    localStorage.setItem('lecture_qa', JSON.stringify(qaHistory));
}

function saveConfig() {
    localStorage.setItem('ai_config', JSON.stringify(aiConfig));
}

// Sync plain text state when user edits
finalTextEl.addEventListener('input', () => {
    finalTranscript = finalTextEl.innerText;
    saveState();
});

// Auto scroll to bottom
function scrollToBottom(el) {
    // Only auto-scroll if we are already near the bottom to avoid interrupting user editing
    const isNearBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + 100;
    if (isNearBottom || el === qaContainer) {
        el.scrollTop = el.scrollHeight;
    }
}

// Initialize Speech Recognition
function initSpeechRecognition() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        alert('您的浏览器不支持语音识别，请使用 Chrome 或 Edge 浏览器。');
        return false;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'zh-CN'; // Set language to Chinese

    recognition.onstart = () => {
        isRecording = true;
        updateRecordUI();
        if (recordingStatusText) recordingStatusText.textContent = '正在听写...';
    };

    recognition.onresult = (event) => {
        let interimTranscript = '';
        emptyStateTranscript.style.display = 'none';
        
        // Save current cursor position if user is editing
        const selection = window.getSelection();
        let cursorNode = null;
        let cursorOffset = 0;
        let isEditing = document.activeElement === finalTextEl;
        
        if (isEditing && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            cursorNode = range.startContainer;
            cursorOffset = range.startOffset;
        }

        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                const text = event.results[i][0].transcript;
                
                // Check if it's a question and wrap it
                if (isTeacherQuestion(text)) {
                    const highlightId = 'hq_' + Date.now() + Math.floor(Math.random() * 1000);
                    const wrappedText = `<span id="${highlightId}" class="question-highlight" data-question="${text.trim()}">${text}</span>`;
                    
                    // Append to DOM directly to maintain HTML
                    if (isEditing) {
                        // If user is editing, we just append to the end anyway for simplicity in this version, 
                        // but ideally we'd insert at cursor. For robustness in dictation, append to end.
                        finalTextEl.insertAdjacentHTML('beforeend', wrappedText);
                    } else {
                        finalTextEl.insertAdjacentHTML('beforeend', wrappedText);
                    }
                    
                    // Bind event and set timer
                    setTimeout(() => setupHighlight(highlightId), 0);
                    
                } else {
                    // Normal text
                    const textNode = document.createTextNode(text);
                    finalTextEl.appendChild(textNode);
                }
                
                finalTranscript = finalTextEl.innerText;
            } else {
                interimTranscript += event.results[i][0].transcript;
            }
        }

        interimTextEl.textContent = interimTranscript;
        
        // Restore cursor if editing
        if (isEditing && cursorNode && document.body.contains(cursorNode)) {
            try {
                const range = document.createRange();
                range.setStart(cursorNode, cursorOffset);
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);
            } catch(e) {
                // Ignore if node structure changed too much
            }
        } else if (!isEditing) {
            // Only auto-scroll if not actively editing
            scrollToBottom(transcriptContainer);
        }
        
        saveState();
    };

    recognition.onerror = (event) => {
        console.error('Speech recognition error', event.error);
        if (event.error === 'not-allowed') {
            alert('请允许使用麦克风权限。强烈建议您将此应用部署到 GitHub Pages 或本地服务器，以避免每次重连都需要授权。');
            stopRecording();
        } else if (event.error === 'network') {
            if (recordingStatusText) recordingStatusText.textContent = '网络异常，重连中...';
        }
    };

    recognition.onend = () => {
        // If it stopped but we didn't explicitly ask it to stop, restart it (browser limits)
        if (isRecording) {
            if (recordingStatusText) recordingStatusText.textContent = '重连中...';
            // Add a tiny delay to avoid rapid crash loops in some browsers
            setTimeout(() => {
                try {
                    recognition.start();
                } catch (e) {
                    console.error('Re-start error:', e);
                }
            }, 100);
        } else {
            updateRecordUI();
        }
    };

    return true;
}

// Toggle Recording
function toggleRecording() {
    if (isRecording) {
        stopRecording();
    } else {
        startRecording();
    }
}

function startRecording() {
    if (!recognition) {
        if (!initSpeechRecognition()) return;
    }
    try {
        recognition.start();
    } catch (e) {
        console.error(e);
    }
}

function stopRecording() {
    isRecording = false;
    if (recognition) {
        recognition.stop();
    }
    updateRecordUI();
}

function updateRecordUI() {
    if (isRecording) {
        btnRecord.classList.remove('bg-blue-600', 'hover:bg-blue-700');
        btnRecord.classList.add('bg-red-500', 'hover:bg-red-600', 'animate-pulse');
        iconRecord.classList.replace('fa-microphone', 'fa-stop');
        textRecord.textContent = '停止录音';
        recordingStatus.classList.remove('hidden');
        recordingStatus.classList.add('flex');
    } else {
        btnRecord.classList.remove('bg-red-500', 'hover:bg-red-600', 'animate-pulse');
        btnRecord.classList.add('bg-blue-600', 'hover:bg-blue-700');
        iconRecord.classList.replace('fa-stop', 'fa-microphone');
        textRecord.textContent = '开始录音';
        recordingStatus.classList.add('hidden');
        recordingStatus.classList.remove('flex');
    }
}

// --- Question Extraction & AI Logic ---

// Advanced Question Detection Logic
function isTeacherQuestion(text) {
    const cleanText = text.trim();
    
    // 1. Length Filter: Ignore very short phrases (usually filler words like "对吧", "是不是")
    if (cleanText.length <= 4) {
        return false;
    }

    // 2. Keyword Dictionaries
    // Strong question keywords that almost always indicate a question when used in a sentence
    const strongKeywords = [
        "为什么", "如何", "怎么", "请解释", "什么原因", 
        "区别是什么", "有何不同", "哪几种", "什么是", "举个例子"
    ];
    
    // Guiding keywords often used by teachers
    const guideKeywords = [
        "同学们想一想", "大家思考一下", "我们来看看", 
        "谁能告诉我", "能不能", "大家觉得呢", "大家看这里"
    ];

    // Check if text contains any strong or guide keywords
    const containsKeyword = [...strongKeywords, ...guideKeywords].some(keyword => cleanText.includes(keyword));
    
    // 3. Punctuation fallback (with length protection already applied above)
    // Ends with question mark or "吗" + punctuation
    const hasQuestionMark = cleanText.match(/[?？]$/) || cleanText.match(/吗[。，,.]$/);

    // 4. Exclusion list for common rhetorical/filler phrases even if they are long enough
    const isExcluded = cleanText.match(/^(听懂了吗|对不对|是不是|对吧|能理解吗)[。，,.?？]*$/);

    if (isExcluded) {
        return false;
    }

    // Return true if it has a keyword OR ends like a question
    return containsKeyword || hasQuestionMark;
}

function bindHighlightEvents() {
    const highlights = finalTextEl.querySelectorAll('.question-highlight');
    highlights.forEach(el => {
        // If loaded from localStorage, we don't restart the 10s timer, 
        // we just let it stay clickable or user can clear it.
        // Or we could strip them. For now, let's just make them clickable.
        el.addEventListener('click', handleHighlightClick);
    });
}

function setupHighlight(id) {
    const el = document.getElementById(id);
    if (!el) return;

    el.addEventListener('click', handleHighlightClick);

    // Set 10-second timeout to remove highlight
    highlightTimers[id] = setTimeout(() => {
        removeHighlight(id);
    }, 10000);
}

function handleHighlightClick(e) {
    const el = e.currentTarget;
    const question = el.getAttribute('data-question') || el.innerText;
    
    // Ask AI
    askDeepSeek(question);
    
    // Remove highlight immediately after clicking
    const id = el.id;
    if (id && highlightTimers[id]) {
        clearTimeout(highlightTimers[id]);
        delete highlightTimers[id];
    }
    
    removeHighlight(id, el);
}

function removeHighlight(id, element = null) {
    const el = element || document.getElementById(id);
    if (el) {
        // Replace span with its text content
        const text = document.createTextNode(el.innerText);
        el.parentNode.replaceChild(text, el);
        saveState();
    }
}

// Handle manual text selection
transcriptContainer.addEventListener('mouseup', (e) => {
    const selection = window.getSelection();
    const text = selection.toString().trim();

    if (text.length > 0) {
        // Position the button near the cursor
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        
        btnFloatingAsk.style.left = `${rect.left + (rect.width / 2) - 50}px`;
        btnFloatingAsk.style.top = `${rect.top - 45}px`;
        btnFloatingAsk.classList.remove('hidden');
        
        // Save selected text to a data attribute
        btnFloatingAsk.dataset.question = text;
    } else {
        btnFloatingAsk.classList.add('hidden');
    }
});

// Hide floating button when clicking elsewhere
document.addEventListener('mousedown', (e) => {
    if (e.target !== btnFloatingAsk && !btnFloatingAsk.contains(e.target)) {
        btnFloatingAsk.classList.add('hidden');
    }
});

btnFloatingAsk.addEventListener('click', () => {
    const question = btnFloatingAsk.dataset.question;
    if (question) {
        askDeepSeek(question);
        window.getSelection().removeAllRanges();
        btnFloatingAsk.classList.add('hidden');
    }
});

// Ask AI API
async function askDeepSeek(question) {
    if (!aiConfig.apiKey) {
        showToast('请先在设置中配置 API Key', 'error');
        openSettings();
        return;
    }

    if (!aiConfig.baseUrl || !aiConfig.model) {
        showToast('请在设置中完善接口地址和模型名称', 'error');
        openSettings();
        return;
    }

    emptyStateQa.style.display = 'none';

    // Create a new QA object
    const qaId = 'qa_' + Date.now();
    const qa = {
        id: qaId,
        question: question,
        answer: '',
        status: 'loading'
    };
    
    qaHistory.push(qa);
    saveState();
    
    // Render the loading card
    renderQaCard(qa);
    scrollToBottom(qaContainer);

    try {
        const response = await fetch(aiConfig.baseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${aiConfig.apiKey}`
            },
            body: JSON.stringify({
                model: aiConfig.model,
                messages: [
                    {
                        role: 'system',
                        content: '你是一个大学课堂助手。请用极简、专业的语言直接回答问题。不要任何废话和客套，最多使用3-4句话或简短的列表总结核心要点。使用 markdown 格式排版。'
                    },
                    {
                        role: 'user',
                        content: question
                    }
                ],
                stream: false,
                max_tokens: 300
            })
        });

        const data = await response.json();

        if (response.ok) {
            qa.answer = data.choices[0].message.content;
            qa.status = 'success';
        } else {
            throw new Error(data.error?.message || '请求失败');
        }
    } catch (error) {
        console.error('API Error:', error);
        qa.answer = `错误: ${error.message}`;
        qa.status = 'error';
    }

    // Update state and UI
    saveState();
    updateQaCard(qa);
    scrollToBottom(qaContainer);
}

// Render QA Card
function renderQaCard(qa) {
    const card = document.createElement('div');
    card.id = qa.id;
    card.className = 'qa-card bg-white border border-gray-100 rounded-xl p-4 shadow-sm relative group';

    let answerHtml = '';
    if (qa.status === 'loading') {
        answerHtml = `
            <div class="flex items-center gap-1.5 text-blue-500 h-6">
                <div class="w-2 h-2 bg-blue-500 rounded-full typing-dot"></div>
                <div class="w-2 h-2 bg-blue-500 rounded-full typing-dot"></div>
                <div class="w-2 h-2 bg-blue-500 rounded-full typing-dot"></div>
            </div>`;
    } else {
        answerHtml = marked.parse(qa.answer);
    }

    // Check if we should show the detail button
    // Show only if: status is success AND it's not already a detailed card AND hasn't been clicked before
    const showDetailBtn = qa.status === 'success' && !qa.isDetailedCard && !qa.hasDetailed;
    const detailBtnHtml = showDetailBtn ? `
        <div class="mt-3 flex justify-end">
            <button class="btn-detail-qa flex items-center gap-1.5 text-xs text-blue-500 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-full transition-colors">
                <i class="fa-solid fa-list-ul"></i>
                详细一点
            </button>
        </div>
    ` : '';

    card.innerHTML = `
        <div class="flex items-start justify-between gap-3 mb-3">
            <div class="flex items-start gap-3 flex-1">
                <div class="w-7 h-7 ${qa.isDetailedCard ? 'bg-indigo-50 text-indigo-600' : 'bg-blue-50 text-blue-600'} rounded-full flex items-center justify-center shrink-0 mt-0.5">
                    <i class="fa-solid ${qa.isDetailedCard ? 'fa-magnifying-glass' : 'fa-q'} text-xs"></i>
                </div>
                <p class="text-gray-800 font-medium leading-relaxed">${qa.question}</p>
            </div>
            <button class="btn-delete-qa text-gray-300 hover:text-red-500 transition-colors p-1 opacity-0 group-hover:opacity-100" title="删除该问答">
                <i class="fa-solid fa-trash-can"></i>
            </button>
        </div>
        <div class="flex items-start gap-3">
            <div class="w-7 h-7 bg-purple-50 text-purple-600 rounded-full flex items-center justify-center shrink-0 mt-0.5">
                <i class="fa-solid fa-robot text-xs"></i>
            </div>
            <div class="flex-1 overflow-hidden">
                <div class="prose text-gray-600 answer-content">
                    ${answerHtml}
                </div>
                <div class="detail-btn-container">
                    ${detailBtnHtml}
                </div>
            </div>
        </div>
    `;

    // Bind delete event
    const deleteBtn = card.querySelector('.btn-delete-qa');
    deleteBtn.addEventListener('click', () => {
        deleteQaCard(qa.id);
    });

    // Bind detail event
    if (showDetailBtn) {
        const detailBtn = card.querySelector('.btn-detail-qa');
        if (detailBtn) {
            detailBtn.addEventListener('click', () => {
                askDetailedAI(qa);
            });
        }
    }

    qaContainer.appendChild(card);
}

// Update existing QA Card
function updateQaCard(qa) {
    const card = document.getElementById(qa.id);
    if (card) {
        const answerContainer = card.querySelector('.answer-content');
        if (qa.status === 'error') {
            answerContainer.innerHTML = `<span class="text-red-500">${qa.answer}</span>`;
        } else {
            answerContainer.innerHTML = marked.parse(qa.answer);
        }

        // Re-evaluate detail button visibility
        const detailContainer = card.querySelector('.detail-btn-container');
        if (detailContainer) {
            const showDetailBtn = qa.status === 'success' && !qa.isDetailedCard && !qa.hasDetailed;
            if (showDetailBtn) {
                detailContainer.innerHTML = `
                    <div class="mt-3 flex justify-end">
                        <button class="btn-detail-qa flex items-center gap-1.5 text-xs text-blue-500 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-full transition-colors">
                            <i class="fa-solid fa-list-ul"></i>
                            详细一点
                        </button>
                    </div>
                `;
                const detailBtn = detailContainer.querySelector('.btn-detail-qa');
                detailBtn.addEventListener('click', () => {
                    askDetailedAI(qa);
                });
            } else {
                detailContainer.innerHTML = '';
            }
        }
    }
}

// Delete QA Card
function deleteQaCard(id) {
    // Remove from DOM
    const card = document.getElementById(id);
    if (card) {
        card.remove();
    }
    
    // Remove from State
    qaHistory = qaHistory.filter(qa => qa.id !== id);
    saveState();
    
    // Show empty state if needed
    if (qaHistory.length === 0) {
        emptyStateQa.style.display = 'flex';
    }
}

// Ask Detailed AI
async function askDetailedAI(originalQa) {
    if (!aiConfig.apiKey) {
        showToast('请先在设置中配置 API Key', 'error');
        openSettings();
        return;
    }

    // Mark original as having detailed version and update UI to hide button
    originalQa.hasDetailed = true;
    saveState();
    updateQaCard(originalQa);

    // Create a new QA object for the detailed answer
    const detailedQaId = 'qa_detail_' + Date.now();
    const detailedQa = {
        id: detailedQaId,
        question: `关于：“${originalQa.question}”的详细解答`,
        answer: '',
        status: 'loading',
        isDetailedCard: true
    };
    
    qaHistory.push(detailedQa);
    saveState();
    
    // Render the loading card
    renderQaCard(detailedQa);
    scrollToBottom(qaContainer);

    try {
        const response = await fetch(aiConfig.baseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${aiConfig.apiKey}`
            },
            body: JSON.stringify({
                model: aiConfig.model,
                messages: [
                    {
                        role: 'system',
                        content: '你是一个大学课堂助手。请对用户的问题进行补充解答。提供核心原理和1-2个简短的例子，条理清晰，但请控制在 500 字左右，不要长篇大论。使用 Markdown 格式排版。'
                    },
                    {
                        role: 'user',
                        content: originalQa.question
                    }
                ],
                stream: true,
                max_tokens: 1500
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error?.message || '请求失败');
        }

        // Change status from loading to success so we can start rendering text
        detailedQa.status = 'success';
        detailedQa.answer = ''; // Clear loading state
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let done = false;

        while (!done) {
            const { value, done: readerDone } = await reader.read();
            done = readerDone;
            if (value) {
                const chunk = decoder.decode(value, { stream: true });
                // Parse SSE events
                const lines = chunk.split('\n');
                for (const line of lines) {
                    if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                        try {
                            const data = JSON.parse(line.slice(6));
                            if (data.choices && data.choices[0].delta && data.choices[0].delta.content) {
                                detailedQa.answer += data.choices[0].delta.content;
                                updateQaCard(detailedQa);
                                scrollToBottom(qaContainer);
                            }
                        } catch (e) {
                            console.warn('Error parsing stream chunk', e);
                        }
                    }
                }
            }
        }
        
    } catch (error) {
        console.error('API Error:', error);
        detailedQa.answer = `错误: ${error.message}`;
        detailedQa.status = 'error';
    }

    // Final save after stream is complete
    saveState();
    updateQaCard(detailedQa);
    scrollToBottom(qaContainer);
}

// --- Modals & UI interactions ---

function showToast(message, type = 'success') {
    toastMessage.textContent = message;
    const icon = document.getElementById('toast-icon');
    
    if (type === 'success') {
        icon.className = 'fa-solid fa-circle-check text-green-400';
    } else {
        icon.className = 'fa-solid fa-circle-exclamation text-red-400';
    }

    toast.classList.remove('opacity-0', 'translate-y-20');
    toast.classList.add('opacity-100', 'translate-y-0');

    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-20');
        toast.classList.remove('opacity-100', 'translate-y-0');
    }, 3000);
}

function updateSettingsUI() {
    const provider = selectProvider.value;
    
    if (provider === 'custom') {
        advancedSettings.classList.remove('hidden');
        providerLinkContainer.classList.add('hidden');
        inputBaseUrl.readOnly = false;
        inputModel.readOnly = false;
        inputBaseUrl.classList.remove('bg-gray-50', 'text-gray-500');
        inputModel.classList.remove('bg-gray-50', 'text-gray-500');
    } else {
        const config = AI_PROVIDERS[provider];
        inputBaseUrl.value = config.baseUrl;
        inputModel.value = config.model;
        
        providerLink.href = config.link;
        providerLink.innerHTML = `${config.linkText} <i class="fa-solid fa-arrow-up-right-from-square ml-1 text-[10px]"></i>`;
        
        advancedSettings.classList.remove('hidden');
        providerLinkContainer.classList.remove('hidden');
        
        // Make them read-only visually to indicate they are presets
        inputBaseUrl.readOnly = true;
        inputModel.readOnly = true;
        inputBaseUrl.classList.add('bg-gray-50', 'text-gray-500');
        inputModel.classList.add('bg-gray-50', 'text-gray-500');
    }
}

selectProvider.addEventListener('change', () => {
    updateSettingsUI();
    // Clear API key when switching providers (optional, but safer)
    // inputApiKey.value = ''; 
});

function openSettings() {
    selectProvider.value = aiConfig.provider || 'deepseek';
    inputApiKey.value = aiConfig.apiKey;
    inputBaseUrl.value = aiConfig.baseUrl;
    inputModel.value = aiConfig.model;
    
    updateSettingsUI();

    modalSettings.classList.remove('hidden');
    modalSettings.classList.add('flex');
    // small delay for animation
    setTimeout(() => {
        modalContent.classList.remove('scale-95', 'opacity-0');
        modalContent.classList.add('scale-100', 'opacity-100');
    }, 10);
}

function closeSettings() {
    modalContent.classList.remove('scale-100', 'opacity-100');
    modalContent.classList.add('scale-95', 'opacity-0');
    setTimeout(() => {
        modalSettings.classList.add('hidden');
        modalSettings.classList.remove('flex');
    }, 200);
}

function saveSettings() {
    const key = inputApiKey.value.trim();
    const provider = selectProvider.value;
    
    if (!key) {
        showToast('API Key 不能为空', 'error');
        return;
    }

    aiConfig = {
        provider: provider,
        apiKey: key,
        baseUrl: inputBaseUrl.value.trim(),
        model: inputModel.value.trim()
    };
    
    saveConfig();
    closeSettings();
    showToast('配置保存成功');
}

function clearAll() {
    if (confirm('确定要清空当前的听写记录和问答吗？此操作不可恢复。')) {
        finalTranscript = '';
        finalTextEl.textContent = '';
        interimTextEl.textContent = '';
        qaHistory = [];
        qaContainer.innerHTML = '';
        qaContainer.appendChild(emptyStateQa);
        emptyStateTranscript.style.display = 'flex';
        emptyStateQa.style.display = 'flex';
        saveState();
        showToast('已清空所有记录');
    }
}

function exportNotes() {
    if (!finalTranscript && qaHistory.length === 0) {
        showToast('没有可导出的内容', 'error');
        return;
    }

    const dateStr = new Date().toLocaleString('zh-CN', { 
        year: 'numeric', month: '2-digit', day: '2-digit', 
        hour: '2-digit', minute: '2-digit' 
    }).replace(/[\/\s:]/g, '-');

    let markdown = `# 课堂笔记 - ${dateStr}\n\n`;
    
    markdown += `## 课堂听写\n\n${finalTranscript || '无听写内容'}\n\n`;
    
    markdown += `## 智能问答记录\n\n`;
    if (qaHistory.length === 0) {
        markdown += `无问答记录\n`;
    } else {
        qaHistory.forEach((qa, index) => {
            markdown += `### Q${index + 1}: ${qa.question}\n\n`;
            markdown += `**AI 解答:**\n\n${qa.answer}\n\n---\n\n`;
        });
    }

    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `课堂笔记_${dateStr}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showToast('笔记导出成功');
}

// Event Listeners
btnRecord.addEventListener('click', toggleRecording);
btnSettings.addEventListener('click', openSettings);
btnCloseSettings.addEventListener('click', closeSettings);
btnCancelSettings.addEventListener('click', closeSettings);
btnSaveSettings.addEventListener('click', saveSettings);
btnClear.addEventListener('click', clearAll);
btnExport.addEventListener('click', exportNotes);

// Init
loadState();

// Fix marked.js settings (optional)
if (typeof marked !== 'undefined') {
    marked.setOptions({
        breaks: true,
        gfm: true
    });
}