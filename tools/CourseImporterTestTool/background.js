const EXPORT_FILENAME = 'CourseTableExport.json';
const AUTHORIZED_TABS_KEY = 'adapterAssistantAuthorizedTabs';

let cachedCourses = null;
let cachedTimeSlots = null;
let cachedCourseConfig = null;
let lastExportSummary = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case 'BRIDGE_CALL_FROM_PAGE':
        sendResponse(await handleBridgeCall(message, sender));
        return;
      case 'EXPORT_DATA_REQUEST':
        sendResponse(await handleExportRequest('manual-export'));
        return;
      case 'GET_LAST_EXPORT_SUMMARY':
        sendResponse({ success: true, lastExportSummary });
        return;
      case 'RUN_SCRIPT_SOURCE_REQUEST':
        sendResponse(await runDynamicScriptSource(message.scriptSource));
        return;
      case 'RELOAD_AND_EXECUTE_JS_REQUEST':
        sendResponse(await reloadAndExecuteFixedScript());
        return;
      case 'INLINE_DIALOG_RESULT':
        sendResponse(await handleInlineDialogResult(message, sender));
        return;
      case 'JS_EXECUTION_STATUS':
        if (!message?.forwardedByBackground) {
          broadcastRuntimeMessage({ ...message, forwardedByBackground: true });
        }
        sendResponse({ success: true });
        return;
      default:
        sendResponse({ success: false, message: 'Unknown message type.' });
    }
  })().catch((error) => {
    console.error('[AdapterAssistant] background error:', error);
    sendResponse({ success: false, message: error?.message || String(error) });
  });

  return true;
});

async function handleBridgeCall(message, sender) {
  const tabId = sender?.tab?.id;
  const { method, args = [], messageId } = message;

  if (!tabId || !(await isTabAuthorized(tabId))) {
    if (tabId && messageId) {
      await resolvePromiseInPage(
        tabId,
        messageId,
        '当前页面还没有进入测试会话，请从扩展里点击“运行当前脚本”后再调用桥接能力。',
        true
      );
    }
    return {
      success: false,
      message: '当前页面还没有进入测试会话，请从扩展里点击“运行当前脚本”后再调用桥接能力。',
    };
  }

  switch (method) {
    case 'showToast':
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: '模拟 Toast',
        message: args[0] || '收到一条提示',
        silent: true,
      });
      return { success: true };

    case 'showAlert':
    case 'showPrompt':
    case 'showSingleSelection':
      if (!tabId) {
        return { success: false, message: '当前标签页不可用，无法显示内联弹窗。' };
      }
      await chrome.tabs.sendMessage(tabId, {
        type: 'SHOW_INLINE_DIALOG',
        dialogType: method.replace('show', '').toLowerCase(),
        args,
        messageId,
      });
      return { success: true };

    case 'saveImportedCourses':
      return cacheBridgePayload({
        tabId,
        promiseId: args[1],
        parser: JSON.parse,
        raw: args[0],
        assign(value) {
          cachedCourses = value;
        },
        successValue: true,
        errorPrefix: '解析课程数据时出错',
      });

    case 'savePresetTimeSlots':
      return cacheBridgePayload({
        tabId,
        promiseId: args[1],
        parser: JSON.parse,
        raw: args[0],
        assign(value) {
          cachedTimeSlots = value;
        },
        successValue: true,
        errorPrefix: '解析时间段数据时出错',
      });

    case 'saveCourseConfig':
      return cacheBridgePayload({
        tabId,
        promiseId: args[1],
        parser: JSON.parse,
        raw: args[0],
        assign(value) {
          cachedCourseConfig = value;
        },
        successValue: true,
        errorPrefix: '课程配置导入失败',
      });

    case 'notifyTaskCompletion': {
      const result = await handleExportRequest('notify-task-completion');
      await clearAuthorizedTab(tabId);
      broadcastRuntimeMessage({
        type: 'JS_EXECUTION_STATUS',
        success: result.success,
        message: result.success
          ? '校内脚本已执行完毕，已生成导出结果。'
          : `校内脚本执行完毕，但导出失败：${result.message}`,
      });
      return result;
    }

    default:
      console.warn('[AdapterAssistant] Unknown AndroidBridge method:', method);
      return { success: false, message: 'Unknown AndroidBridge method' };
  }
}

async function cacheBridgePayload({
  tabId,
  promiseId,
  parser,
  raw,
  assign,
  successValue,
  errorPrefix,
}) {
  try {
    const parsed = parser(raw);
    assign(parsed);
    await resolvePromiseInPage(tabId, promiseId, successValue, false);
    return { success: true };
  } catch (error) {
    await resolvePromiseInPage(tabId, promiseId, `${errorPrefix}: ${error.message}`, true);
    return { success: false, message: `${errorPrefix}: ${error.message}` };
  }
}

async function handleExportRequest(source) {
  const exportData = {
    courses: cachedCourses,
    timeSlots: cachedTimeSlots,
    config: cachedCourseConfig,
  };
  const exportJsonString = JSON.stringify(exportData, null, 2);
  const dataUrl = `data:application/json;charset=utf-8,${encodeURIComponent(exportJsonString)}`;

  try {
    await chrome.downloads.download({
      url: dataUrl,
      filename: EXPORT_FILENAME,
      saveAs: true,
    });

    const summary = buildExportSummary(exportData, source);
    lastExportSummary = summary;
    broadcastRuntimeMessage({ type: 'EXPORT_SUMMARY_UPDATED', summary });
    resetCachedExportData();
    return { success: true, summary };
  } catch (error) {
    resetCachedExportData();
    return { success: false, message: error?.message || String(error) };
  }
}

function buildExportSummary(exportData, source) {
  const courseCount = Array.isArray(exportData.courses) ? exportData.courses.length : 0;
  const timeSlotCount = Array.isArray(exportData.timeSlots) ? exportData.timeSlots.length : 0;
  const hasConfig = Boolean(exportData.config && typeof exportData.config === 'object');

  return {
    filename: EXPORT_FILENAME,
    courseCount,
    timeSlotCount,
    hasConfig,
    source,
    updatedAt: new Date().toISOString(),
  };
}

function resetCachedExportData() {
  cachedCourses = null;
  cachedTimeSlots = null;
  cachedCourseConfig = null;
}

async function runDynamicScriptSource(scriptSource) {
  const source = String(scriptSource || '').trim();
  if (!source) {
    return { success: false, message: '脚本内容为空。' };
  }

  resetCachedExportData();
  const tab = await getActiveNormalTab();
  await ensureContentScriptReady(tab.id);
  await authorizeTab(tab.id);

  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    args: [source],
    func: (draftSource) => {
      try {
        const existing = document.getElementById('__qingyu_adapter_assistant_draft__');
        if (existing) {
          existing.remove();
        }

        const script = document.createElement('script');
        script.id = '__qingyu_adapter_assistant_draft__';
        script.type = 'text/javascript';
        script.textContent = `${draftSource}\n//# sourceURL=adapter-assistant-draft.js`;
        (document.documentElement || document.head || document.body).appendChild(script);
        script.remove();

        return { success: true, message: '草稿脚本已注入当前页面，等待脚本执行结果...' };
      } catch (error) {
        return { success: false, message: error?.message || String(error) };
      }
    },
  });

  if (!result?.result?.success) {
    return { success: false, message: result?.result?.message || '脚本注入失败。' };
  }

  broadcastRuntimeMessage({
    type: 'JS_EXECUTION_STATUS',
    success: true,
    message: result.result.message,
  });

  return result.result;
}

async function reloadAndExecuteFixedScript() {
  resetCachedExportData();
  const tab = await getActiveNormalTab();
  await ensureContentScriptReady(tab.id);
  await authorizeTab(tab.id);
  return chrome.tabs.sendMessage(tab.id, { type: 'RELOAD_AND_EXECUTE_JS' });
}

async function handleInlineDialogResult(message, sender) {
  const tabId = sender?.tab?.id;
  if (!tabId) {
    return { success: false, message: '缺少来源标签页，无法回填弹窗结果。' };
  }

  const processedValue = normalizeInlineDialogValue(message.value);
  await resolvePromiseInPage(tabId, message.messageId, processedValue, false);
  return { success: true };
}

async function resolvePromiseInPage(tabId, messageId, value, isError) {
  if (!tabId || !messageId) {
    return;
  }
  await chrome.tabs.sendMessage(tabId, {
    type: 'RESOLVE_PROMISE_IN_PAGE',
    messageId,
    value,
    isError,
  });
}

function normalizeInlineDialogValue(value) {
  if (value === null || value === undefined) {
    return value;
  }

  let processedValue = value;
  if (typeof processedValue === 'string' && processedValue.length >= 2) {
    const firstChar = processedValue.charAt(0);
    const lastChar = processedValue.charAt(processedValue.length - 1);
    if ((firstChar === '"' && lastChar === '"') || (firstChar === '\'' && lastChar === '\'')) {
      processedValue = processedValue.slice(1, -1);
    }
  }

  if (processedValue === 'true') return true;
  if (processedValue === 'false') return false;
  if (processedValue === 'null') return null;

  if (typeof processedValue === 'string' && processedValue.trim() !== '') {
    const numberValue = Number(processedValue);
    if (!Number.isNaN(numberValue) && String(numberValue) === processedValue.trim()) {
      return numberValue;
    }
  }

  return processedValue;
}

async function getActiveNormalTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error('当前没有可用标签页。');
  }
  if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
    throw new Error('当前页面无法运行脚本，请切换到普通网页。');
  }
  return tab;
}

async function ensureContentScriptReady(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    if (response?.success) {
      return true;
    }
  } catch (_) {
    // noop
  }
  throw new Error('当前页面还没有注入扩展内容脚本。请先刷新目标教务页面，再重新打开扩展重试。');
}

function broadcastRuntimeMessage(payload) {
  chrome.runtime.sendMessage(payload).catch(() => {
    // Popup may be closed; ignore.
  });
}

async function authorizeTab(tabId) {
  const authorizedTabs = await readAuthorizedTabs();
  authorizedTabs[String(tabId)] = Date.now() + 10 * 60 * 1000;
  await chrome.storage.session.set({ [AUTHORIZED_TABS_KEY]: authorizedTabs });
}

async function isTabAuthorized(tabId) {
  const authorizedTabs = await readAuthorizedTabs();
  const key = String(tabId);
  const expiresAt = authorizedTabs[key];
  if (!expiresAt) {
    return false;
  }
  if (Date.now() > expiresAt) {
    delete authorizedTabs[key];
    await chrome.storage.session.set({ [AUTHORIZED_TABS_KEY]: authorizedTabs });
    return false;
  }
  return true;
}

async function clearAuthorizedTab(tabId) {
  const authorizedTabs = await readAuthorizedTabs();
  delete authorizedTabs[String(tabId)];
  await chrome.storage.session.set({ [AUTHORIZED_TABS_KEY]: authorizedTabs });
}

async function readAuthorizedTabs() {
  const stored = await chrome.storage.session.get(AUTHORIZED_TABS_KEY);
  return stored?.[AUTHORIZED_TABS_KEY] || {};
}
