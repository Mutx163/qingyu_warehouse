const EXPORT_FILENAME = 'CourseTableExport.json';
const AUTHORIZED_TABS_KEY = 'adapterAssistantAuthorizedTabs';
const EXPORT_RESULT_KEY = 'adapterAssistantLastExportResult';

let cachedCourses = null;
let cachedTimeSlots = null;
let cachedCourseConfig = null;
let lastExportSummary = null;
let lastExportResult = null;
let lastExecutionStatus = null;

initializeSidePanelBehavior();

chrome.runtime.onInstalled.addListener(() => {
  initializeSidePanelBehavior();
});

chrome.runtime.onStartup.addListener(() => {
  initializeSidePanelBehavior();
});

chrome.action.onClicked.addListener(async (tab) => {
  await openWorkbenchSidePanel(tab);
});

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
      case 'GET_LAST_EXPORT_RESULT':
        sendResponse(await getLastExportResultResponse());
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
        await updateLastExecutionStatus({
          success: Boolean(message?.success),
          message: message?.message || '脚本执行状态已更新。',
          phase: message?.phase || 'runtime-status',
          persistOnly: true,
        });
        if (!message?.forwardedByBackground) {
          broadcastRuntimeMessage({
            ...message,
            updatedAt: lastExecutionStatus?.updatedAt,
            forwardedByBackground: true,
          });
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

async function initializeSidePanelBehavior() {
  if (!chrome.sidePanel?.setPanelBehavior) {
    return;
  }
  try {
    await chrome.sidePanel.setOptions({
      path: 'popup.html',
      enabled: true,
    });
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    console.warn('[AdapterAssistant] failed to enable side panel action behavior:', error);
  }
}

async function openWorkbenchSidePanel(tab) {
  if (!chrome.sidePanel?.open) {
    console.warn('[AdapterAssistant] sidePanel API is unavailable in this browser build.');
    return;
  }
  try {
    if (tab?.windowId) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
      return;
    }
    const currentWindow = await chrome.windows.getCurrent();
    if (currentWindow?.id) {
      await chrome.sidePanel.open({ windowId: currentWindow.id });
    }
  } catch (error) {
    console.warn('[AdapterAssistant] failed to open side panel from action click:', error);
  }
}

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
      if (method === 'showAlert') {
        const title = String(args[0] || '').trim();
        const content = String(args[1] || '').trim();
        await updateLastExecutionStatus({
          success: false,
          phase: 'script-alert',
          message: [title, content].filter(Boolean).join('：') || '脚本主动弹出了错误提示。',
        });
      }
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
        phase: result.success ? 'completed' : 'complete-with-error',
        message: result.success
          ? lastExecutionStatus?.message || '校内脚本已执行完毕，测试结果已回传到插件内。'
          : `校内脚本执行完毕，但结果整理失败：${result.message}`,
        updatedAt: lastExecutionStatus?.updatedAt || new Date().toISOString(),
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
    await updateLastExecutionStatus({
      success: false,
      phase: 'bridge-parse-error',
      message: `${errorPrefix}: ${error.message}`,
      persistOnly: true,
    });
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
  try {
    const summary = buildExportSummary(exportData, source);
    lastExportSummary = summary;
    lastExportResult = {
      summary,
      exportData,
    };
    await updateLastExecutionStatus({
      success: true,
      phase: 'exported',
      message: `脚本已生成结果：${summary.courseCount} 门课，${summary.timeSlotCount} 个时间段${summary.hasConfig ? '，含学期配置' : ''}。`,
      persistOnly: true,
    });
    broadcastRuntimeMessage({
      type: 'EXPORT_SUMMARY_UPDATED',
      summary,
      exportData,
      executionStatus: lastExecutionStatus,
    });
    resetCachedExportData();
    return { success: true, summary, exportData };
  } catch (error) {
    await updateLastExecutionStatus({
      success: false,
      phase: 'export-failed',
      message: error?.message || String(error),
    });
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
    delivery: 'in-app',
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
  lastExportSummary = null;
  lastExportResult = null;
  await updateLastExecutionStatus({
    success: true,
    phase: 'started',
    message: '草稿脚本已注入当前页面，等待脚本执行结果...',
    persistOnly: true,
  });
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

async function getLastExportResultResponse() {
  if (lastExportResult) {
    return {
      success: true,
      lastExportSummary: lastExportResult.summary,
      lastExportData: lastExportResult.exportData,
      lastExecutionStatus,
    };
  }

  const stored = await chrome.storage.session.get(EXPORT_RESULT_KEY);
  const saved = stored?.[EXPORT_RESULT_KEY] || null;
  if (saved) {
    lastExportResult = saved?.summary || saved?.exportData
      ? {
          summary: saved.summary || null,
          exportData: saved.exportData || null,
        }
      : null;
    lastExecutionStatus = saved.executionStatus || null;
  }

  return {
    success: true,
    lastExportSummary: saved?.summary || null,
    lastExportData: saved?.exportData || null,
    lastExecutionStatus: saved?.executionStatus || null,
  };
}

async function updateLastExecutionStatus(status) {
  lastExecutionStatus = {
    success: Boolean(status?.success),
    phase: status?.phase || 'runtime-status',
    message: String(status?.message || '').trim() || '脚本执行状态已更新。',
    updatedAt: new Date().toISOString(),
  };
  await persistLastExportResultState();
  if (!status?.persistOnly) {
    broadcastRuntimeMessage({
      type: 'JS_EXECUTION_STATUS',
      success: lastExecutionStatus.success,
      phase: lastExecutionStatus.phase,
      message: lastExecutionStatus.message,
      updatedAt: lastExecutionStatus.updatedAt,
      forwardedByBackground: true,
    });
  }
}

async function persistLastExportResultState() {
  await chrome.storage.session.set({
    [EXPORT_RESULT_KEY]: {
      summary: lastExportSummary,
      exportData: lastExportResult?.exportData || null,
      executionStatus: lastExecutionStatus,
    },
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
