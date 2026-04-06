const BRIDGE_SCRIPT_ID = '__qingyu_adapter_bridge__';
const pendingValidationRequests = new Map();

injectAndroidBridge();

window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data || !event.data.type) {
    return;
  }

  if (event.data.type === 'ANDROID_BRIDGE_CALL') {
    const { method, args, messageId } = event.data;

    chrome.runtime.sendMessage({
      type: 'BRIDGE_CALL_FROM_PAGE',
      method,
      args,
      messageId,
    }).catch((error) => {
      console.error('[AdapterAssistant] Failed to forward bridge call:', error);
    });
    return;
  }

  if (event.data.type === 'VALIDATION_RESULT') {
    const { requestId, validationError } = event.data;
    const callbacks = pendingValidationRequests.get(requestId);
    if (!callbacks) {
      return;
    }
    callbacks.resolveValidation(validationError);
    pendingValidationRequests.delete(requestId);
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request?.type) {
    case 'PING':
      sendResponse({ success: true, url: location.href, title: document.title });
      return true;

    case 'GET_PAGE_CONTEXT':
      sendResponse(collectPageContext());
      return true;

    case 'RELOAD_AND_EXECUTE_JS':
      executeFixedJs('school.js');
      sendResponse({ success: true, message: 'school.js 已重新注入页面。' });
      return true;

    case 'SHOW_INLINE_DIALOG':
      showInlineDialog(request.dialogType, request.args, request.messageId)
        .then((result) => {
          console.log('[AdapterAssistant] Inline dialog resolved:', request.dialogType, result);
        })
        .catch((error) => {
          console.error('[AdapterAssistant] Inline dialog failed:', error);
        });
      sendResponse({ success: true });
      return true;

    case 'RESOLVE_PROMISE_IN_PAGE':
      window.postMessage({
        type: 'ANDROID_BRIDGE_PROMISE_RESPONSE',
        messageId: request.messageId,
        value: request.value,
        isError: request.isError,
      }, window.location.origin);
      sendResponse({ success: true });
      return true;

    default:
      return false;
  }
});

function injectAndroidBridge() {
  if (document.getElementById(BRIDGE_SCRIPT_ID)) {
    return;
  }

  const script = document.createElement('script');
  script.id = BRIDGE_SCRIPT_ID;
  script.src = chrome.runtime.getURL('injected_bridge.js');
  script.charset = 'UTF-8';
  (document.documentElement || document.head || document.body).appendChild(script);
  console.log('[AdapterAssistant] AndroidBridge injected into page context.');
}

function executeFixedJs(jsFileName) {
  const scriptUrl = chrome.runtime.getURL(jsFileName);
  const existing = document.querySelector(`script[src="${scriptUrl}"]`);
  if (existing) {
    existing.remove();
  }

  const script = document.createElement('script');
  script.src = scriptUrl;
  script.charset = 'UTF-8';
  (document.documentElement || document.head || document.body).appendChild(script);
  console.log(`[AdapterAssistant] ${jsFileName} loaded and executed in page context.`);

  chrome.runtime.sendMessage({
    type: 'JS_EXECUTION_STATUS',
    success: true,
    message: `${jsFileName} 已注入页面，等待校内脚本执行结果...`,
  }).catch(() => {});
}

function collectPageContext() {
  const pageText = normalizeSpace(document.body?.innerText || '').slice(0, 2400);
  const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
    .slice(0, 12)
    .map((node) => normalizeSpace(node.textContent || ''))
    .filter(Boolean);

  const forms = Array.from(document.forms)
    .slice(0, 8)
    .map((form, index) => ({
      index,
      id: form.id || '',
      name: form.getAttribute('name') || '',
      method: (form.getAttribute('method') || 'GET').toUpperCase(),
      action: form.getAttribute('action') || '',
      fieldCount: form.elements?.length || 0,
      fields: Array.from(form.elements || [])
        .slice(0, 12)
        .map((element, fieldIndex) => ({
          index: fieldIndex,
          tag: element.tagName?.toLowerCase() || '',
          type: element.getAttribute?.('type') || '',
          name: element.getAttribute?.('name') || '',
          id: element.id || '',
          placeholder: element.getAttribute?.('placeholder') || '',
          text: normalizeSpace(
            element.getAttribute?.('aria-label') ||
              element.getAttribute?.('title') ||
              element.labels?.[0]?.textContent ||
              element.textContent || ''
          ).slice(0, 80),
        })),
    }));

  const tables = Array.from(document.querySelectorAll('table'))
    .slice(0, 8)
    .map((table, index) => {
      const rows = Array.from(table.rows || []);
      const headerCells = Array.from(table.querySelectorAll('th')).map((cell) => normalizeSpace(cell.textContent || ''));
      const fallbackHeaders = rows[0]
        ? Array.from(rows[0].cells || []).map((cell) => normalizeSpace(cell.textContent || ''))
        : [];
      const previewRows = rows.slice(0, 4).map((row) =>
        Array.from(row.cells || []).map((cell) => normalizeSpace(cell.textContent || '').slice(0, 48))
      );

      return {
        index,
        id: table.id || '',
        className: table.className || '',
        rowCount: rows.length,
        columnCount: rows[0]?.cells?.length || 0,
        headers: headerCells.filter(Boolean).length ? headerCells.filter(Boolean).slice(0, 12) : fallbackHeaders.filter(Boolean).slice(0, 12),
        previewRows,
      };
    });

  const resources = (performance.getEntriesByType('resource') || [])
    .slice(-24)
    .map((entry) => ({
      name: entry.name,
      initiatorType: entry.initiatorType || '',
      duration: Math.round(entry.duration || 0),
    }));

  const links = Array.from(document.querySelectorAll('a[href]'))
    .slice(0, 12)
    .map((link) => ({
      text: normalizeSpace(link.textContent || '').slice(0, 60),
      href: link.href,
    }));

  return {
    url: location.href,
    title: document.title,
    readyState: document.readyState,
    headings,
    forms,
    tables,
    links,
    resources,
    pageText,
    capturedAt: new Date().toISOString(),
  };
}

function normalizeSpace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function generatePromiseId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function showInlineDialog(dialogType, args, messageId) {
  return new Promise((resolve) => {
    const existingOverlay = document.getElementById('android-bridge-dialog-overlay');
    if (existingOverlay) {
      existingOverlay.remove();
    }

    const overlay = document.createElement('div');
    overlay.id = 'android-bridge-dialog-overlay';
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.45);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 999999;
      padding: 16px;
      box-sizing: border-box;
    `;

    const dialog = document.createElement('div');
    dialog.id = 'android-bridge-dialog-container';
    dialog.style.cssText = `
      width: min(420px, 100%);
      max-height: min(80vh, 620px);
      overflow: auto;
      background: #fff;
      border-radius: 14px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.22);
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      color: #182033;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    `;

    let titleText = '';
    let contentText = '';
    let confirmText = '确定';
    let cancelText = '取消';
    let defaultValue = '';
    let validatorFnName = '';
    let options = [];
    let selectedOptionIndex = -1;

    if (dialogType === 'alert') {
      titleText = args?.[0] || '提示';
      contentText = args?.[1] || '';
      confirmText = args?.[2] || '确定';
    } else if (dialogType === 'prompt') {
      titleText = args?.[0] || '请输入';
      contentText = args?.[1] || '';
      defaultValue = args?.[2] || '';
      validatorFnName = args?.[3] || '';
    } else if (dialogType === 'singleselection') {
      titleText = args?.[0] || '请选择';
      try {
        options = JSON.parse(args?.[1] || '[]');
        if (!Array.isArray(options)) {
          options = [];
        }
      } catch (_) {
        options = [];
      }
      selectedOptionIndex = Number.isInteger(Number(args?.[2])) ? Number(args[2]) : -1;
    }

    const title = document.createElement('div');
    title.textContent = titleText;
    title.style.cssText = 'font-size: 18px; font-weight: 700;';

    const message = document.createElement('div');
    message.textContent = contentText;
    message.style.cssText = 'font-size: 14px; line-height: 1.5; color: #4b5a73; white-space: pre-wrap;';

    const error = document.createElement('div');
    error.style.cssText = 'display:none; color:#c62828; font-size:12px;';

    dialog.append(title, message, error);

    let input = null;
    if (dialogType === 'prompt') {
      input = document.createElement('input');
      input.type = 'text';
      input.value = defaultValue;
      input.placeholder = contentText;
      input.style.cssText = 'width:100%; padding:10px 12px; border:1px solid #d8dee8; border-radius:10px; font:inherit;';
      dialog.appendChild(input);
    }

    if (dialogType === 'singleselection') {
      const list = document.createElement('div');
      list.style.cssText = 'display:flex; flex-direction:column; gap:8px;';
      options.forEach((optionText, index) => {
        const optionButton = document.createElement('button');
        optionButton.type = 'button';
        optionButton.textContent = optionText;
        optionButton.style.cssText = buttonStyle(index === selectedOptionIndex, true);
        optionButton.addEventListener('click', () => {
          selectedOptionIndex = index;
          Array.from(list.children).forEach((child, childIndex) => {
            child.style.cssText = buttonStyle(childIndex === selectedOptionIndex, true);
          });
        });
        list.appendChild(optionButton);
      });
      dialog.appendChild(list);
    }

    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex; justify-content:flex-end; gap:10px; margin-top:6px;';

    if (dialogType !== 'alert') {
      const cancelButton = document.createElement('button');
      cancelButton.type = 'button';
      cancelButton.textContent = cancelText;
      cancelButton.style.cssText = buttonStyle(false, false);
      cancelButton.addEventListener('click', () => closeDialog(null));
      footer.appendChild(cancelButton);
    }

    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.textContent = confirmText;
    confirmButton.style.cssText = buttonStyle(true, false);
    confirmButton.addEventListener('click', async () => {
      let result = true;

      if (dialogType === 'prompt') {
        const inputValue = input.value;
        if (validatorFnName) {
          const validationRequestId = generatePromiseId();
          const validationPromise = new Promise((resolveValidation) => {
            pendingValidationRequests.set(validationRequestId, { resolveValidation });
          });

          window.postMessage({
            type: 'VALIDATE_PROMPT_INPUT',
            validatorFnName,
            inputValue,
            requestId: validationRequestId,
          }, window.location.origin);

          const validationError = await validationPromise.catch(() => '内部错误：验证失败');
          if (validationError) {
            error.textContent = validationError;
            error.style.display = 'block';
            input.focus();
            return;
          }
        }
        result = inputValue;
      } else if (dialogType === 'singleselection') {
        result = selectedOptionIndex >= 0 ? selectedOptionIndex : null;
      }

      closeDialog(result);
    });
    footer.appendChild(confirmButton);
    dialog.appendChild(footer);

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    input?.focus();

    const escHandler = (event) => {
      if (event.key === 'Escape' && dialogType !== 'alert') {
        closeDialog(null);
      }
    };
    document.addEventListener('keydown', escHandler);

    function closeDialog(value) {
      chrome.runtime.sendMessage({
        type: 'INLINE_DIALOG_RESULT',
        dialogType,
        messageId,
        value,
      }).catch(() => {});

      document.removeEventListener('keydown', escHandler);
      overlay.remove();
      resolve(value);
    }
  });
}

function buttonStyle(primary, block) {
  return [
    block ? 'width:100%; text-align:left;' : '',
    'padding:10px 14px;',
    'border:none;',
    'border-radius:10px;',
    'cursor:pointer;',
    'font:inherit;',
    primary ? 'background:#2b72ff; color:#fff;' : 'background:#eef2f8; color:#182033;',
  ].join(' ');
}
