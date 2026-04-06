const STORAGE_KEY = 'adapterAssistantStateV1';
const SESSION_KEY = 'adapterAssistantSessionV1';
const DEFAULT_STATE = {
  repoSettings: {
    owner: 'Mutx163',
    repo: 'qingyu_warehouse',
    branch: 'main',
  },
  schools: [],
  adaptersBySchool: {},
  schoolSearch: '',
  selectedSchoolId: '',
  selectedExistingAdapterId: '',
  createNewSchool: false,
  school: {
    id: '',
    name: '',
    initial: '',
    resource_folder: '',
  },
  adapter: {
    adapter_id: '',
    adapter_name: '',
    category: 'BACHELOR_AND_ASSOCIATE',
    asset_js_path: '',
    import_url: '',
    maintainer: '',
    description: '',
  },
  scriptSource: '',
  pageContext: null,
  generatedPrompt: '',
  lastExportSummary: null,
  github: {
    token: '',
    userLogin: '',
  },
  pr: {
    title: '',
    body: '',
  },
};

let state = structuredClone(DEFAULT_STATE);
let persistTimer = null;
let isInitializing = true;

const dom = {};

document.addEventListener('DOMContentLoaded', async () => {
  bindDom();
  bindEvents();
  await loadState();
  renderAll();
  isInitializing = false;

  if (!state.schools.length) {
    await syncWarehouse({ announce: false });
  } else if (state.selectedSchoolId) {
    await ensureSchoolAdaptersLoaded(state.selectedSchoolId, { announce: false });
    renderAll();
  }

  try {
    const summary = await chrome.runtime.sendMessage({ type: 'GET_LAST_EXPORT_SUMMARY' });
    if (summary?.lastExportSummary) {
      state.lastExportSummary = summary.lastExportSummary;
      renderTestSummary();
    }
  } catch (_) {}
});

function bindDom() {
  [
    'statusMessage',
    'schoolCountBadge',
    'repoOwnerInput',
    'repoNameInput',
    'repoBranchInput',
    'schoolSearchInput',
    'syncWarehouseButton',
    'toggleNewSchoolButton',
    'schoolSelect',
    'existingAdapterSelect',
    'loadExistingAdapterButton',
    'refreshAdaptersButton',
    'schoolIdInput',
    'schoolNameInput',
    'schoolInitialInput',
    'schoolResourceFolderInput',
    'adapterIdInput',
    'adapterNameInput',
    'adapterCategorySelect',
    'assetJsPathInput',
    'importUrlInput',
    'maintainerInput',
    'descriptionInput',
    'generatedFilesPreview',
    'captureContextButton',
    'generatePromptButton',
    'copyPromptButton',
    'pageContextSummary',
    'promptTextarea',
    'pasteScriptButton',
    'runTestButton',
    'clearScriptButton',
    'scriptTextarea',
    'testSummary',
    'githubLoginBadge',
    'githubTokenInput',
    'githubLoginButton',
    'openPatGuideButton',
    'prTitleInput',
    'prBodyTextarea',
    'submitPrButton',
  ].forEach((id) => {
    dom[id] = document.getElementById(id);
  });
}

function bindEvents() {
  dom.syncWarehouseButton.addEventListener('click', () => syncWarehouse({ announce: true }));
  dom.toggleNewSchoolButton.addEventListener('click', toggleSchoolMode);
  dom.schoolSearchInput.addEventListener('input', () => {
    state.schoolSearch = dom.schoolSearchInput.value;
    renderSchoolOptions();
    schedulePersist();
  });
  dom.schoolSelect.addEventListener('change', async () => {
    state.selectedSchoolId = dom.schoolSelect.value;
    state.createNewSchool = false;
    state.selectedExistingAdapterId = '';
    applySelectedSchoolToState();
    await ensureSchoolAdaptersLoaded(state.selectedSchoolId, { announce: false });
    renderAll();
    schedulePersist();
  });
  dom.existingAdapterSelect.addEventListener('change', () => {
    state.selectedExistingAdapterId = dom.existingAdapterSelect.value;
    schedulePersist();
  });
  dom.refreshAdaptersButton.addEventListener('click', async () => {
    if (!state.selectedSchoolId) {
      showStatus('请先选择学校。', 'warn');
      return;
    }
    delete state.adaptersBySchool[getCurrentSchoolResourceFolder()];
    await ensureSchoolAdaptersLoaded(state.selectedSchoolId, { force: true, announce: true });
    renderAll();
    schedulePersist();
  });
  dom.loadExistingAdapterButton.addEventListener('click', loadExistingAdapter);
  dom.captureContextButton.addEventListener('click', capturePageContext);
  dom.generatePromptButton.addEventListener('click', generatePrompt);
  dom.copyPromptButton.addEventListener('click', async () => {
    const prompt = dom.promptTextarea.value.trim();
    if (!prompt) {
      showStatus('还没有生成指令。', 'warn');
      return;
    }
    await navigator.clipboard.writeText(prompt);
    showStatus('已复制 AI 指令。', 'success');
  });
  dom.pasteScriptButton.addEventListener('click', pasteScriptFromClipboard);
  dom.runTestButton.addEventListener('click', runCurrentScript);
  dom.clearScriptButton.addEventListener('click', () => {
    state.scriptSource = '';
    dom.scriptTextarea.value = '';
    schedulePersist();
    showStatus('已清空当前脚本草稿。');
  });
  dom.githubLoginButton.addEventListener('click', loginGithub);
  dom.openPatGuideButton.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://github.com/settings/personal-access-tokens/new' });
  });
  dom.submitPrButton.addEventListener('click', submitPullRequest);

  document.querySelectorAll('input, textarea, select').forEach((element) => {
    if (['schoolSelect', 'existingAdapterSelect', 'schoolSearchInput'].includes(element.id)) {
      return;
    }
    element.addEventListener('input', () => {
      if (isInitializing) {
        return;
      }
      syncStateFromForm();
      renderDerivedViews();
      schedulePersist();
    });
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'JS_EXECUTION_STATUS') {
      showStatus(message.message || '脚本执行状态已更新。', message.success ? 'success' : 'error');
    }
    if (message.type === 'EXPORT_SUMMARY_UPDATED') {
      state.lastExportSummary = message.summary;
      renderTestSummary();
      schedulePersist();
      showStatus('已收到本次测试导出结果，可继续调整脚本。', 'success');
    }
  });
}

async function loadState() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const sessionStored = await chrome.storage.session.get(SESSION_KEY);
  const saved = stored?.[STORAGE_KEY] || {};
  const session = sessionStored?.[SESSION_KEY] || {};
  state = {
    ...structuredClone(DEFAULT_STATE),
    ...saved,
    repoSettings: {
      ...DEFAULT_STATE.repoSettings,
      ...(saved.repoSettings || {}),
    },
    school: {
      ...DEFAULT_STATE.school,
      ...(saved.school || {}),
    },
    adapter: {
      ...DEFAULT_STATE.adapter,
      ...(saved.adapter || {}),
    },
    github: {
      ...DEFAULT_STATE.github,
      userLogin: saved?.github?.userLogin || '',
      token: session?.github?.token || '',
    },
    pr: {
      ...DEFAULT_STATE.pr,
      ...(saved.pr || {}),
    },
    adaptersBySchool: saved.adaptersBySchool || {},
    schools: Array.isArray(saved.schools) ? saved.schools : [],
  };
}

function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    chrome.storage.local.set({
      [STORAGE_KEY]: {
        ...state,
        github: {
          userLogin: state.github.userLogin || '',
        },
      },
    });
  }, 150);
}

function renderAll() {
  dom.repoOwnerInput.value = state.repoSettings.owner;
  dom.repoNameInput.value = state.repoSettings.repo;
  dom.repoBranchInput.value = state.repoSettings.branch;
  dom.schoolSearchInput.value = state.schoolSearch;
  dom.githubTokenInput.value = state.github.token || '';
  dom.prTitleInput.value = state.pr.title;
  dom.prBodyTextarea.value = state.pr.body;
  dom.scriptTextarea.value = state.scriptSource;
  dom.promptTextarea.value = state.generatedPrompt;
  renderSchoolOptions();
  renderAdapterOptions();
  renderFormFields();
  renderGithubStatus();
  renderContextSummary();
  renderTestSummary();
  renderDerivedViews();
}

function renderFormFields() {
  dom.schoolIdInput.value = state.school.id;
  dom.schoolNameInput.value = state.school.name;
  dom.schoolInitialInput.value = state.school.initial;
  dom.schoolResourceFolderInput.value = state.school.resource_folder;
  dom.adapterIdInput.value = state.adapter.adapter_id;
  dom.adapterNameInput.value = state.adapter.adapter_name;
  dom.adapterCategorySelect.value = state.adapter.category;
  dom.assetJsPathInput.value = state.adapter.asset_js_path;
  dom.importUrlInput.value = state.adapter.import_url;
  dom.maintainerInput.value = state.adapter.maintainer;
  dom.descriptionInput.value = state.adapter.description;

  const readOnly = !state.createNewSchool && Boolean(state.selectedSchoolId);
  ['schoolIdInput', 'schoolNameInput', 'schoolInitialInput', 'schoolResourceFolderInput'].forEach((id) => {
    dom[id].readOnly = readOnly;
  });
  dom.toggleNewSchoolButton.textContent = state.createNewSchool ? '切换：使用已有学校' : '切换：新建学校';
}

function renderSchoolOptions() {
  const keyword = state.schoolSearch.trim().toLowerCase();
  const filtered = state.schools.filter((school) => {
    if (!keyword) return true;
    return [school.name, school.id, school.initial, school.resource_folder]
      .filter(Boolean)
      .some((value) => value.toLowerCase().includes(keyword));
  });

  dom.schoolSelect.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = filtered.length ? '请选择学校' : '没有匹配学校';
  dom.schoolSelect.appendChild(placeholder);

  filtered.forEach((school) => {
    const option = document.createElement('option');
    option.value = school.id;
    option.textContent = `${school.name} (${school.id})`;
    if (school.id === state.selectedSchoolId) {
      option.selected = true;
    }
    dom.schoolSelect.appendChild(option);
  });

  dom.schoolCountBadge.textContent = state.schools.length ? `${state.schools.length} 所学校` : '未同步';
}

function renderAdapterOptions() {
  const adapters = getCurrentAdapters();
  dom.existingAdapterSelect.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = adapters.length ? '可选：载入现有适配器' : '暂无已读取适配器';
  dom.existingAdapterSelect.appendChild(placeholder);
  adapters.forEach((adapter) => {
    const option = document.createElement('option');
    option.value = adapter.adapter_id;
    option.textContent = `${adapter.adapter_name} (${adapter.adapter_id})`;
    if (adapter.adapter_id === state.selectedExistingAdapterId) {
      option.selected = true;
    }
    dom.existingAdapterSelect.appendChild(option);
  });
}

function renderGithubStatus() {
  dom.githubLoginBadge.textContent = state.github.userLogin ? `已登录 ${state.github.userLogin}` : '未登录';
}

function renderContextSummary() {
  if (!state.pageContext) {
    dom.pageContextSummary.textContent = '还没有抓取页面上下文。';
    return;
  }
  const context = state.pageContext;
  const lines = [
    `标题：${context.title || '未知'}`,
    `地址：${context.url || '未知'}`,
    `表格摘要：${(context.tables || []).length} 个`,
    `表单字段：${(context.forms || []).length} 个`,
    `资源请求：${(context.resources || []).length} 条`,
    `正文片段：${(context.pageText || '').slice(0, 180).replace(/\s+/g, ' ')}${(context.pageText || '').length > 180 ? '…' : ''}`,
  ];
  dom.pageContextSummary.textContent = lines.join('\n');
}

function renderTestSummary() {
  if (!state.lastExportSummary) {
    dom.testSummary.textContent = '还没有测试结果。';
    return;
  }
  const summary = state.lastExportSummary;
  const lines = [
    `课程数：${summary.courseCount ?? 0}`,
    `时间段数：${summary.timeSlotCount ?? 0}`,
    `有学期配置：${summary.hasConfig ? '是' : '否'}`,
    `导出文件：${summary.filename || 'CourseTableExport.json'}`,
    `更新时间：${summary.updatedAt || '未知'}`,
  ];
  dom.testSummary.textContent = lines.join('\n');
}

function renderDerivedViews() {
  syncStateFromForm();
  dom.generatedFilesPreview.textContent = buildFilePreviewText();
  if (!state.pr.title.trim()) {
    dom.prTitleInput.value = buildDefaultPrTitle();
    state.pr.title = dom.prTitleInput.value;
  }
  if (!state.pr.body.trim()) {
    dom.prBodyTextarea.value = buildDefaultPrBody();
    state.pr.body = dom.prBodyTextarea.value;
  }
}

function syncStateFromForm() {
  state.repoSettings.owner = dom.repoOwnerInput.value.trim() || DEFAULT_STATE.repoSettings.owner;
  state.repoSettings.repo = dom.repoNameInput.value.trim() || DEFAULT_STATE.repoSettings.repo;
  state.repoSettings.branch = dom.repoBranchInput.value.trim() || DEFAULT_STATE.repoSettings.branch;
  state.school.id = dom.schoolIdInput.value.trim();
  state.school.name = dom.schoolNameInput.value.trim();
  state.school.initial = dom.schoolInitialInput.value.trim().slice(0, 1).toUpperCase();
  state.school.resource_folder = dom.schoolResourceFolderInput.value.trim();
  state.adapter.adapter_id = dom.adapterIdInput.value.trim();
  state.adapter.adapter_name = dom.adapterNameInput.value.trim();
  state.adapter.category = dom.adapterCategorySelect.value;
  state.adapter.asset_js_path = dom.assetJsPathInput.value.trim();
  state.adapter.import_url = dom.importUrlInput.value.trim();
  state.adapter.maintainer = dom.maintainerInput.value.trim();
  state.adapter.description = dom.descriptionInput.value;
  state.scriptSource = dom.scriptTextarea.value;
  state.generatedPrompt = dom.promptTextarea.value;
  state.github.token = dom.githubTokenInput.value.trim();
  state.pr.title = dom.prTitleInput.value;
  state.pr.body = dom.prBodyTextarea.value;
}

function toggleSchoolMode() {
  state.createNewSchool = !state.createNewSchool;
  if (state.createNewSchool) {
    state.selectedSchoolId = '';
    state.selectedExistingAdapterId = '';
    if (!state.school.id && !state.school.name) {
      state.school = structuredClone(DEFAULT_STATE.school);
    }
  } else {
    applySelectedSchoolToState();
  }
  renderAll();
  schedulePersist();
}

function applySelectedSchoolToState() {
  const school = state.schools.find((item) => item.id === state.selectedSchoolId);
  if (!school) {
    return;
  }
  state.school = {
    id: school.id,
    name: school.name,
    initial: school.initial,
    resource_folder: school.resource_folder,
  };
}

function getCurrentSchoolResourceFolder() {
  return state.school.resource_folder || state.schools.find((item) => item.id === state.selectedSchoolId)?.resource_folder || '';
}

function getCurrentAdapters() {
  const folder = getCurrentSchoolResourceFolder();
  return folder ? state.adaptersBySchool[folder] || [] : [];
}

async function syncWarehouse({ announce }) {
  try {
    syncStateFromForm();
    setBusy(dom.syncWarehouseButton, true, '同步中...');
    if (announce) {
      showStatus('正在同步学校列表...');
    }
    const rawText = await fetchRawFile('index/root_index.yaml');
    const schools = parseCollectionYaml(rawText, 'schools').map(normalizeSchoolEntry);
    schools.sort((a, b) => (a.initial || '').localeCompare(b.initial || '') || a.name.localeCompare(b.name));
    state.schools = schools;
    if (!state.createNewSchool && state.selectedSchoolId) {
      applySelectedSchoolToState();
    }
    renderAll();
    schedulePersist();
    if (announce) {
      showStatus(`已同步 ${schools.length} 所学校。`, 'success');
    }
  } catch (error) {
    showStatus(`同步学校列表失败：${formatError(error)}`, 'error');
  } finally {
    setBusy(dom.syncWarehouseButton, false, '同步学校列表');
  }
}

async function ensureSchoolAdaptersLoaded(schoolId, { force = false, announce = false } = {}) {
  const school = state.schools.find((item) => item.id === schoolId);
  if (!school) {
    return [];
  }
  const folder = school.resource_folder;
  if (!force && state.adaptersBySchool[folder]) {
    return state.adaptersBySchool[folder];
  }
  try {
    const rawText = await fetchRawFile(`resources/${folder}/adapters.yaml`);
    const adapters = parseCollectionYaml(rawText, 'adapters').map(normalizeAdapterEntry);
    state.adaptersBySchool[folder] = adapters;
    if (announce) {
      showStatus(`已读取 ${school.name} 的 ${adapters.length} 个适配器。`, 'success');
    }
    return adapters;
  } catch (error) {
    state.adaptersBySchool[folder] = [];
    if (announce) {
      showStatus(`读取适配器失败：${formatError(error)}`, 'error');
    }
    return [];
  }
}

async function loadExistingAdapter() {
  try {
    const adapterId = dom.existingAdapterSelect.value;
    if (!adapterId) {
      showStatus('请先选择一个已有适配器。', 'warn');
      return;
    }
    const school = state.schools.find((item) => item.id === state.selectedSchoolId);
    if (!school) {
      showStatus('请先选择学校。', 'warn');
      return;
    }
    const adapters = await ensureSchoolAdaptersLoaded(school.id, { announce: false });
    const adapter = adapters.find((item) => item.adapter_id === adapterId);
    if (!adapter) {
      showStatus('没有找到这个适配器。', 'error');
      return;
    }
    state.adapter = { ...adapter };
    const scriptText = await fetchRawFile(`resources/${school.resource_folder}/${adapter.asset_js_path}`);
    state.scriptSource = scriptText;
    dom.scriptTextarea.value = scriptText;
    renderAll();
    schedulePersist();
    showStatus(`已载入适配器 ${adapter.adapter_name}，可基于它继续修改。`, 'success');
  } catch (error) {
    showStatus(`载入现有适配器失败：${formatError(error)}`, 'error');
  }
}

async function capturePageContext() {
  try {
    showStatus('正在抓取当前页面上下文...');
    const tab = await getActiveTab();
    if (!tab?.id) {
      throw new Error('当前没有可用标签页');
    }
    const context = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_CONTEXT' });
    state.pageContext = context;
    renderContextSummary();
    schedulePersist();
    showStatus('已抓取当前页面上下文。', 'success');
  } catch (error) {
    showStatus(`抓取页面上下文失败：${formatError(error)}。如果刚装扩展，请刷新教务页面后重试。`, 'error');
  }
}

function generatePrompt() {
  syncStateFromForm();
  if (!state.pageContext) {
    showStatus('请先抓取当前页面上下文。', 'warn');
    return;
  }
  const schoolModeText = state.createNewSchool ? '新建学校' : '已有学校';
  const prompt = [
    '你是 qingyu_warehouse 的教务适配脚本生成器。',
    '请根据下面的学校元数据、适配器信息和页面上下文，输出一个可直接运行的 JavaScript 适配脚本。',
    '',
    '硬性要求：',
    '1. 只输出 JavaScript 代码，不要 Markdown 代码块，不要解释。',
    '2. 成功时调用 window.AndroidBridgePromise.saveImportedCourses(...)，如有时间模板/学期配置可额外调用 savePresetTimeSlots / saveCourseConfig。',
    '3. 脚本结束前调用 AndroidBridge.notifyTaskCompletion()。',
    '4. 出错时使用 window.AndroidBridgePromise.showAlert(...) 给出可读错误。',
    '5. 课程字段必须兼容 qingyu_warehouse：name/teacher/position/day/weeks，以及普通课程的 startSection/endSection 或自定义时间字段。',
    '',
    `学校模式：${schoolModeText}`,
    `学校 ID：${state.school.id || '(待补充)'}`,
    `学校名称：${state.school.name || '(待补充)'}`,
    `学校首字母：${state.school.initial || '(待补充)'}`,
    `资源目录：${state.school.resource_folder || '(待补充)'}`,
    `适配器 ID：${state.adapter.adapter_id || '(待补充)'}`,
    `适配器名称：${state.adapter.adapter_name || '(待补充)'}`,
    `分类：${state.adapter.category}`,
    `脚本文件名：${state.adapter.asset_js_path || '(待补充)'}`,
    `登录地址：${state.adapter.import_url || '(可以为空)'}`,
    `维护者：${state.adapter.maintainer || '(待补充)'}`,
    `适配描述：${state.adapter.description || '(待补充)'}`,
    '',
    '当前页面上下文（JSON）：',
    JSON.stringify(state.pageContext, null, 2),
    '',
    '如果页面数据来自接口，请优先抓接口结果；如果来自 DOM 表格，请解析表格。',
    '如果当前上下文信息不足，也请在代码中尽量保留可调试日志和清晰报错。',
  ].join('\n');

  state.generatedPrompt = prompt;
  dom.promptTextarea.value = prompt;
  schedulePersist();
  showStatus('已生成 AI 适配指令，可直接复制给浏览器 AI 或其他模型。', 'success');
}

async function pasteScriptFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    const normalized = stripCodeFences(text).trim();
    if (!normalized) {
      showStatus('剪贴板里没有可用脚本内容。', 'warn');
      return;
    }
    state.scriptSource = normalized;
    dom.scriptTextarea.value = normalized;
    schedulePersist();
    showStatus('已从剪贴板粘贴脚本，可直接测试。', 'success');
  } catch (error) {
    showStatus(`读取剪贴板失败：${formatError(error)}`, 'error');
  }
}

async function runCurrentScript() {
  syncStateFromForm();
  const scriptSource = stripCodeFences(state.scriptSource).trim();
  if (!scriptSource) {
    showStatus('请先粘贴或编写脚本。', 'warn');
    return;
  }
  try {
    setBusy(dom.runTestButton, true, '测试中...');
    showStatus('正在把当前脚本注入教务网页，请查看页面和控制台日志...');
    const response = await chrome.runtime.sendMessage({
      type: 'RUN_SCRIPT_SOURCE_REQUEST',
      scriptSource,
    });
    if (!response?.success) {
      throw new Error(response?.message || '未知错误');
    }
    state.scriptSource = scriptSource;
    schedulePersist();
    showStatus(response.message || '脚本已开始执行。', 'success');
  } catch (error) {
    showStatus(`运行脚本失败：${formatError(error)}`, 'error');
  } finally {
    setBusy(dom.runTestButton, false, '运行当前脚本');
  }
}

async function loginGithub() {
  syncStateFromForm();
  const token = state.github.token.trim();
  if (!token) {
    showStatus('请先输入 GitHub Token。', 'warn');
    return;
  }
  try {
    setBusy(dom.githubLoginButton, true, '验证中...');
    const user = await githubApi('/user', { token });
    state.github.userLogin = user.login;
    await chrome.storage.session.set({
      [SESSION_KEY]: {
        github: {
          token,
        },
      },
    });
    renderGithubStatus();
    schedulePersist();
    showStatus(`GitHub 登录成功：${user.login}`, 'success');
  } catch (error) {
    showStatus(`GitHub 登录失败：${formatError(error)}`, 'error');
  } finally {
    setBusy(dom.githubLoginButton, false, '验证并保存 Token');
  }
}

async function submitPullRequest() {
  syncStateFromForm();
  try {
    validateMetadataForSubmission();
    const token = state.github.token.trim();
    if (!token) {
      throw new Error('请先填写并验证 GitHub Token');
    }
    if (!state.github.userLogin) {
      throw new Error('请先点击“验证并保存 Token”登录 GitHub');
    }
    setBusy(dom.submitPrButton, true, '提交中...');
    showStatus('正在准备变更文件与 PR...');

    const targetRepo = await githubApi(`/repos/${encodeURIComponent(state.repoSettings.owner)}/${encodeURIComponent(state.repoSettings.repo)}`, { token });
    const baseBranch = state.repoSettings.branch.trim() || targetRepo.default_branch || 'main';
    await githubApi(`/repos/${encodeURIComponent(state.repoSettings.owner)}/${encodeURIComponent(state.repoSettings.repo)}/git/ref/heads/${encodeURIComponent(baseBranch)}`, { token });
    await ensureFork({
      token,
      upstreamOwner: state.repoSettings.owner,
      upstreamRepo: state.repoSettings.repo,
      userLogin: state.github.userLogin,
    });
    const upstreamBaseRef = await githubApi(`/repos/${encodeURIComponent(state.repoSettings.owner)}/${encodeURIComponent(state.repoSettings.repo)}/git/ref/heads/${encodeURIComponent(baseBranch)}`, { token });
    const branchName = buildBranchName();
    await githubApi(`/repos/${encodeURIComponent(state.github.userLogin)}/${encodeURIComponent(state.repoSettings.repo)}/git/refs`, {
      token,
      method: 'POST',
      body: {
        ref: `refs/heads/${branchName}`,
        sha: upstreamBaseRef.object.sha,
      },
    });

    const files = await buildFilesForSubmission();
    for (const file of files) {
      await upsertRepoFile({
        token,
        owner: state.github.userLogin,
        repo: state.repoSettings.repo,
        branch: branchName,
        path: file.path,
        content: file.content,
        message: file.message,
      });
    }

    const pr = await githubApi(`/repos/${encodeURIComponent(state.repoSettings.owner)}/${encodeURIComponent(state.repoSettings.repo)}/pulls`, {
      token,
      method: 'POST',
      body: {
        title: state.pr.title.trim() || buildDefaultPrTitle(),
        head: `${state.github.userLogin}:${branchName}`,
        base: baseBranch,
        body: state.pr.body.trim() || buildDefaultPrBody(),
      },
    });

    showStatus(`PR 已创建：${pr.html_url}`, 'success');
    chrome.tabs.create({ url: pr.html_url });
  } catch (error) {
    showStatus(`提交 PR 失败：${formatError(error)}`, 'error');
  } finally {
    setBusy(dom.submitPrButton, false, '提交到 fork 并发起 PR');
  }
}

function validateMetadataForSubmission() {
  validateSubmissionPaths();
  const missing = [];
  if (!state.school.id) missing.push('学校 ID');
  if (!state.school.name) missing.push('学校名称');
  if (!state.school.initial) missing.push('学校首字母');
  if (!state.school.resource_folder) missing.push('资源目录');
  if (!state.adapter.adapter_id) missing.push('适配器 ID');
  if (!state.adapter.adapter_name) missing.push('适配器名称');
  if (!state.adapter.asset_js_path) missing.push('脚本相对路径');
  if (!state.adapter.maintainer) missing.push('维护者');
  if (!stripCodeFences(state.scriptSource).trim()) missing.push('脚本内容');
  if (missing.length) {
    throw new Error(`请先补全这些字段：${missing.join('、')}`);
  }
}

function validateSubmissionPaths() {
  assertSafeSegment(state.school.resource_folder, '资源目录');
  assertSafeScriptPath(state.adapter.asset_js_path);
}

async function buildFilesForSubmission() {
  const files = [];
  const normalizedScript = ensureTrailingNewline(stripCodeFences(state.scriptSource).trim());
  const school = { ...state.school };
  const adapter = { ...state.adapter };
  const rootIndexPath = 'index/root_index.yaml';
  const adaptersPath = `resources/${school.resource_folder}/${'adapters.yaml'}`;
  const scriptPath = `resources/${school.resource_folder}/${adapter.asset_js_path}`;

  if (state.createNewSchool) {
    const rootText = await fetchRawFile(rootIndexPath);
    const schools = parseCollectionYaml(rootText, 'schools').map(normalizeSchoolEntry);
    if (schools.some((item) => item.id === school.id || item.resource_folder === school.resource_folder)) {
      throw new Error('新学校的 ID 或资源目录已存在，请更换。');
    }
    files.push({
      path: rootIndexPath,
      content: appendSchoolToRootIndex(rootText, school),
      message: `Add school index entry for ${school.name}`,
    });
    files.push({
      path: adaptersPath,
      content: createAdaptersYaml(adapter),
      message: `Create adapters file for ${school.name}`,
    });
  } else {
    let adaptersText = '';
    try {
      adaptersText = await fetchRawFile(adaptersPath);
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }
    if (!adaptersText) {
      files.push({
        path: adaptersPath,
        content: createAdaptersYaml(adapter),
        message: `Create adapters file for ${school.name}`,
      });
    } else {
      const adapters = parseCollectionYaml(adaptersText, 'adapters').map(normalizeAdapterEntry);
      const existingAdapterIndex = adapters.findIndex((item) => item.adapter_id === adapter.adapter_id);
      const existingAdapter = existingAdapterIndex > -1 ? adapters[existingAdapterIndex] : null;
      if (existingAdapter) {
        if (existingAdapter.asset_js_path !== adapter.asset_js_path) {
          throw new Error('同名适配器已存在且脚本路径不同。请改一个新的 adapter_id，或沿用原脚本路径。');
        }
        const nextAdapters = adapters.map((item, index) => (index === existingAdapterIndex ? { ...adapter } : item));
        if (JSON.stringify(nextAdapters) !== JSON.stringify(adapters)) {
          files.push({
            path: adaptersPath,
            content: serializeAdaptersYaml(nextAdapters, school.resource_folder),
            message: `Update adapter metadata for ${adapter.adapter_name}`,
          });
        }
      } else {
        files.push({
          path: adaptersPath,
          content: serializeAdaptersYaml([...adapters, { ...adapter }], school.resource_folder),
          message: `Add adapter metadata for ${adapter.adapter_name}`,
        });
      }
    }
  }

  files.push({
    path: scriptPath,
    content: normalizedScript,
    message: `Update adapter script ${adapter.asset_js_path}`,
  });

  return files;
}

async function ensureFork({ token, upstreamOwner, upstreamRepo, userLogin }) {
  try {
    return await githubApi(`/repos/${encodeURIComponent(userLogin)}/${encodeURIComponent(upstreamRepo)}`, { token });
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }

  await githubApi(`/repos/${encodeURIComponent(upstreamOwner)}/${encodeURIComponent(upstreamRepo)}/forks`, {
    token,
    method: 'POST',
    body: {},
  });

  for (let attempt = 0; attempt < 10; attempt += 1) {
    await wait(3000);
    try {
      return await githubApi(`/repos/${encodeURIComponent(userLogin)}/${encodeURIComponent(upstreamRepo)}`, { token });
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }
  }

  throw new Error('已请求创建 fork，但 GitHub 还没有准备好，请稍后再试。');
}

async function upsertRepoFile({ token, owner, repo, branch, path, content, message }) {
  let existingSha = undefined;
  try {
    const existing = await githubApi(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeGitHubPath(path)}?ref=${encodeURIComponent(branch)}`, { token });
    existingSha = existing.sha;
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }

  await githubApi(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeGitHubPath(path)}`, {
    token,
    method: 'PUT',
    body: {
      message,
      branch,
      content: utf8ToBase64(content),
      ...(existingSha ? { sha: existingSha } : {}),
    },
  });
}

async function githubApi(path, { token, method = 'GET', body } = {}) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (body) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  const data = text ? safeJsonParse(text) ?? text : null;
  if (!response.ok) {
    const error = new Error(typeof data === 'string' ? data : data?.message || `GitHub API 错误：${response.status}`);
    error.status = response.status;
    error.payload = data;
    throw error;
  }
  return data;
}

async function fetchRawFile(path) {
  const { owner, repo, branch } = state.repoSettings;
  const url = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(branch)}/${path}`;
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    const error = new Error(`读取 ${path} 失败（${response.status}）`);
    error.status = response.status;
    throw error;
  }
  return response.text();
}

function parseCollectionYaml(text, rootKey) {
  const lines = text.split(/\r?\n/);
  const entries = [];
  let current = null;
  let inCollection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.startsWith('#')) {
      continue;
    }
    if (!inCollection) {
      if (trimmed === `${rootKey}:`) {
        inCollection = true;
      }
      continue;
    }

    if (trimmed.startsWith('- ')) {
      if (current) {
        entries.push(current);
      }
      current = {};
      const rest = trimmed.slice(2).trim();
      if (rest) {
        const colonIndex = rest.indexOf(':');
        if (colonIndex > -1) {
          const key = rest.slice(0, colonIndex).trim();
          const value = rest.slice(colonIndex + 1).trim();
          current[key] = parseYamlScalar(value);
        }
      }
      continue;
    }

    if (!current) {
      continue;
    }

    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) {
      continue;
    }
    const key = trimmed.slice(0, colonIndex).trim();
    const value = trimmed.slice(colonIndex + 1).trim();
    current[key] = parseYamlScalar(value);
  }

  if (current) {
    entries.push(current);
  }

  return entries;
}

function parseYamlScalar(value) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
  const noComment = trimmed.replace(/\s+#.*$/, '').trim();
  return noComment;
}

function normalizeSchoolEntry(entry) {
  return {
    id: entry.id || '',
    name: entry.name || '',
    initial: (entry.initial || '').slice(0, 1).toUpperCase(),
    resource_folder: entry.resource_folder || '',
  };
}

function normalizeAdapterEntry(entry) {
  return {
    adapter_id: entry.adapter_id || '',
    adapter_name: entry.adapter_name || '',
    category: entry.category || 'BACHELOR_AND_ASSOCIATE',
    asset_js_path: entry.asset_js_path || '',
    import_url: entry.import_url || '',
    maintainer: entry.maintainer || '',
    description: entry.description || '',
  };
}

function appendSchoolToRootIndex(text, school) {
  const block = [
    '',
    `  - id: "${escapeYamlString(school.id)}"`,
    `    name: "${escapeYamlString(school.name)}"`,
    `    initial: "${escapeYamlString(school.initial)}"`,
    `    resource_folder: "${escapeYamlString(school.resource_folder)}"`,
  ].join('\n');
  return ensureTrailingNewline(text.trimEnd() + block);
}

function appendAdapterToYaml(text, adapter) {
  const block = buildAdapterBlock(adapter);
  return ensureTrailingNewline(text.trimEnd() + block);
}

function createAdaptersYaml(adapter) {
  return serializeAdaptersYaml([{ ...adapter }], state.school.resource_folder);
}

function buildAdapterBlock(adapter) {
  return [
    '',
    `  - adapter_id: "${escapeYamlString(adapter.adapter_id)}"`,
    `    adapter_name: "${escapeYamlString(adapter.adapter_name)}"`,
    `    category: "${escapeYamlString(adapter.category)}"`,
    `    asset_js_path: "${escapeYamlString(adapter.asset_js_path)}"`,
    `    import_url: "${escapeYamlString(adapter.import_url)}"`,
    `    maintainer: "${escapeYamlString(adapter.maintainer)}"`,
    `    description: "${escapeYamlString(adapter.description)}"`,
  ].join('\n');
}

function serializeAdaptersYaml(adapters, resourceFolder) {
  const blocks = adapters.map((adapter) => buildAdapterBlock(adapter)).join('');
  return ensureTrailingNewline(`# resources/${resourceFolder}/adapters.yaml\nadapters:${blocks}\n`);
}

function escapeYamlString(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

function buildFilePreviewText() {
  const resourceFolder = state.school.resource_folder || '(资源目录待填写)';
  const scriptPath = state.adapter.asset_js_path || '(脚本文件待填写)';
  const lines = [];
  if (state.createNewSchool) {
    lines.push('将更新：index/root_index.yaml');
  }
  lines.push(`将更新：resources/${resourceFolder}/adapters.yaml`);
  lines.push(`将更新：resources/${resourceFolder}/${scriptPath}`);
  if (!state.createNewSchool && state.selectedExistingAdapterId) {
    lines.push(`当前已选现有适配器：${state.selectedExistingAdapterId}`);
  }
  return lines.join('\n');
}

function buildDefaultPrTitle() {
  const schoolName = state.school.name || state.school.id || 'school';
  const adapterName = state.adapter.adapter_name || state.adapter.adapter_id || 'adapter';
  return `feat: add ${schoolName} / ${adapterName} adapter via extension assistant`;
}

function buildDefaultPrBody() {
  const modeLabel = state.createNewSchool ? '新增学校 + 适配器' : '已有学校新增/修复适配器';
  return [
    '## 变更摘要',
    `- 变更类型：${modeLabel}`,
    `- 学校：${state.school.name || state.school.id || '(待补充)'}`,
    `- 适配器：${state.adapter.adapter_name || state.adapter.adapter_id || '(待补充)'}`,
    '',
    '## 验证',
    '- [ ] 已在浏览器扩展助手中完成 Alpha 调试',
    '- [ ] 已在轻屿课表开发版 / 自定义仓库中完成 Beta 验证',
    '',
    '## 备注',
    '- 本 PR 由 CourseImporterTestTool 扩展助手生成草稿并提交。',
  ].join('\n');
}

function buildBranchName() {
  const base = `${state.school.resource_folder || 'school'}-${state.adapter.adapter_id || 'adapter'}`
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36) || 'adapter';
  return `adapter-assistant/${base}-${Date.now()}`;
}

function stripCodeFences(text) {
  const trimmed = String(text || '').trim();
  const match = trimmed.match(/^```(?:javascript|js)?\s*([\s\S]*?)```$/i);
  return match ? match[1].trim() : trimmed;
}

function ensureTrailingNewline(text) {
  return text.endsWith('\n') ? text : `${text}\n`;
}

function showStatus(message, tone = 'info') {
  dom.statusMessage.textContent = message;
  dom.statusMessage.className = `status ${tone}`.trim();
}

function setBusy(button, busy, textWhenBusy) {
  if (!button) return;
  if (!button.dataset.originalText) {
    button.dataset.originalText = button.textContent;
  }
  button.disabled = busy;
  button.textContent = busy ? textWhenBusy : button.dataset.originalText;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

function formatError(error) {
  return error?.message || String(error);
}

function isNotFoundError(error) {
  return Number(error?.status) === 404;
}

function encodeGitHubPath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

function assertSafeSegment(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized || !/^[a-zA-Z0-9._-]+$/.test(normalized) || normalized.includes('..') || normalized.startsWith('/')) {
    throw new Error(`${label} 非法，请仅使用字母、数字、点、下划线或短横线。`);
  }
}

function assertSafeScriptPath(value) {
  const normalized = String(value || '').trim();
  if (
    !normalized ||
    !/^[a-zA-Z0-9._/-]+\.js$/.test(normalized) ||
    normalized.includes('..') ||
    normalized.startsWith('/') ||
    normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error('脚本相对路径非法，请使用仓库内的 .js 相对路径。');
  }
}

function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}
