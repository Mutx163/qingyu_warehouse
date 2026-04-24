const STORAGE_KEY = 'adapterAssistantStateV1';
const SESSION_KEY = 'adapterAssistantSessionV1';
const STEP_VIEWS = ['workspace', 'generate', 'test', 'publish'];
const VIEW_META = {
  workspace: {
    title: '目标',
    subtitle: '先确认学校、适配器和元数据，再进入脚本阶段。',
  },
  generate: {
    title: '脚本',
    subtitle: '获取、生成并编辑脚本；AI 面板会在这里持续辅助。',
  },
  test: {
    title: '验证',
    subtitle: '运行脚本、看结果、看预览，并把差异反馈给 AI 修正。',
  },
  publish: {
    title: '提交',
    subtitle: '确认变更与 GitHub 信息，再发起 PR。',
  },
  settings: {
    title: '高级设置',
    subtitle: '这里放仓库源、AI 接口等高级配置，避免打扰主流程。',
  },
};

const DEFAULT_STATE = {
  activeView: 'workspace',
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
  ai: {
    providerLabel: 'OpenAI / 兼容接口',
    baseUrl: 'https://api.openai.com/v1',
    endpointType: 'responses',
    model: 'gpt-5.4',
    apiKey: '',
  },
  aiFeedback: '',
  lastExportSummary: null,
  lastExportData: null,
  lastExecutionStatus: null,
  aiRunState: null,
  aiWorkspace: null,
  previewWeek: 1,
  github: {
    token: '',
    userLogin: '',
  },
  pr: {
    title: '',
    body: '',
  },
  aiDockOpen: false,
  aiPanelTab: 'overview',
  validatePanel: 'run',
  stepCompleted: {
    workspace: false,
    generate: false,
    test: false,
    publish: false,
  },
};

let state = structuredClone(DEFAULT_STATE);
let persistTimer = null;
let isInitializing = true;
let aiRunState = createDefaultAiRunState();
let activeAiController = null;
let activeAiAbortReason = null;
const AI_SNAPSHOT_CACHE_TTL_MS = 10 * 60 * 1000;

const dom = {};

const REFERENCE_SAMPLE_SCRIPT = String.raw`// 文件: school.js

async function demoAlert() {
  try {
    const confirmed = await window.AndroidBridgePromise.showAlert(
      '重要通知',
      '这是一个弹窗示例。',
      '好的'
    );
    if (confirmed) {
      AndroidBridge.showToast('Alert：用户点击了确认！');
      return true;
    }
    AndroidBridge.showToast('Alert：用户取消了！');
    return false;
  } catch (error) {
    console.error('显示公告弹窗时发生错误:', error);
    AndroidBridge.showToast('Alert：显示弹窗出错！' + error.message);
    return false;
  }
}

function validateName(name) {
  if (name === null || name.trim().length === 0) {
    return '输入不能为空！';
  }
  if (name.length < 2) {
    return '姓名至少需要2个字符！';
  }
  return false;
}

async function demoPrompt() {
  try {
    const name = await window.AndroidBridgePromise.showPrompt(
      '输入你的姓名',
      '请输入至少2个字符',
      '测试用户',
      'validateName'
    );
    if (name !== null) {
      AndroidBridge.showToast('欢迎你，' + name + '！');
      return true;
    }
    AndroidBridge.showToast('Prompt：用户取消了输入！');
    return false;
  } catch (error) {
    console.error('显示输入框弹窗时发生错误:', error);
    AndroidBridge.showToast('Prompt：显示输入框出错！' + error.message);
    return false;
  }
}

async function demoSingleSelection() {
  const fruits = ['苹果', '香蕉', '橙子'];
  try {
    const selectedIndex = await window.AndroidBridgePromise.showSingleSelection(
      '选择你喜欢的水果',
      JSON.stringify(fruits),
      1
    );
    if (selectedIndex !== null && selectedIndex >= 0 && selectedIndex < fruits.length) {
      AndroidBridge.showToast('你选择了 ' + fruits[selectedIndex]);
      return true;
    }
    AndroidBridge.showToast('Single Selection：用户取消了选择！');
    return false;
  } catch (error) {
    console.error('显示单选列表弹窗时发生错误:', error);
    AndroidBridge.showToast('Single Selection：显示列表出错！' + error.message);
    return false;
  }
}

async function demoSaveCourses() {
  const testCourses = [
    {
      name: '高等数学',
      teacher: '张教授',
      position: '教101',
      day: 1,
      startSection: 1,
      endSection: 2,
      weeks: [1, 2, 3, 4, 5]
    },
    {
      name: '测试自定义课程',
      teacher: '测试老师',
      position: '测试教室',
      day: 3,
      isCustomTime: true,
      customStartTime: '08:00',
      customEndTime: '09:00',
      weeks: [1, 3, 5, 7]
    }
  ];

  const result = await window.AndroidBridgePromise.saveImportedCourses(JSON.stringify(testCourses));
  if (result === true) {
    AndroidBridge.showToast('测试课程导入成功！');
  } else {
    AndroidBridge.showToast('测试课程导入失败，请查看日志。');
  }
}

async function importPresetTimeSlots() {
  const presetTimeSlots = [
    { number: 1, startTime: '08:00', endTime: '08:45' },
    { number: 2, startTime: '08:55', endTime: '09:40' }
  ];

  const result = await window.AndroidBridgePromise.savePresetTimeSlots(
    JSON.stringify(presetTimeSlots)
  );
  if (result === true) {
    AndroidBridge.showToast('测试时间段导入成功！');
  }
}

async function demoSaveConfig() {
  const courseConfigData = {
    semesterStartDate: '2025-09-01',
    semesterTotalWeeks: 18,
    defaultClassDuration: 50,
    defaultBreakDuration: 5,
    firstDayOfWeek: 7
  };

  const result = await window.AndroidBridgePromise.saveCourseConfig(
    JSON.stringify(courseConfigData)
  );
  if (result === true) {
    AndroidBridge.showToast('测试配置导入成功！');
  }
}

async function runAllDemosSequentially() {
  AndroidBridge.showToast('所有演示将按顺序开始...');

  const alertResult = await demoAlert();
  if (!alertResult) return;

  const promptResult = await demoPrompt();
  if (!promptResult) return;

  const selectionResult = await demoSingleSelection();
  if (!selectionResult) return;

  await demoSaveCourses();
  await importPresetTimeSlots();
  await demoSaveConfig();
  AndroidBridge.notifyTaskCompletion();
}

runAllDemosSequentially();`;

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
    const result = await chrome.runtime.sendMessage({ type: 'GET_LAST_EXPORT_RESULT' });
    if (result?.lastExportSummary || result?.lastExecutionStatus) {
      state.lastExportSummary = result.lastExportSummary || null;
      state.lastExportData = result.lastExportData || null;
      state.lastExecutionStatus = result.lastExecutionStatus || null;
      normalizePreviewWeek();
      renderTestSummary();
      renderExportDetailPanels();
      renderExportPreview();
      schedulePersist();
    }
  } catch (_) {}
});

function bindDom() {
  [
    'backButton',
    'topbarTitle',
    'topbarSubtitle',
    'topbarAiConsoleButton',
    'topbarSettingsButton',
    'contentShell',
    'viewViewport',
    'statusMessage',
    'aiRunStage',
    'aiRunMeta',
    'aiRunLog',
    'aiStreamPreview',
    'aiWorkspaceStatus',
    'continueAiButton',
    'pauseAiButton',
    'cancelAiButton',
    'deleteAiTaskButton',
    'clearAiCacheButton',
    'clearAiHistoryButton',
    'exportAiContextButton',
    'copyAiContextButton',
    'aiOpenTestButton',
    'aiOverviewTab',
    'aiOutputTab',
    'aiHistoryTab',
    'aiOverviewPanel',
    'aiOutputPanel',
    'aiHistoryPanel',
    'aiHistoryList',
    'aiRunLogMirror',
    'aiRunStageMirror',
    'currentRepoStatus',
    'currentSchoolStatus',
    'currentAdapterStatus',
    'currentTestStatus',
    'currentGithubStatus',
    'currentSchoolStatusMirror',
    'currentAdapterStatusMirror',
    'currentTestStatusMirror',
    'currentGithubStatusMirror',
    'workspaceRepoSummary',
    'schoolCountBadge',
    'aiDock',
    'useExistingSchoolButton',
    'useNewSchoolButton',
    'existingSchoolPickerSection',
    'schoolMetadataNotice',
    'repoOwnerInput',
    'repoNameInput',
    'repoBranchInput',
    'schoolSearchInput',
    'syncWarehouseButton',
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
    'copyPromptButton',
    'openAiDockFromGenerate',
    'aiBaseUrlInput',
    'aiEndpointTypeSelect',
    'aiModelInput',
    'aiApiKeyInput',
    'generateWithApiButton',
    'aiConfigHint',
    'pasteScriptButton',
    'runTestButton',
    'downloadScriptButton',
    'clearScriptButton',
    'scriptTextarea',
    'testSummary',
    'coursesListPreview',
    'timeSlotsPreview',
    'configPreview',
    'aiFeedbackTextarea',
    'openAiDockFromValidate',
    'retryWithFeedbackButton',
    'previewWeekSelect',
    'previewMeta',
    'previewGrid',
    'validateRunTab',
    'validateResultsTab',
    'validatePreviewTab',
    'validateRunPanel',
    'validateResultsPanel',
    'validatePreviewPanel',
    'githubLoginBadge',
    'githubTokenInput',
    'githubLoginButton',
    'pasteGithubTokenButton',
    'openPatGuideButton',
    'prTitleInput',
    'prBodyTextarea',
    'submitPrButton',
  ].forEach((id) => {
    dom[id] = document.getElementById(id);
  });
}

function bindEvents() {
  dom.backButton.addEventListener('click', () => {
    if (state.aiDockOpen) {
      state.aiDockOpen = false;
      renderNavigation();
      schedulePersist();
      return;
    }
    setActiveView('workspace');
  });
  dom.topbarAiConsoleButton.addEventListener('click', () => {
    if (!canShowAiDockForView(state.activeView)) {
      state.aiDockOpen = true;
      setActiveView('generate');
      return;
    }
    state.aiDockOpen = !state.aiDockOpen;
    renderNavigation();
    schedulePersist();
  });
  dom.topbarSettingsButton.addEventListener('click', () => {
    setActiveView(state.activeView === 'settings' ? 'workspace' : 'settings');
  });
  document.querySelectorAll('[data-nav-view]').forEach((element) => {
    element.addEventListener('click', () => {
      const view = element.dataset.navView;
      if (view) {
        setActiveView(view, { force: true });
      }
    });
  });
  document.querySelectorAll('[data-open-view]').forEach((element) => {
    element.addEventListener('click', () => {
      const view = element.dataset.openView;
      if (view) {
        if (STEP_ORDER.includes(state.activeView) && STEP_ORDER.includes(view)) {
          const currentIdx = STEP_ORDER.indexOf(state.activeView);
          const targetIdx = STEP_ORDER.indexOf(view);
          if (targetIdx > currentIdx) {
            markStepCompleted(state.activeView);
          }
        }
        setActiveView(view);
      }
    });
  });

  dom.syncWarehouseButton.addEventListener('click', () => syncWarehouse({ announce: true }));
  dom.useExistingSchoolButton.addEventListener('click', () => setSchoolMode(false));
  dom.useNewSchoolButton.addEventListener('click', () => setSchoolMode(true));
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
  dom.copyPromptButton.addEventListener('click', async () => {
    const prompt = generatePrompt();
    await navigator.clipboard.writeText(prompt);
    showStatus('已直接复制 AI 适配指令。', 'success');
  });
  dom.continueAiButton?.addEventListener('click', continueLastAiTask);
  dom.pauseAiButton?.addEventListener('click', pauseCurrentAiTask);
  dom.cancelAiButton?.addEventListener('click', cancelCurrentAiTask);
  dom.deleteAiTaskButton?.addEventListener('click', deleteCurrentAiTask);
  dom.clearAiCacheButton?.addEventListener('click', () => {
    state.aiWorkspace = createDefaultAiWorkspace();
    schedulePersist();
    renderAiRunState();
    showStatus('已清空 AI 上下文与页面快照缓存。', 'success');
  });
  dom.clearAiHistoryButton?.addEventListener('click', clearAiHistory);
  dom.exportAiContextButton?.addEventListener('click', exportAiContextBundle);
  dom.copyAiContextButton?.addEventListener('click', copyAiContextText);
  dom.aiHistoryList?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-ai-history-delete]');
    if (!button) {
      return;
    }
    deleteAiHistoryItem(button.dataset.aiHistoryDelete || '');
  });
  document.querySelectorAll('[data-ai-panel-tab]').forEach((element) => {
    element.addEventListener('click', () => {
      state.aiPanelTab = element.dataset.aiPanelTab || 'overview';
      renderAiPanelSections();
      schedulePersist();
    });
  });
  dom.generateWithApiButton.addEventListener('click', generateScriptWithBuiltInAi);
  dom.openAiDockFromGenerate?.addEventListener('click', () => {
    state.aiDockOpen = true;
    renderNavigation();
    schedulePersist();
  });
  dom.pasteScriptButton.addEventListener('click', pasteScriptFromClipboard);
  dom.runTestButton.addEventListener('click', runCurrentScript);
  dom.downloadScriptButton.addEventListener('click', downloadCurrentScriptDraft);
  dom.clearScriptButton.addEventListener('click', () => {
    if (!window.confirm('确认清空当前脚本草稿吗？')) {
      return;
    }
    state.scriptSource = '';
    dom.scriptTextarea.value = '';
    renderScriptDraftActions();
    schedulePersist();
    showStatus('已清空当前脚本草稿。');
  });
  dom.githubLoginButton.addEventListener('click', loginGithub);
  dom.pasteGithubTokenButton?.addEventListener('click', importGithubTokenFromClipboard);
  dom.openPatGuideButton.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://github.com/settings/personal-access-tokens/new' });
  });
  dom.submitPrButton.addEventListener('click', submitPullRequest);
  dom.aiOpenTestButton.addEventListener('click', () => setActiveView('test', { force: true }));
  dom.retryWithFeedbackButton.addEventListener('click', retryGenerationWithFeedback);
  dom.openAiDockFromValidate?.addEventListener('click', () => {
    state.aiDockOpen = true;
    renderNavigation();
    schedulePersist();
  });
  document.querySelectorAll('[data-validate-panel]').forEach((element) => {
    element.addEventListener('click', () => {
      state.validatePanel = element.dataset.validatePanel || 'run';
      renderValidationPanels();
      schedulePersist();
    });
  });
  dom.previewWeekSelect.addEventListener('change', () => {
    state.previewWeek = Number(dom.previewWeekSelect.value) || 1;
    renderExportPreview();
    schedulePersist();
  });

  document.querySelectorAll('input, textarea, select').forEach((element) => {
    if (['schoolSelect', 'existingAdapterSelect', 'schoolSearchInput', 'previewWeekSelect'].includes(element.id)) {
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
      state.lastExecutionStatus = {
        success: Boolean(message.success),
        phase: message.phase || 'runtime-status',
        message: message.message || '脚本执行状态已更新。',
        updatedAt: message.updatedAt || new Date().toISOString(),
      };
      schedulePersist();
      showStatus(message.message || '脚本执行状态已更新。', message.success ? 'success' : 'error');
    }
    if (message.type === 'EXPORT_SUMMARY_UPDATED') {
      state.lastExportSummary = message.summary;
      state.lastExportData = message.exportData || null;
      state.lastExecutionStatus = message.executionStatus || state.lastExecutionStatus;
      normalizePreviewWeek();
      renderTestSummary();
      renderExportDetailPanels();
      renderExportPreview();
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
    ai: {
      ...DEFAULT_STATE.ai,
      ...(saved.ai || {}),
    },
    pr: {
      ...DEFAULT_STATE.pr,
      ...(saved.pr || {}),
    },
    aiPanelTab: ['overview', 'output', 'history'].includes(saved.aiPanelTab)
      ? saved.aiPanelTab
      : DEFAULT_STATE.aiPanelTab,
    lastExecutionStatus: saved.lastExecutionStatus || null,
    aiRunState: saved.aiRunState || null,
    aiWorkspace: saved.aiWorkspace || null,
    previewWeek: Number(saved.previewWeek) || 1,
    aiDockOpen: typeof saved.aiDockOpen === 'boolean' ? saved.aiDockOpen : DEFAULT_STATE.aiDockOpen,
    validatePanel: ['run', 'results', 'preview'].includes(saved.validatePanel)
      ? saved.validatePanel
      : DEFAULT_STATE.validatePanel,
    adaptersBySchool: saved.adaptersBySchool || {},
    schools: Array.isArray(saved.schools) ? saved.schools : [],
  };
  aiRunState = normalizeAiRunState(saved.aiRunState);
  state.aiWorkspace = normalizeAiWorkspace(saved.aiWorkspace);
  if (!isValidView(state.activeView)) {
    state.activeView = 'workspace';
  }
  if (state.activeView === 'metadata') {
    state.activeView = 'workspace';
  }
  if (state.activeView === 'ai-console') {
    state.activeView = 'generate';
    state.aiDockOpen = true;
  }
}

function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    state.aiRunState = aiRunState;
    state.aiWorkspace = normalizeAiWorkspace(state.aiWorkspace);
    chrome.storage.local.set({
      [STORAGE_KEY]: {
        ...state,
        ai: {
          ...state.ai,
        },
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
  dom.aiBaseUrlInput.value = state.ai.baseUrl;
  dom.aiEndpointTypeSelect.value = state.ai.endpointType;
  dom.aiModelInput.value = state.ai.model;
  dom.aiApiKeyInput.value = state.ai.apiKey || '';
  dom.aiFeedbackTextarea.value = state.aiFeedback || '';
  dom.githubTokenInput.value = state.github.token || '';
  dom.prTitleInput.value = state.pr.title;
  dom.prBodyTextarea.value = state.pr.body;
  dom.scriptTextarea.value = state.scriptSource;
  renderScriptDraftActions();
  renderSchoolOptions();
  renderAdapterOptions();
  renderFormFields();
  renderGithubStatus();
  renderAiHint();
  renderTestSummary();
  renderExportDetailPanels();
  renderExportPreview();
  renderDerivedViews();
  renderOverview();
  renderValidationPanels();
  renderAiPanelSections();
  renderNavigation();
  renderAiRunState();
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
  dom.useExistingSchoolButton.classList.toggle('active', !state.createNewSchool);
  dom.useNewSchoolButton.classList.toggle('active', state.createNewSchool);
  dom.existingSchoolPickerSection.hidden = state.createNewSchool;
  dom.schoolMetadataNotice.textContent = state.createNewSchool
    ? '当前是“新建学校”模式：请补全学校字段和适配器字段，提交时会一并生成 root_index.yaml 与 adapters.yaml 所需内容。'
    : '当前是“已有学校”模式：学校字段会自动带出并保持只读，你主要只需要确认适配器元数据和脚本。';
  dom.existingAdapterSelect.disabled = state.createNewSchool || !state.selectedSchoolId;
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

function renderOverview() {
  const repoText = `${state.repoSettings.owner}/${state.repoSettings.repo}@${state.repoSettings.branch}`;
  const schoolModeText = state.createNewSchool ? '新建学校' : '已有学校';
  const schoolBaseText = state.school.name || state.selectedSchoolId || '未选择学校';
  const schoolText = `${schoolBaseText} · ${schoolModeText}`;
  const adapterText = state.adapter.adapter_name || state.adapter.adapter_id || '未载入适配器';
  const testText = state.lastExportSummary
    ? `已测 ${state.lastExportSummary.courseCount ?? 0} 门课 · ${getPreviewWeekOptions().length || 0} 周可预览`
    : '未测试';
  const githubText = state.github.userLogin
    ? `已登录 ${state.github.userLogin}`
    : '未登录';

  dom.currentRepoStatus.textContent = repoText;
  dom.currentSchoolStatus.textContent = schoolText;
  dom.currentAdapterStatus.textContent = adapterText;
  dom.currentTestStatus.textContent = testText;
  dom.currentGithubStatus.textContent = githubText;
  if (dom.currentSchoolStatusMirror) dom.currentSchoolStatusMirror.textContent = schoolText;
  if (dom.currentAdapterStatusMirror) dom.currentAdapterStatusMirror.textContent = adapterText;
  if (dom.currentTestStatusMirror) dom.currentTestStatusMirror.textContent = testText;
  if (dom.currentGithubStatusMirror) dom.currentGithubStatusMirror.textContent = githubText;
  dom.workspaceRepoSummary.textContent = repoText;
}

function renderNavigation() {
  const baseMeta = VIEW_META[state.activeView] || VIEW_META.workspace;
  const showAiDock = state.aiDockOpen && canShowAiDockForView(state.activeView);
  const meta = showAiDock
    ? {
        title: 'AI 面板',
        subtitle: '这里是完整 AI 工作区，不再和主页面共用垂直空间。',
      }
    : baseMeta;
  dom.topbarTitle.textContent = meta.title;
  dom.topbarSubtitle.textContent = meta.subtitle;
  dom.backButton.hidden = !showAiDock;
  dom.topbarSettingsButton.textContent = state.activeView === 'settings' ? '回到流程' : '高级设置';
  dom.topbarAiConsoleButton.textContent = showAiDock ? '返回工作台' : 'AI 面板';

  document.querySelectorAll('.view').forEach((element) => {
    const isActive = element.dataset.view === state.activeView;
    element.hidden = !isActive;
    element.classList.toggle('active', isActive);
  });

  document.querySelectorAll('[data-nav-view]').forEach((element) => {
    const stepView = element.dataset.navView;
    const isActive = stepView === state.activeView;
    const completed = state.stepCompleted[stepView];
    element.classList.toggle('active', isActive);
    element.classList.toggle('completed', completed);
    element.setAttribute('aria-current', isActive ? 'page' : 'false');
  });
  const isRunning = ['snapshot', 'request', 'streaming'].includes(aiRunState.stage);
  dom.topbarAiConsoleButton.classList.toggle('pulse', isRunning);
  dom.topbarAiConsoleButton.classList.toggle('active', showAiDock);
  dom.aiDock.hidden = !showAiDock;
  if (dom.viewViewport) {
    dom.viewViewport.hidden = showAiDock;
  }
}

function renderAiHint() {
  const endpointLabel = state.ai.endpointType === 'responses' ? 'Responses API' : 'Chat Completions';
  const workspace = normalizeAiWorkspace(state.aiWorkspace);
  const cacheAgeText = workspace.cachedSnapshotAt
    ? `，缓存快照 ${Math.max(1, Math.round((Date.now() - workspace.cachedSnapshotAt) / 1000))} 秒前`
    : '';
  dom.aiConfigHint.textContent = `当前配置：${state.ai.baseUrl} · ${state.ai.model} · ${endpointLabel}。已启用局部改写、上下文历史和页面快照缓存${cacheAgeText}。`;
}

function createDefaultAiRunState() {
  return {
    stage: 'idle',
    meta: '准备就绪',
    logs: ['点击“内置 AI 直接生成脚本”后，这里会显示实时进度。'],
    preview: '',
    chars: 0,
    startedAt: 0,
  };
}

function createDefaultAiWorkspace() {
  return {
    mode: 'surgical',
    history: [],
    cachedSnapshot: null,
    cachedSnapshotKey: '',
    cachedSnapshotAt: 0,
    lastPrompt: '',
    lastTaskType: '',
    lastStructuredMode: '',
    lastAppliedSummary: '',
    resumableRequest: null,
  };
}

function normalizeAiWorkspace(value) {
  const fallback = createDefaultAiWorkspace();
  if (!value || typeof value !== 'object') {
    return fallback;
  }
  return {
    mode: value.mode || fallback.mode,
    history: Array.isArray(value.history)
      ? value.history.slice(-6).map((item) => normalizeAiHistoryItem(item)).filter(Boolean)
      : fallback.history,
    cachedSnapshot: value.cachedSnapshot && typeof value.cachedSnapshot === 'object' ? value.cachedSnapshot : null,
    cachedSnapshotKey: value.cachedSnapshotKey || '',
    cachedSnapshotAt: Number(value.cachedSnapshotAt) || 0,
    lastPrompt: typeof value.lastPrompt === 'string' ? value.lastPrompt : '',
    lastTaskType: value.lastTaskType || '',
    lastStructuredMode: value.lastStructuredMode || '',
    lastAppliedSummary: value.lastAppliedSummary || '',
    resumableRequest: value.resumableRequest && typeof value.resumableRequest === 'object'
      ? {
          taskType: value.resumableRequest.taskType || '',
          prompt: typeof value.resumableRequest.prompt === 'string' ? value.resumableRequest.prompt : '',
          partialOutput: typeof value.resumableRequest.partialOutput === 'string' ? value.resumableRequest.partialOutput : '',
          snapshotKey: value.resumableRequest.snapshotKey || '',
          scriptBefore: typeof value.resumableRequest.scriptBefore === 'string' ? value.resumableRequest.scriptBefore : '',
          startedAt: Number(value.resumableRequest.startedAt) || 0,
        }
      : null,
  };
}

function normalizeAiRunState(value) {
  const fallback = createDefaultAiRunState();
  if (!value || typeof value !== 'object') {
    return fallback;
  }
  return {
    stage: value.stage || fallback.stage,
    meta: value.meta || fallback.meta,
    logs: Array.isArray(value.logs) && value.logs.length ? value.logs.slice(-8) : fallback.logs,
    preview: typeof value.preview === 'string' ? value.preview : fallback.preview,
    chars: Number(value.chars) || (typeof value.preview === 'string' ? value.preview.length : fallback.chars),
    startedAt: Number(value.startedAt) || fallback.startedAt,
  };
}

function resetAiRunState() {
  aiRunState = createDefaultAiRunState();
  state.aiRunState = aiRunState;
  schedulePersist();
  renderAiRunState();
}

function setAiRunStage(stage, meta) {
  aiRunState.stage = stage;
  aiRunState.meta = meta;
  if (!aiRunState.startedAt) {
    aiRunState.startedAt = Date.now();
  }
  state.aiRunState = aiRunState;
  schedulePersist();
  renderAiRunState();
}

function pushAiRunLog(message) {
  aiRunState.logs = [...aiRunState.logs, `${new Date().toLocaleTimeString('zh-CN', { hour12: false })} · ${message}`].slice(-8);
  state.aiRunState = aiRunState;
  schedulePersist();
  renderAiRunState();
}

function appendAiStreamText(delta) {
  aiRunState.preview += delta;
  aiRunState.chars = aiRunState.preview.length;
  state.aiRunState = aiRunState;
  schedulePersist();
  renderAiRunState();
}

function scrollConsoleToLatest(element) {
  if (!element) {
    return;
  }
  requestAnimationFrame(() => {
    element.scrollTop = element.scrollHeight;
  });
}

function renderAiRunState() {
  if (!dom.aiRunStage) {
    return;
  }
  const stageLabelMap = {
    idle: '等待开始',
    snapshot: '抓取页面中',
    request: '请求模型中',
    streaming: '流式生成中',
    paused: '已暂停',
    cancelled: '已取消',
    complete: '已生成完成',
    error: '生成失败',
  };
  const previewText = aiRunState.preview || '流式输出会显示在这里，方便你确认模型是否真的在工作。';
  dom.aiRunStage.textContent = stageLabelMap[aiRunState.stage] || '处理中';
  dom.aiRunMeta.textContent = aiRunState.meta || '等待开始';
  dom.aiRunLog.textContent = aiRunState.logs.join('\n');
  if (dom.aiRunLogMirror) {
    dom.aiRunLogMirror.textContent = aiRunState.logs.join('\n');
  }
  if (dom.aiRunStageMirror) {
    dom.aiRunStageMirror.textContent = `${stageLabelMap[aiRunState.stage] || '处理中'} · ${aiRunState.meta || '等待开始'}`;
  }
  dom.aiStreamPreview.textContent = previewText;
  scrollConsoleToLatest(dom.aiRunLog);
  scrollConsoleToLatest(dom.aiRunLogMirror);
  scrollConsoleToLatest(dom.aiStreamPreview);
  renderScriptDraftActions();
  dom.aiOpenTestButton.disabled = !state.scriptSource.trim();
  const workspace = normalizeAiWorkspace(state.aiWorkspace);
  if (dom.aiWorkspaceStatus) {
    const statusLines = [
      `工作模式：${workspace.mode === 'surgical' ? '局部修改优先' : '完整脚本优先'}`,
      `历史任务：${workspace.history.length} 条`,
      `页面缓存：${workspace.cachedSnapshot ? '可用' : '无'}`,
      `续写任务：${workspace.resumableRequest ? '可继续' : '无'}`,
      `当前状态：${stageLabelMap[aiRunState.stage] || '处理中'}`,
      workspace.lastAppliedSummary ? `最近应用：${workspace.lastAppliedSummary}` : '',
    ].filter(Boolean);
    dom.aiWorkspaceStatus.textContent = statusLines.join('\n');
  }
  const isRunning = isAiTaskRunning();
  const hasResumable = Boolean(workspace.resumableRequest?.prompt);
  const hasCurrentVisibleTask = isRunning || hasResumable || aiRunState.stage !== 'idle' || aiRunState.preview.trim() || aiRunState.logs.length > 1;
  if (dom.continueAiButton) {
    dom.continueAiButton.disabled = !hasResumable || isRunning;
  }
  if (dom.pauseAiButton) {
    dom.pauseAiButton.disabled = !isRunning;
  }
  if (dom.cancelAiButton) {
    dom.cancelAiButton.disabled = !(isRunning || hasResumable);
  }
  if (dom.deleteAiTaskButton) {
    dom.deleteAiTaskButton.disabled = !hasCurrentVisibleTask;
  }
  if (dom.clearAiHistoryButton) {
    dom.clearAiHistoryButton.disabled = !workspace.history.length;
  }

  document.querySelectorAll('[data-ai-stage]').forEach((element) => {
    const step = element.dataset.aiStage;
    const rankMap = { snapshot: 1, request: 2, streaming: 3, complete: 4, error: 4, paused: 3, cancelled: 3, idle: 0 };
    const currentRank = rankMap[aiRunState.stage] || 0;
    const stepRank = rankMap[step] || 0;
    element.classList.toggle('done', currentRank > stepRank || (step === 'complete' && aiRunState.stage === 'complete'));
    element.classList.toggle('active', step === aiRunState.stage || (step === 'complete' && ['error', 'paused', 'cancelled'].includes(aiRunState.stage)));
  });
  renderAiHistory();
  renderAiPanelSections();
  renderNavigation();
}

function renderAiPanelSections() {
  const activeTab = ['overview', 'output', 'history'].includes(state.aiPanelTab)
    ? state.aiPanelTab
    : 'overview';
  document.querySelectorAll('[data-ai-panel-tab]').forEach((element) => {
    const isActive = element.dataset.aiPanelTab === activeTab;
    element.classList.toggle('active', isActive);
    element.setAttribute('aria-current', isActive ? 'page' : 'false');
  });
  document.querySelectorAll('[data-ai-panel-content]').forEach((element) => {
    element.classList.toggle('active', element.dataset.aiPanelContent === activeTab);
  });
}

function renderAiHistory() {
  if (!dom.aiHistoryList) {
    return;
  }
  const history = normalizeAiWorkspace(state.aiWorkspace).history;
  if (!history.length) {
    dom.aiHistoryList.innerHTML = '<div class="history-empty">还没有 AI 任务历史。</div>';
    return;
  }
  dom.aiHistoryList.innerHTML = history
    .slice()
    .reverse()
    .map((item) => {
      const title = escapeHtml(`${formatAiTaskType(item.taskType)} · ${formatAiTaskStatus(item.status)}`);
      const summary = escapeHtml(item.summary || '无摘要');
      const meta = escapeHtml([
        item.outputMode ? `输出：${item.outputMode}` : '',
        item.scriptLengthAfter ? `脚本长度：${item.scriptLengthAfter}` : '',
        item.usedCache ? '使用了页面缓存' : '未使用页面缓存',
        item.at ? `时间：${formatHistoryTime(item.at)}` : '',
      ].filter(Boolean).join('\n'));
      return `
        <article class="history-card">
          <div class="history-head">
            <div>
              <div class="history-title">${title}</div>
              <div class="history-meta">${summary}</div>
            </div>
          </div>
          <div class="history-meta">${meta}</div>
          <div class="history-actions">
            <button class="ghost" data-ai-history-delete="${escapeHtml(item.id)}">删除这条记录</button>
          </div>
        </article>
      `;
    })
    .join('');
}

function renderTestSummary() {
  const diagnostics = analyzeExportDiagnostics(state.lastExportData, state.lastExecutionStatus);
  if (!state.lastExportSummary) {
    const executionLine = state.lastExecutionStatus?.message
      ? `\n最近状态：${state.lastExecutionStatus.message}`
      : '';
    const diagnosticsLine = diagnostics.summaryText
      ? `\n本地诊断：${diagnostics.summaryText}`
      : '';
    dom.testSummary.textContent = `还没有测试结果。运行脚本后，插件内部会直接显示课程、时间模板和学期配置。${executionLine}${diagnosticsLine}`;
    return;
  }
  const summary = state.lastExportSummary;
  const totalWeeks = getPreviewWeekOptions().length;
  const lines = [
    `课程数：${summary.courseCount ?? 0}`,
    `时间段数：${summary.timeSlotCount ?? 0}`,
    `有学期配置：${summary.hasConfig ? '是' : '否'}`,
    `可预览周数：${totalWeeks || 0}`,
    `结果显示：插件内预览`,
    `更新时间：${summary.updatedAt || '未知'}`,
  ];
  if (state.lastExecutionStatus?.message) {
    lines.push(`最近状态：${state.lastExecutionStatus.message}`);
  }
  if (diagnostics.summaryText) {
    lines.push(`本地诊断：${diagnostics.summaryText}`);
  }
  const repairGuidance = buildRepairGuidanceText(diagnostics);
  if (repairGuidance) {
    const firstGuidanceLine = repairGuidance.split('\n')[0]?.replace(/^- /, '').trim();
    if (firstGuidanceLine) {
      lines.push(`建议操作：${firstGuidanceLine}`);
    }
  }
  diagnostics.issues.slice(0, 4).forEach((issue, index) => {
    lines.push(`诊断 ${index + 1}：${issue.message}`);
  });
  dom.testSummary.textContent = lines.join('\n');
}

function renderExportDetailPanels() {
  const exportData = state.lastExportData || {};
  const courses = Array.isArray(exportData.courses) ? exportData.courses : [];
  const timeSlots = Array.isArray(exportData.timeSlots) ? exportData.timeSlots : [];
  const config = exportData.config && typeof exportData.config === 'object' ? exportData.config : null;
  const appReceivePayload = buildAppReceivePayloadForAi(exportData);

  dom.coursesListPreview.textContent = appReceivePayload.courses.length
    ? buildAppReceivePreviewText(exportData)
    : '暂无课程结果。运行脚本后，这里会直接显示按软件最终接收格式归一化后的课程预览。';

  dom.timeSlotsPreview.textContent = timeSlots.length
    ? timeSlots.map((slot) => `第 ${slot.number ?? '?'} 节  ${slot.startTime || '--:--'} - ${slot.endTime || '--:--'}`).join('\n')
    : '暂无时间模板结果。脚本如果调用 savePresetTimeSlots，这里会显示完整时间模板。';

  dom.configPreview.textContent = config
    ? [
        `学期开始：${config.semesterStartDate || '未提供'}`,
        `总周数：${config.semesterTotalWeeks || '未提供'}`,
        `默认课长：${config.defaultClassDuration || '未提供'} 分钟`,
        `默认课间：${config.defaultBreakDuration || '未提供'} 分钟`,
        `每周起始日：${config.firstDayOfWeek || '未提供'}`,
      ].join('\n')
    : '暂无学期配置结果。脚本如果调用 saveCourseConfig，这里会显示学期配置。';
}

function formatCoursePreviewLine(course, index) {
  const weekday = toChineseWeekday(course.day);
  const teacher = course.teacher ? ` · ${course.teacher}` : '';
  const position = course.position ? ` · ${course.position}` : '';
  const timeText = course.isCustomTime
    ? `${course.customStartTime || '--:--'}-${course.customEndTime || '--:--'}`
    : `第 ${course.startSection || '?'}-${course.endSection || course.startSection || '?'} 节`;
  const weeksText = Array.isArray(course.weeks) ? ` · 周次 ${course.weeks.join(',')}` : '';
  return `${index + 1}. 周${weekday} ${timeText} · ${course.name || '未命名课程'}${teacher}${position}${weeksText}`;
}

function renderDerivedViews() {
  syncStateFromForm();
  renderScriptDraftActions();
  dom.generatedFilesPreview.textContent = buildFilePreviewText();
  if (!state.pr.title.trim()) {
    dom.prTitleInput.value = buildDefaultPrTitle();
    state.pr.title = dom.prTitleInput.value;
  }
  if (!state.pr.body.trim()) {
    dom.prBodyTextarea.value = buildDefaultPrBody();
    state.pr.body = dom.prBodyTextarea.value;
  }
  renderOverview();
}

const STEP_ORDER = ['workspace', 'generate', 'test', 'publish'];

function canNavigateToView(view) {
  const idx = STEP_ORDER.indexOf(view);
  if (idx <= 0) return true;
  for (let i = 0; i < idx; i++) {
    if (!state.stepCompleted[STEP_ORDER[i]]) {
      return STEP_ORDER[i];
    }
  }
  return true;
}

function setActiveView(view, { persist = true, force = false } = {}) {
  const target = isValidView(view) ? view : 'workspace';
  if (!force && STEP_ORDER.includes(target)) {
    const blocker = canNavigateToView(target);
    if (blocker !== true) {
      const blockerMeta = VIEW_META[blocker];
      showStatus(`请先完成「${blockerMeta?.title || blocker}」步骤，再进入下一步。`, 'warn');
      return;
    }
  }
  state.activeView = target;
  renderNavigation();
  document.getElementById('viewViewport')?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  if (persist) {
    schedulePersist();
  }
}

function markStepCompleted(step) {
  if (state.stepCompleted[step] !== true) {
    state.stepCompleted[step] = true;
    schedulePersist();
    renderNavigation();
  }
}

function syncStateFromForm() {
  state.repoSettings.owner = dom.repoOwnerInput.value.trim() || DEFAULT_STATE.repoSettings.owner;
  state.repoSettings.repo = dom.repoNameInput.value.trim() || DEFAULT_STATE.repoSettings.repo;
  state.repoSettings.branch = dom.repoBranchInput.value.trim() || DEFAULT_STATE.repoSettings.branch;
  state.ai.baseUrl = dom.aiBaseUrlInput.value.trim() || DEFAULT_STATE.ai.baseUrl;
  state.ai.endpointType = dom.aiEndpointTypeSelect.value || DEFAULT_STATE.ai.endpointType;
  state.ai.model = dom.aiModelInput.value.trim() || DEFAULT_STATE.ai.model;
  state.ai.apiKey = dom.aiApiKeyInput.value.trim();
  state.aiFeedback = dom.aiFeedbackTextarea.value;
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
  state.github.token = dom.githubTokenInput.value.trim();
  state.pr.title = dom.prTitleInput.value;
  state.pr.body = dom.prBodyTextarea.value;
}

function setSchoolMode(createNewSchool) {
  state.createNewSchool = Boolean(createNewSchool);
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

function canShowAiDockForView(view) {
  return ['generate', 'test'].includes(view);
}

function renderValidationPanels() {
  const activePanel = ['run', 'results', 'preview'].includes(state.validatePanel)
    ? state.validatePanel
    : 'run';
  document.querySelectorAll('[data-validate-panel]').forEach((element) => {
    const isActive = element.dataset.validatePanel === activePanel;
    element.classList.toggle('active', isActive);
    element.setAttribute('aria-current', isActive ? 'page' : 'false');
  });
  document.querySelectorAll('[data-validate-content]').forEach((element) => {
    element.hidden = element.dataset.validateContent !== activePanel;
  });
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

function generatePrompt() {
  syncStateFromForm();
  const schoolModeText = state.createNewSchool ? '新建学校' : '已有学校';
  const prompt = [
    buildGeneratePromptBase(),
    '',
    '【当前任务元数据】',
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
    '下面是当前页面上下文，请直接输出最终 JavaScript：',
  ].join('\n');

  state.generatedPrompt = prompt;
  schedulePersist();
  return prompt;
}

function buildGeneratePromptBase() {
  return [
    '你是轻屿课表的教务适配脚本生成器。',
    '你的任务是根据当前浏览器页面真实内容（DOM / iframe / table / script / 接口数据），生成一个可运行的 JavaScript 提取脚本，用于轻屿课表浏览器扩展测试工具。',
    '',
    '【输出要求】',
    '- 只输出纯 JavaScript 源码',
    '- 不要 markdown',
    '- 不要解释',
    '- 不要代码块',
    '- 不要输出假数据',
    '- 不要输出演示弹窗代码',
    '- 不要输出与课表提取无关的示例逻辑',
    '',
    '【目标】',
    '脚本必须：',
    '1. 自动读取当前页面课表数据',
    '2. 转换为轻屿课表支持的数据结构',
    '3. 调用桥接接口保存课程、时间模板、学期配置',
    '4. 成功时 notifyTaskCompletion()',
    '5. 失败时明确报错，不允许 silent fail',
    '',
    '【桥接接口】',
    '- await window.AndroidBridgePromise.saveImportedCourses(JSON.stringify(courses))',
    '- await window.AndroidBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots))',
    '- await window.AndroidBridgePromise.saveCourseConfig(JSON.stringify(config))',
    '- await window.AndroidBridgePromise.showAlert(title, content, confirmText)',
    '- AndroidBridge.showToast(message)',
    '- AndroidBridge.notifyTaskCompletion()',
    '',
    '【课程最小结构】',
    '普通节次课程：{"name":"课程名","teacher":"教师名","position":"上课地点","day":1,"startSection":1,"endSection":2,"weeks":[1,2,3]}',
    '自定义时间课程：{"name":"课程名","teacher":"教师名","position":"上课地点","day":1,"isCustomTime":true,"customStartTime":"08:00","customEndTime":"09:35","weeks":[1,2,3]}',
    '【桥接最低字段硬规则】',
    '- 无论你是否额外输出 dayOfWeek / location / customWeeks，最终传给 saveImportedCourses 的课程对象都必须保留 day / position / weeks',
    '- 也就是说 app 扩展字段可以额外带，但绝不能替代桥接最低字段',
    '- teacher / position 没有就填空字符串',
    '- day 必须为 1-7',
    '- weeks 必须是升序 number[]',
    '- 即使还能推导出 startWeek / endWeek / customWeeks，也必须保留 weeks 字段，因为桥接导入依赖它',
    '- 为了兼容现有导入器，必须输出 day 与 position；如果额外输出 dayOfWeek 与 location，也不能只输出后者',
    '',
    '【软件支持的课程扩展字段】',
    '- shortName / description / note / color / courseNature / timeSchemeIdOverride / location / dayOfWeek / startWeek / endWeek / isOddWeek / isEvenWeek / customWeeks',
    '- 能稳定识别就补充，不能稳定识别就省略，绝对不要编造',
    '',
    '【页面解析总原则】',
    '1. 先判断当前是否为课表页',
    '2. 优先从 table / iframe / script / 内嵌数据对象 / 接口响应中提取',
    '3. 不得凭空编造课程',
    '4. 不得把页面标题、表头、筛选框、提示文字识别成课程',
    '5. 如果未解析到课程，要明确报错',
    '6. 先保证课程导入成功，再补时间模板和学期配置',
    '',
    '【强智 / 类似二维课表的强规则】',
    '- 必须按星期列、按单元格读取，绝对禁止跨列拼接文本',
    '- 一个单元格内如果有多门课，要先拆分再解析',
    '- [必修] / [选修] 可映射到 courseNature(required / elective)',
    '- [32]、[48] 这类学时数字必须丢弃，不能作为课程名或节次',
    '- 例如 24软件工程[1-3]班(100) 这类必须写入 note，绝对禁止把 [1-3]班 / [3-4]班 识别成节次',
    '- startSection / endSection 只能从明确带“节”字的内容中提取，例如 [01-02-03-04节]',
    '- 绝对禁止从学时数字、班级编号中提取节次',
    '- weeks 必须展开为升序数组：(全部) 连续展开，(单) 只保留奇数周，(双) 只保留偶数周',
    '- 如果缺少星期、节次或周次，不要猜测；宁可报错或跳过，也不要输出错误课程',
    '',
    '【实现要求】',
    '- 优先选择最稳定的数据来源：接口返回数据 > 初始化 JSON / 全局变量 > DOM 表格或课程块',
    '- 必须主动检查 iframe、异步加载、学年学期切换、周次切换、登录状态',
    '- 必须包含必要的辅助函数：周次解析、星期解析、节次解析、时间解析',
    '- 如果页面既能拿到课程，也能拿到时间模板或学期配置，请一并输出',
    '- 请优先输出一个可直接执行的自调用结构，例如：(async function () { ... })();',
    '- 在最终输出前，请自行检查语法完整性',
  ].join('\n');
}

function buildRepairPromptBase() {
  return [
    '你是轻屿课表的教务适配脚本修正器。',
    '你的任务是根据“当前脚本 + 当前页面真实内容 + 插件测试结果 + 用户反馈”，修正已有的课表提取脚本。',
    '',
    '【输出要求】',
    '- 只输出纯 JavaScript 源码',
    '- 不要 markdown',
    '- 不要解释',
    '- 不要代码块',
    '- 不要输出假数据',
    '- 不要输出与课表提取无关的示例逻辑',
    '',
    '【修正目标】',
    '- 优先修正：漏课、合课、错星期、错节次、错周次、时间模板错误、学期配置错误、iframe/异步等待错误、标题/表头/筛选项误识别',
    '- 必须优先保证“软件最终接收格式 JSON”与真实页面一致',
    '- 但同时必须保证 saveImportedCourses 使用的最终课程对象保留 day / position / weeks，不能只剩 dayOfWeek / location / customWeeks',
    '- 必须基于当前脚本做定向修正，但如果当前脚本根基明显错误，可以整体重写',
    '- 不允许编造课程数据掩盖解析失败',
    '',
    '【强智 / 类似二维课表修正规则】',
    '- 必须按列按单元格理解，不得跨列拼接',
    '- [1-3]班 / [3-4]班 只能进 note，不能进节次',
    '- 节次只能从带“节”的表达中提取',
    '- [32] / [48] 这类学时不能当节次',
    '- 周次必须展开为数组',
    '- 如果测试结果出现“学期理论课表”“全部”“筛选”“课表查询”“理论课表”“实践课表”等明显不是课程名的文本，必须重写提取逻辑，而不是小修小补',
    '',
    '【修正时必须参考】',
    '- 当前脚本',
    '- 当前页面真实上下文',
    '- 插件测试提取结果',
    '- 软件最终接收格式 JSON',
    '- 用户反馈',
    '',
    '【错误处理要求】',
    '- 失败时必须 console.error(...)',
    '- 必须 showAlert("提示", "失败原因", "确定")',
    '- 不要 silent fail',
  ].join('\n');
}

async function generateScriptWithBuiltInAi() {
  syncStateFromForm();
  const apiKey = state.ai.apiKey.trim();
  if (!apiKey) {
    showStatus('请先填写内置 AI 的 API Key。', 'warn');
    setActiveView('settings');
    return;
  }

  try {
    const controller = beginAiTaskRequest();
    state.aiDockOpen = true;
    setActiveView('generate');
    setBusy(dom.generateWithApiButton, true, '生成中...');
    resetAiRunState();
    setAiRunStage('snapshot', '正在抓取当前教务网页快照…');
    pushAiRunLog('开始读取当前页面上下文');
    showStatus('正在抓取当前网页完整快照并提交给内置 AI，请稍候...');
    const snapshot = await getFullPageSnapshot({
      preferCache: true,
      onLog: (message) => pushAiRunLog(message),
    });
    pushAiRunLog(`已抓取页面：${snapshot.title || snapshot.url || '未知页面'}`);
    const prompt = buildBuiltInAiPrompt(snapshot);
    startAiRequestTracking({
      taskType: 'generate',
      prompt,
      snapshot,
      scriptBefore: state.scriptSource,
    });
    setAiRunStage('request', '正在向模型发起请求…');
    pushAiRunLog(`已提交到 ${state.ai.model}（${state.ai.endpointType}）`);
    const aiResult = await requestScriptFromAi(prompt, {
      signal: controller.signal,
      onStage: (stage, meta) => setAiRunStage(stage, meta),
      onLog: (message) => pushAiRunLog(message),
      onDelta: (delta) => {
        appendAiStreamText(delta);
        appendAiRequestPartial(delta);
      },
    });
    const resolved = resolveAiScriptResult(aiResult, {
      currentScript: state.scriptSource,
      taskType: 'generate',
    });
    if (!resolved.script) {
      throw new Error('AI 没有返回可用脚本。');
    }

    state.scriptSource = resolved.script;
    dom.scriptTextarea.value = resolved.script;
    finishAiRequestTracking({
      taskType: 'generate',
      outputMode: resolved.mode,
      summary: resolved.summary,
      scriptAfter: resolved.script,
    });
    setAiRunStage('complete', `生成完成，已得到 ${resolved.script.length} 个字符的脚本草稿`);
    pushAiRunLog(`脚本草稿已写入测试页（${resolved.mode === 'apply_edits' ? '局部修改' : '整段写入'}）`);
    schedulePersist();
    renderAiRunState();
    showStatus('内置 AI 已生成脚本，准备自动返回验证页并运行脚本。', 'success');
    await autoReturnToTestView('AI 生成完成');
  } catch (error) {
    if (handleAiTaskInterrupt(error)) {
      return;
    }
    failAiRequestTracking(formatError(error));
    setAiRunStage('error', formatError(error));
    pushAiRunLog(`生成失败：${formatError(error)}`);
    showStatus(`内置 AI 生成失败：${formatError(error)}`, 'error');
  } finally {
    endAiTaskRequest();
    renderAiRunState();
    setBusy(dom.generateWithApiButton, false, '内置 AI 直接生成脚本');
  }
}

async function retryGenerationWithFeedback() {
  syncStateFromForm();
  const apiKey = state.ai.apiKey.trim();
  if (!apiKey) {
    showStatus('请先在设置页填写 AI Key。', 'warn');
    setActiveView('settings');
    return;
  }
  if (!state.scriptSource.trim()) {
    showStatus('请先生成或粘贴一版脚本，再进行反馈修正。', 'warn');
    return;
  }
  if (!state.lastExportData && !state.lastExecutionStatus?.message) {
    showStatus('请先运行一次脚本，让插件拿到报错信息或提取结果后再反馈给 AI 修正。', 'warn');
    return;
  }

  try {
    const controller = beginAiTaskRequest();
    state.aiDockOpen = true;
    setActiveView('test');
    setBusy(dom.retryWithFeedbackButton, true, '修正中...');
    resetAiRunState();
    setAiRunStage('snapshot', '正在重新抓取当前教务页面，用于对比真实课表…');
    pushAiRunLog('开始读取当前页面真实课表上下文');
    const snapshot = await getFullPageSnapshot({
      preferCache: true,
      onLog: (message) => pushAiRunLog(message),
    });
    pushAiRunLog('已抓取页面快照，准备结合测试结果回传给 AI');
    const prompt = buildFeedbackRepairPrompt(snapshot);
    startAiRequestTracking({
      taskType: 'repair',
      prompt,
      snapshot,
      scriptBefore: state.scriptSource,
    });
    setAiRunStage('request', '正在向模型提交修正请求…');
    pushAiRunLog('已发送“真实页面 + 提取结果 + 用户反馈”三方对比请求');
    const aiResult = await requestScriptFromAi(prompt, {
      signal: controller.signal,
      onStage: (stage, meta) => setAiRunStage(stage, meta),
      onLog: (message) => pushAiRunLog(message),
      onDelta: (delta) => {
        appendAiStreamText(delta);
        appendAiRequestPartial(delta);
      },
    });
    const resolved = resolveAiScriptResult(aiResult, {
      currentScript: state.scriptSource,
      taskType: 'repair',
    });
    if (!resolved.script) {
      throw new Error('AI 没有返回可用修正版脚本。');
    }
    state.scriptSource = resolved.script;
    dom.scriptTextarea.value = resolved.script;
    finishAiRequestTracking({
      taskType: 'repair',
      outputMode: resolved.mode,
      summary: resolved.summary,
      scriptAfter: resolved.script,
    });
    setAiRunStage('complete', `修正完成，已得到 ${resolved.script.length} 个字符的新版脚本`);
    pushAiRunLog(`新版脚本已覆盖到测试区（${resolved.mode === 'apply_edits' ? '局部修改' : '整段替换'}），请重新运行测试`);
    schedulePersist();
    renderAiRunState();
    showStatus('AI 已修正脚本，准备自动返回验证页并重新运行。', 'success');
    await autoReturnToTestView('AI 修正完成');
  } catch (error) {
    if (handleAiTaskInterrupt(error)) {
      return;
    }
    failAiRequestTracking(formatError(error));
    setAiRunStage('error', formatError(error));
    pushAiRunLog(`修正失败：${formatError(error)}`);
    showStatus(`AI 修正失败：${formatError(error)}`, 'error');
  } finally {
    endAiTaskRequest();
    renderAiRunState();
    setBusy(dom.retryWithFeedbackButton, false, '把结果反馈给 AI 自动修正');
  }
}

async function getFullPageSnapshot(options = {}) {
  const tab = await getActiveTab();
  ensureTabSupportsInjection(tab);
  if (!tab?.id) {
    throw new Error('当前没有可用标签页。');
  }
  const snapshotCacheKey = buildSnapshotCacheKey(tab);
  if (options.preferCache && isCachedSnapshotUsable(snapshotCacheKey)) {
    options.onLog?.('命中页面快照缓存，已复用最近一次上下文');
    return structuredClone(state.aiWorkspace.cachedSnapshot);
  }
  const snapshot = await sendSnapshotRequest(tab.id);
  if (!snapshot?.url) {
    throw new Error('无法读取当前网页上下文，请先刷新教务页面后重试。');
  }
  cacheSnapshot(snapshotCacheKey, snapshot);
  return snapshot;
}

async function sendSnapshotRequest(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: 'GET_FULL_PAGE_SNAPSHOT' });
  } catch (error) {
    if (!isMissingReceiverError(error)) {
      throw error;
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content-script.js'],
      });
      await wait(120);
      return await chrome.tabs.sendMessage(tabId, { type: 'GET_FULL_PAGE_SNAPSHOT' });
    } catch (retryError) {
      throw new Error(
        '当前页面还没有连上扩展脚本。请确认你打开的是教务网页标签页；如果刚重载过扩展，重新聚焦该网页后再试一次。'
      );
    }
  }
}

function buildSnapshotCacheKey(tab) {
  return `${tab?.id || 'tab'}::${tab?.url || ''}`;
}

function isCachedSnapshotUsable(cacheKey) {
  const workspace = normalizeAiWorkspace(state.aiWorkspace);
  return Boolean(
    workspace.cachedSnapshot &&
    workspace.cachedSnapshotKey === cacheKey &&
    Date.now() - workspace.cachedSnapshotAt <= AI_SNAPSHOT_CACHE_TTL_MS
  );
}

function cacheSnapshot(cacheKey, snapshot) {
  state.aiWorkspace = normalizeAiWorkspace(state.aiWorkspace);
  state.aiWorkspace.cachedSnapshotKey = cacheKey;
  state.aiWorkspace.cachedSnapshot = structuredClone(snapshot);
  state.aiWorkspace.cachedSnapshotAt = Date.now();
  schedulePersist();
}

function buildAiEditProtocolText(taskType) {
  const modeHint = taskType === 'generate'
    ? '如果当前没有旧脚本，可直接返回完整脚本；如果你已经明确知道只需要改一小段，也允许返回局部编辑指令。'
    : '这次是对现有脚本做修正，优先返回局部编辑指令，不要每次整段重写。';
  return [
    '【局部修改 patch 输出协议】',
    modeHint,
    '优先输出 JSON，不要 markdown，不要解释：',
    '{"mode":"apply_edits","summary":"一句话说明","edits":[{"search":"原代码片段","replace":"替换后的代码片段","replace_all":false}],"fallback_script":"完整脚本（可选）"}',
    '局部修改铁律：',
    '- search 必须来自当前脚本原文',
    '- 能局部改就不要整体重写',
    '- 不要修改无关代码',
    '- 优先修关键错误：星期列、班级误判为节次、周次单双周、标题误识别、iframe/等待、时间模板缺失',
    '- 如果局部改动不稳定，再返回 {"mode":"replace_script","summary":"...","script":"完整脚本"}',
    '- 如果返回 JSON，必须是合法 JSON，字符串中的换行和引号必须正确转义',
  ].join('\n');
}

function buildAiConversationContextText() {
  const workspace = normalizeAiWorkspace(state.aiWorkspace);
  if (!workspace.history.length) {
    return '暂无历史 AI 任务。';
  }
  return workspace.history
    .slice(-4)
    .map((item, index) => {
      const parts = [
        `${index + 1}. ${item.taskType || 'task'} / ${item.outputMode || 'unknown'} / ${item.status || 'unknown'}`,
        item.summary || '',
        item.usedCache ? '复用了页面缓存' : '',
      ].filter(Boolean);
      return parts.join(' · ');
    })
    .join('\n');
}

function startAiRequestTracking({ taskType, prompt, snapshot, scriptBefore }) {
  state.aiWorkspace = normalizeAiWorkspace(state.aiWorkspace);
  state.aiWorkspace.lastTaskType = taskType;
  state.aiWorkspace.lastPrompt = prompt;
  state.aiWorkspace.resumableRequest = {
    taskType,
    prompt,
    partialOutput: '',
    snapshotKey: state.aiWorkspace.cachedSnapshotKey || '',
    scriptBefore: scriptBefore || '',
    startedAt: Date.now(),
  };
  if (snapshot) {
    state.aiWorkspace.cachedSnapshot = structuredClone(snapshot);
  }
  schedulePersist();
}

function appendAiRequestPartial(delta) {
  state.aiWorkspace = normalizeAiWorkspace(state.aiWorkspace);
  if (!state.aiWorkspace.resumableRequest) {
    return;
  }
  state.aiWorkspace.resumableRequest.partialOutput += delta;
  schedulePersist();
}

function finishAiRequestTracking({ taskType, outputMode, summary, scriptAfter }) {
  state.aiWorkspace = normalizeAiWorkspace(state.aiWorkspace);
  state.aiWorkspace.lastStructuredMode = outputMode;
  state.aiWorkspace.lastAppliedSummary = summary || '';
  state.aiWorkspace.history = trimAiHistory([
    ...state.aiWorkspace.history,
    createAiHistoryEntry({
      taskType,
      outputMode,
      summary: summary || '',
      status: 'completed',
      usedCache: Boolean(state.aiWorkspace.cachedSnapshotKey),
      scriptLengthAfter: scriptAfter?.length || 0,
    }),
  ]);
  state.aiWorkspace.resumableRequest = null;
  schedulePersist();
}

function failAiRequestTracking(errorMessage) {
  state.aiWorkspace = normalizeAiWorkspace(state.aiWorkspace);
  const resumable = state.aiWorkspace.resumableRequest;
  state.aiWorkspace.history = trimAiHistory([
    ...state.aiWorkspace.history,
    createAiHistoryEntry({
      taskType: resumable?.taskType || state.aiWorkspace.lastTaskType || 'task',
      outputMode: state.aiWorkspace.lastStructuredMode || 'unknown',
      summary: errorMessage || 'AI 任务失败',
      status: 'failed',
      usedCache: Boolean(state.aiWorkspace.cachedSnapshotKey),
      scriptLengthAfter: 0,
    }),
  ]);
  schedulePersist();
}

function interruptAiRequestTracking(status, summary, options = {}) {
  state.aiWorkspace = normalizeAiWorkspace(state.aiWorkspace);
  const resumable = state.aiWorkspace.resumableRequest;
  if (status !== 'deleted') {
    state.aiWorkspace.history = trimAiHistory([
      ...state.aiWorkspace.history,
      createAiHistoryEntry({
        taskType: resumable?.taskType || state.aiWorkspace.lastTaskType || 'task',
        outputMode: state.aiWorkspace.lastStructuredMode || 'unknown',
        summary: summary || 'AI 任务已中断',
        status,
        usedCache: Boolean(state.aiWorkspace.cachedSnapshotKey),
        scriptLengthAfter: 0,
      }),
    ]);
  }
  if (options.clearResumable) {
    state.aiWorkspace.resumableRequest = null;
  }
  schedulePersist();
}

function resolveAiScriptResult(rawText, { currentScript, taskType }) {
  const normalized = stripCodeFences(rawText).trim();
  if (!normalized) {
    return { script: '', mode: 'empty', summary: '' };
  }
  const parsed = safeJsonParse(normalized);
  if (!parsed || typeof parsed !== 'object') {
    return {
      script: normalized,
      mode: 'replace_script',
      summary: taskType === 'repair' ? 'AI 返回完整修正版脚本' : 'AI 返回完整脚本',
    };
  }
  return applyAiEditPayload(parsed, currentScript);
}

function applyAiEditPayload(payload, currentScript) {
  if (payload.mode === 'replace_script' && typeof payload.script === 'string') {
    return {
      script: stripCodeFences(payload.script).trim(),
      mode: 'replace_script',
      summary: payload.summary || 'AI 返回完整脚本',
    };
  }

  if (payload.mode === 'apply_edits' && Array.isArray(payload.edits) && typeof currentScript === 'string') {
    let nextScript = currentScript;
    let appliedCount = 0;
    const failedReasons = [];

    payload.edits.forEach((edit, index) => {
      const search = typeof edit?.search === 'string' ? edit.search : '';
      const replace = typeof edit?.replace === 'string' ? edit.replace : '';
      const replaceAll = edit?.replace_all === true;
      if (!search) {
        failedReasons.push(`第 ${index + 1} 个 edit 缺少 search`);
        return;
      }
      const occurrences = countOccurrences(nextScript, search);
      if (!occurrences) {
        failedReasons.push(`第 ${index + 1} 个 edit 未命中原代码`);
        return;
      }
      if (occurrences > 1 && !replaceAll) {
        failedReasons.push(`第 ${index + 1} 个 edit 命中 ${occurrences} 处，需更精确 search`);
        return;
      }
      nextScript = replaceAll
        ? nextScript.split(search).join(replace)
        : nextScript.replace(search, replace);
      appliedCount += 1;
    });

    if (appliedCount > 0) {
      return {
        script: nextScript.trim(),
        mode: 'apply_edits',
        summary: payload.summary || `AI 局部修改了 ${appliedCount} 处代码${failedReasons.length ? `，另有 ${failedReasons.length} 处未应用` : ''}`,
      };
    }

    if (typeof payload.fallback_script === 'string' && payload.fallback_script.trim()) {
      return {
        script: stripCodeFences(payload.fallback_script).trim(),
        mode: 'replace_script',
        summary: payload.summary || '局部修改未命中，已回退到完整脚本',
      };
    }

    throw new Error(failedReasons[0] || 'AI 返回了 edit JSON，但没有任何修改成功应用。');
  }

  if (typeof payload.script === 'string' && payload.script.trim()) {
    return {
      script: stripCodeFences(payload.script).trim(),
      mode: 'replace_script',
      summary: payload.summary || 'AI 返回完整脚本',
    };
  }

  throw new Error('AI 返回了无法识别的编辑结果格式。');
}

function countOccurrences(source, fragment) {
  if (!fragment) {
    return 0;
  }
  return source.split(fragment).length - 1;
}

async function continueLastAiTask() {
  state.aiWorkspace = normalizeAiWorkspace(state.aiWorkspace);
  const resumable = state.aiWorkspace.resumableRequest;
  if (!resumable?.prompt) {
    showStatus('没有可继续的 AI 任务。', 'warn');
    return;
  }

  try {
    const controller = beginAiTaskRequest();
    state.aiDockOpen = true;
    setActiveView(resumable.taskType === 'repair' ? 'test' : 'generate', { force: true });
    resetAiRunState();
    setAiRunStage('request', '正在续写上次 AI 任务…');
    pushAiRunLog('已读取上次中断任务的缓存上下文');
    const continuePrompt = [
      '你上一次的输出被中断了。请基于原始任务继续完成，不要重新解释。',
      '',
      '【原始任务 Prompt】',
      resumable.prompt,
      '',
      '【已生成的部分输出】',
      resumable.partialOutput || '(无已缓存输出)',
      '',
      '请直接输出一个完整的最终结果，继续遵守原先的输出协议。',
    ].join('\n');
    startAiRequestTracking({
      taskType: `${resumable.taskType || 'task'}-continue`,
      prompt: continuePrompt,
      snapshot: state.aiWorkspace.cachedSnapshot,
      scriptBefore: resumable.scriptBefore || state.scriptSource,
    });
    const aiResult = await requestScriptFromAi(continuePrompt, {
      signal: controller.signal,
      onStage: (stage, meta) => setAiRunStage(stage, meta),
      onLog: (message) => pushAiRunLog(message),
      onDelta: (delta) => {
        appendAiStreamText(delta);
        appendAiRequestPartial(delta);
      },
    });
    const resolved = resolveAiScriptResult(aiResult, {
      currentScript: resumable.scriptBefore || state.scriptSource,
      taskType: resumable.taskType || 'task',
    });
    state.scriptSource = resolved.script;
    dom.scriptTextarea.value = resolved.script;
    finishAiRequestTracking({
      taskType: `${resumable.taskType || 'task'}-continue`,
      outputMode: resolved.mode,
      summary: resolved.summary || '续写完成',
      scriptAfter: resolved.script,
    });
    setAiRunStage('complete', '已续写完成');
    pushAiRunLog(`已完成续写（${resolved.mode === 'apply_edits' ? '局部修改' : '整段输出'}）`);
    schedulePersist();
    showStatus('已续写完成，准备自动返回验证页并运行脚本。', 'success');
    await autoReturnToTestView('AI 续写完成');
  } catch (error) {
    if (handleAiTaskInterrupt(error)) {
      return;
    }
    failAiRequestTracking(formatError(error));
    setAiRunStage('error', formatError(error));
    pushAiRunLog(`续写失败：${formatError(error)}`);
    showStatus(`继续上次 AI 任务失败：${formatError(error)}`, 'error');
  } finally {
    endAiTaskRequest();
    renderAiRunState();
  }
}

async function autoReturnToTestView(reason) {
  state.aiDockOpen = false;
  setActiveView('test', { force: true });
  schedulePersist();
  renderNavigation();
  await wait(80);
  showStatus(`${reason}，脚本已写入草稿区。请检查后点击「运行当前脚本」进行验证。`, 'success');
}

function buildBuiltInAiPrompt(snapshot) {
  const prompt = generatePrompt();
  const snapshotSummary = buildSnapshotStructureSummary(snapshot);
  return [
    prompt,
    '',
    '【当前脚本】',
    state.scriptSource.trim() ? stripCodeFences(state.scriptSource) : '当前还没有脚本草稿。',
    '',
    '【最近 AI 历史】',
    buildAiConversationContextText(),
    '',
    buildAiEditProtocolText('generate'),
    '',
    '【当前网页结构化摘要】',
    snapshotSummary,
    '',
    '【当前网页完整快照 JSON】',
    '下面是扩展直接抓取的当前页面完整上下文，请基于它直接生成最终脚本：',
    JSON.stringify(snapshot, null, 2),
  ].join('\n');
}

function buildFeedbackRepairPrompt(snapshot) {
  const exportData = state.lastExportData || {};
  const appReceivePayload = buildAppReceivePayloadForAi(exportData);
  const executionStatus = state.lastExecutionStatus || null;
  const diagnostics = analyzeExportDiagnostics(exportData, executionStatus);
  const repairGuidance = buildRepairGuidanceText(diagnostics);
  const snapshotSummary = buildSnapshotStructureSummary(snapshot);
  return [
    buildRepairPromptBase(),
    '',
    '【当前脚本】',
    stripCodeFences(state.scriptSource),
    '',
    '【最近 AI 历史】',
    buildAiConversationContextText(),
    '',
    buildAiEditProtocolText('repair'),
    '',
    '【本次测试执行状态】',
    executionStatus
      ? JSON.stringify(executionStatus, null, 2)
      : '本次没有记录到执行状态，请以提取结果和真实页面为准。',
    '',
    '【插件测试提取结果 JSON】',
    JSON.stringify(exportData, null, 2),
    '',
    '【软件最终接收格式 JSON】',
    JSON.stringify(appReceivePayload, null, 2),
    '',
    '【插件本地提取诊断 JSON】',
    JSON.stringify(diagnostics, null, 2),
    '',
    '【插件本地提取诊断文本】',
    diagnostics.summaryText || '未发现明显异常，但仍请对照真实页面继续检查。',
    '',
    '【建议修正方向】',
    repairGuidance,
    '',
    '【按软件最终接收格式推导的课表预览文本】',
    buildAiExportEffectText(exportData),
    '',
    '【用户反馈】',
    state.aiFeedback.trim() || '无额外人工反馈，请重点对比真实页面与提取结果之间的不一致。',
    '',
    '【当前网页结构化摘要】',
    snapshotSummary,
    '',
    '【当前网页真实上下文 JSON】',
    JSON.stringify(snapshot, null, 2),
    '',
    '请直接修正当前脚本，并优先保证“软件最终接收格式 JSON”与真实页面一致。',
  ].join('\n');
}

async function requestScriptFromAi(prompt, handlers = {}) {
  const baseUrl = normalizeApiBaseUrl(state.ai.baseUrl);
  if (state.ai.endpointType === 'chat_completions') {
    return requestViaChatCompletions(baseUrl, prompt, handlers);
  }
  return requestViaResponses(baseUrl, prompt, handlers);
}

async function requestViaResponses(baseUrl, prompt, handlers = {}) {
  const response = await fetch(`${baseUrl}/responses`, {
    method: 'POST',
    headers: buildAiHeaders(),
    signal: handlers.signal,
    body: JSON.stringify({
      model: state.ai.model,
      input: prompt,
      stream: true,
      max_output_tokens: 6000,
    }),
  });
  if (isEventStreamResponse(response)) {
    return readResponsesStream(response, handlers);
  }
  handlers.onLog?.('当前接口未返回流式事件，已回退到普通模式。');
  const data = await readApiJson(response);
  if (typeof data.output_text === 'string' && data.output_text.trim()) {
    return data.output_text;
  }
  const textFromOutput = extractResponsesText(data);
  if (textFromOutput) {
    return textFromOutput;
  }
  throw new Error('Responses API 未返回文本内容。');
}

async function requestViaChatCompletions(baseUrl, prompt, handlers = {}) {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: buildAiHeaders(),
    signal: handlers.signal,
    body: JSON.stringify({
      model: state.ai.model,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      stream: true,
      temperature: 0.2,
    }),
  });
  if (isEventStreamResponse(response)) {
    return readChatCompletionsStream(response, handlers);
  }
  handlers.onLog?.('当前接口未返回流式事件，已回退到普通模式。');
  const data = await readApiJson(response);
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text === 'string' && text.trim()) {
    return text;
  }
  if (Array.isArray(text)) {
    const joined = text.map((item) => item?.text || item?.content || '').join('\n').trim();
    if (joined) {
      return joined;
    }
  }
  throw new Error('Chat Completions 未返回文本内容。');
}

async function readResponsesStream(response, handlers = {}) {
  handlers.onStage?.('streaming', '模型正在流式输出脚本…');
  handlers.onLog?.('已进入流式输出');
  let collected = '';
  await consumeSseStream(response, (payload) => {
    if (payload === '[DONE]') {
      return;
    }
    const data = safeJsonParse(payload);
    if (!data) {
      return;
    }
    if (data.type === 'response.output_text.delta' && typeof data.delta === 'string') {
      collected += data.delta;
      handlers.onDelta?.(data.delta);
      return;
    }
    if (data.type === 'response.completed') {
      handlers.onLog?.('模型已结束流式输出');
      return;
    }
    if (data.type === 'error' || data.error) {
      throw new Error(data.error?.message || data.message || 'Responses 流式生成失败');
    }
  });
  if (collected.trim()) {
    return collected;
  }
  throw new Error('Responses API 流式返回为空。');
}

async function readChatCompletionsStream(response, handlers = {}) {
  handlers.onStage?.('streaming', '模型正在流式输出脚本…');
  handlers.onLog?.('已进入流式输出');
  let collected = '';
  await consumeSseStream(response, (payload) => {
    if (payload === '[DONE]') {
      return;
    }
    const data = safeJsonParse(payload);
    if (!data) {
      return;
    }
    if (data.error) {
      throw new Error(data.error?.message || 'Chat Completions 流式生成失败');
    }
    const delta = data?.choices?.[0]?.delta?.content;
    if (typeof delta === 'string' && delta) {
      collected += delta;
      handlers.onDelta?.(delta);
      return;
    }
    if (Array.isArray(delta)) {
      const joined = delta.map((item) => item?.text || '').join('');
      if (joined) {
        collected += joined;
        handlers.onDelta?.(joined);
      }
    }
  });
  if (collected.trim()) {
    return collected;
  }
  throw new Error('Chat Completions 流式返回为空。');
}

async function consumeSseStream(response, onData) {
  if (!response.ok) {
    const text = await response.text();
    const data = safeJsonParse(text);
    throw new Error(data?.error?.message || data?.message || `API 请求失败（${response.status}）`);
  }
  if (!response.body) {
    throw new Error('当前接口没有返回可读取的流。');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      flushSseBuffer(buffer, onData);
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\n\n/);
    buffer = parts.pop() || '';
    parts.forEach((part) => flushSseBuffer(part, onData));
  }
}

function flushSseBuffer(chunk, onData) {
  const lines = String(chunk || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const payload = lines
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .join('\n');
  if (payload) {
    onData(payload);
  }
}

function isEventStreamResponse(response) {
  return String(response.headers.get('content-type') || '').includes('text/event-stream');
}

function buildAiHeaders() {
  return {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream, application/json',
    Authorization: `Bearer ${state.ai.apiKey.trim()}`,
  };
}

async function readApiJson(response) {
  const text = await response.text();
  const data = safeJsonParse(text);
  if (!response.ok) {
    throw new Error(data?.error?.message || data?.message || `API 请求失败（${response.status}）`);
  }
  if (!data) {
    throw new Error('API 返回了无法解析的 JSON。');
  }
  return data;
}

function extractResponsesText(data) {
  return (data?.output || [])
    .flatMap((item) => item?.content || [])
    .map((item) => item?.text || item?.content?.[0]?.text || '')
    .find((text) => typeof text === 'string' && text.trim()) || '';
}

function normalizeApiBaseUrl(baseUrl) {
  return String(baseUrl || DEFAULT_STATE.ai.baseUrl).replace(/\/+$/, '');
}

function beginAiTaskRequest() {
  endAiTaskRequest();
  activeAiAbortReason = null;
  activeAiController = new AbortController();
  return activeAiController;
}

function endAiTaskRequest() {
  activeAiController = null;
  activeAiAbortReason = null;
}

function isAiTaskRunning() {
  return Boolean(activeAiController) && ['snapshot', 'request', 'streaming'].includes(aiRunState.stage);
}

function pauseCurrentAiTask() {
  if (!isAiTaskRunning()) {
    showStatus('当前没有正在运行的 AI 任务。', 'warn');
    return;
  }
  activeAiAbortReason = 'paused';
  activeAiController?.abort();
  showStatus('正在暂停当前 AI 任务…');
}

function cancelCurrentAiTask() {
  const workspace = normalizeAiWorkspace(state.aiWorkspace);
  if (isAiTaskRunning()) {
    activeAiAbortReason = 'cancelled';
    activeAiController?.abort();
    showStatus('正在取消当前 AI 任务…');
    return;
  }
  if (workspace.resumableRequest?.prompt) {
    interruptAiRequestTracking('cancelled', '用户取消了当前 AI 任务', { clearResumable: true });
    setAiRunStage('cancelled', '已取消当前 AI 任务');
    pushAiRunLog('当前任务已取消，不会再继续续写。');
    renderAiRunState();
    showStatus('已取消当前 AI 任务。', 'success');
    return;
  }
  showStatus('当前没有可取消的 AI 任务。', 'warn');
}

function deleteCurrentAiTask() {
  const workspace = normalizeAiWorkspace(state.aiWorkspace);
  const hasVisibleTask = isAiTaskRunning() || workspace.resumableRequest?.prompt || aiRunState.stage !== 'idle' || aiRunState.preview.trim() || aiRunState.logs.length > 1;
  if (!hasVisibleTask) {
    showStatus('当前没有可删除的 AI 任务。', 'warn');
    return;
  }
  if (isAiTaskRunning()) {
    activeAiAbortReason = 'deleted';
    activeAiController?.abort();
    showStatus('正在删除当前 AI 任务…');
    return;
  }
  state.aiWorkspace = normalizeAiWorkspace(state.aiWorkspace);
  state.aiWorkspace.resumableRequest = null;
  state.aiWorkspace.lastAppliedSummary = '';
  resetAiRunState();
  renderAiRunState();
  showStatus('已删除当前 AI 任务记录。', 'success');
}

function clearAiHistory() {
  const workspace = normalizeAiWorkspace(state.aiWorkspace);
  if (!workspace.history.length) {
    showStatus('当前没有 AI 任务历史。', 'warn');
    return;
  }
  state.aiWorkspace = normalizeAiWorkspace(state.aiWorkspace);
  state.aiWorkspace.history = [];
  state.aiWorkspace.lastAppliedSummary = '';
  schedulePersist();
  renderAiRunState();
  showStatus('已清空 AI 任务历史。', 'success');
}

function deleteAiHistoryItem(id) {
  if (!id) {
    return;
  }
  state.aiWorkspace = normalizeAiWorkspace(state.aiWorkspace);
  const before = state.aiWorkspace.history.length;
  state.aiWorkspace.history = state.aiWorkspace.history.filter((item) => item.id !== id);
  if (state.aiWorkspace.history.length === before) {
    return;
  }
  schedulePersist();
  renderAiRunState();
  showStatus('已删除这条 AI 历史记录。', 'success');
}

function handleAiTaskInterrupt(error) {
  if (!isAbortError(error)) {
    return false;
  }
  const reason = activeAiAbortReason || 'cancelled';
  if (reason === 'paused') {
    interruptAiRequestTracking('paused', '用户暂停了当前 AI 任务', { clearResumable: false });
    setAiRunStage('paused', '当前任务已暂停，可点击“继续上次 AI 任务”恢复');
    pushAiRunLog('任务已暂停，已保留上下文和已生成内容');
    renderAiRunState();
    showStatus('AI 任务已暂停。', 'success');
    return true;
  }
  if (reason === 'deleted') {
    state.aiWorkspace = normalizeAiWorkspace(state.aiWorkspace);
    state.aiWorkspace.resumableRequest = null;
    state.aiWorkspace.lastAppliedSummary = '';
    resetAiRunState();
    renderAiRunState();
    showStatus('已删除当前 AI 任务。', 'success');
    return true;
  }
  interruptAiRequestTracking('cancelled', '用户取消了当前 AI 任务', { clearResumable: true });
  setAiRunStage('cancelled', '当前任务已取消');
  pushAiRunLog('任务已取消，当前流式输出已停止');
  renderAiRunState();
  showStatus('AI 任务已取消。', 'success');
  return true;
}

function isAbortError(error) {
  return error?.name === 'AbortError' || String(error?.message || '').includes('aborted');
}

function normalizeAiHistoryItem(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }
  return {
    id: item.id || generateAiHistoryId(),
    taskType: item.taskType || 'task',
    outputMode: item.outputMode || 'unknown',
    summary: item.summary || '',
    status: item.status || 'completed',
    usedCache: Boolean(item.usedCache),
    scriptLengthAfter: Number(item.scriptLengthAfter) || 0,
    at: item.at || new Date().toISOString(),
  };
}

function createAiHistoryEntry(payload = {}) {
  return normalizeAiHistoryItem({
    ...payload,
    id: generateAiHistoryId(),
    at: payload.at || new Date().toISOString(),
  });
}

function trimAiHistory(history) {
  return history.slice(-6).map((item) => normalizeAiHistoryItem(item)).filter(Boolean);
}

function generateAiHistoryId() {
  return `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatAiTaskType(taskType) {
  const map = {
    generate: '首次生成',
    repair: '反馈修正',
    'generate-continue': '首次生成续写',
    'repair-continue': '反馈修正续写',
    'task-continue': '任务续写',
  };
  return map[taskType] || taskType || 'AI 任务';
}

function formatAiTaskStatus(status) {
  const map = {
    completed: '已完成',
    failed: '失败',
    paused: '已暂停',
    cancelled: '已取消',
  };
  return map[status] || status || '未知状态';
}

function formatHistoryTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value || '';
  }
  return date.toLocaleString('zh-CN', { hour12: false });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
    renderScriptDraftActions();
    schedulePersist();
    showStatus('已从剪贴板粘贴脚本，可直接测试。', 'success');
  } catch (error) {
    showStatus(`读取剪贴板失败：${formatError(error)}`, 'error');
  }
}

async function downloadCurrentScriptDraft() {
  syncStateFromForm();
  const scriptSource = ensureTrailingNewline(stripCodeFences(state.scriptSource).trim());
  if (!scriptSource.trim()) {
    showStatus('当前没有可导出的脚本草稿。', 'warn');
    return;
  }

  const filename = buildScriptDownloadFilename();
  const objectUrl = URL.createObjectURL(new Blob([scriptSource], { type: 'application/javascript;charset=utf-8' }));
  try {
    setBusy(dom.downloadScriptButton, true, '导出中...');
    await chrome.downloads.download({
      url: objectUrl,
      filename,
      saveAs: true,
    });
    showStatus(`已开始导出脚本：${filename}`, 'success');
  } catch (error) {
    showStatus(`导出脚本失败：${formatError(error)}`, 'error');
  } finally {
    setBusy(dom.downloadScriptButton, false, '导出当前脚本 .js');
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60 * 1000);
  }
}

async function exportAiContextBundle() {
  try {
    const bundle = buildAiContextBundle();
    const filename = buildAiContextFilename('json');
    const objectUrl = URL.createObjectURL(
      new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json;charset=utf-8' })
    );
    try {
      setBusy(dom.exportAiContextButton, true, '导出中...');
      await chrome.downloads.download({
        url: objectUrl,
        filename,
        saveAs: true,
      });
      showStatus(`已导出上下文包：${filename}`, 'success');
    } finally {
      setBusy(dom.exportAiContextButton, false, '导出上下文包');
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60 * 1000);
    }
  } catch (error) {
    showStatus(`导出上下文包失败：${formatError(error)}`, 'error');
  }
}

async function copyAiContextText() {
  try {
    const text = buildAiContextText();
    await navigator.clipboard.writeText(text);
    showStatus('已复制上下文文本，可直接粘贴给我。', 'success');
  } catch (error) {
    showStatus(`复制上下文文本失败：${formatError(error)}`, 'error');
  }
}

function buildAiContextFilename(extension) {
  const schoolId = (state.school.id || state.school.resource_folder || 'context').replace(/[^a-zA-Z0-9-_]+/g, '-');
  const adapterId = (state.adapter.adapter_id || 'adapter').replace(/[^a-zA-Z0-9-_]+/g, '-');
  return `course-importer-context-${schoolId}-${adapterId}-${Date.now()}.${extension}`;
}

function buildAiContextBundle() {
  const exportData = state.lastExportData || null;
  const appReceivePayload = buildAppReceivePayloadForAi(exportData);
  const diagnostics = analyzeExportDiagnostics(exportData, state.lastExecutionStatus);
  const workspace = normalizeAiWorkspace(state.aiWorkspace);
  const snapshot = workspace.cachedSnapshot || null;
  return {
    schema: 'course_importer_debug_context_v1',
    exportedAt: new Date().toISOString(),
    repoSettings: structuredClone(state.repoSettings),
    school: structuredClone(state.school),
    adapter: structuredClone(state.adapter),
    activeView: state.activeView,
    aiPanelTab: state.aiPanelTab,
    aiDockOpen: state.aiDockOpen,
    validatePanel: state.validatePanel,
    scriptSource: stripCodeFences(state.scriptSource),
    generatedPrompt: state.generatedPrompt || '',
    aiFeedback: state.aiFeedback || '',
    lastExecutionStatus: state.lastExecutionStatus || null,
    lastExportSummary: state.lastExportSummary || null,
    lastExportData: exportData,
    appReceivePayload,
    appReceivePreviewText: buildAppReceivePreviewText(exportData),
    diagnostics,
    aiRunState,
    aiWorkspace: {
      mode: workspace.mode,
      history: workspace.history,
      lastPrompt: workspace.lastPrompt,
      lastTaskType: workspace.lastTaskType,
      lastStructuredMode: workspace.lastStructuredMode,
      lastAppliedSummary: workspace.lastAppliedSummary,
      resumableRequest: workspace.resumableRequest,
      cachedSnapshotKey: workspace.cachedSnapshotKey,
      cachedSnapshotAt: workspace.cachedSnapshotAt,
      cachedSnapshotSummary: snapshot ? buildSnapshotStructureSummary(snapshot) : '',
      cachedSnapshot: snapshot,
    },
    referenceMessages: {
      generatePromptBase: buildGeneratePromptBase(),
      repairPromptBase: buildRepairPromptBase(),
      patchPromptBase: buildAiEditProtocolText('repair'),
      currentGeneratePrompt: generatePrompt(),
      currentRepairPrompt:
        snapshot && (state.lastExportData || state.lastExecutionStatus?.message)
          ? buildFeedbackRepairPrompt(snapshot)
          : '',
    },
  };
}

function buildAiContextText() {
  const bundle = buildAiContextBundle();
  return [
    '【导出时间】',
    bundle.exportedAt,
    '',
    '【学校与适配器】',
    `学校：${bundle.school.name || bundle.school.id || '(未填写)'}`,
    `适配器：${bundle.adapter.adapter_name || bundle.adapter.adapter_id || '(未填写)'}`,
    '',
    '【最近执行状态】',
    bundle.lastExecutionStatus ? JSON.stringify(bundle.lastExecutionStatus, null, 2) : '无',
    '',
    '【软件最终接收格式 JSON】',
    JSON.stringify(bundle.appReceivePayload, null, 2),
    '',
    '【按软件格式推导的预览文本】',
    bundle.appReceivePreviewText || '无',
    '',
    '【本地诊断】',
    JSON.stringify(bundle.diagnostics, null, 2),
    '',
    '【当前脚本】',
    bundle.scriptSource || '无',
    '',
    '【当前页面快照摘要】',
    bundle.aiWorkspace.cachedSnapshotSummary || '无',
    '',
    '【当前生成提示词】',
    bundle.referenceMessages.currentGeneratePrompt || '',
    '',
    '【当前修正提示词】',
    bundle.referenceMessages.currentRepairPrompt || '',
  ].join('\n');
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
    state.lastExportSummary = null;
    state.lastExportData = null;
    state.lastExecutionStatus = {
      success: true,
      phase: 'started',
      message: '正在把当前脚本注入教务网页，请等待执行结果…',
      updatedAt: new Date().toISOString(),
    };
    renderTestSummary();
    renderExportDetailPanels();
    renderExportPreview();
    schedulePersist();
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
    state.lastExecutionStatus = {
      success: false,
      phase: 'start-failed',
      message: `运行脚本失败：${formatError(error)}`,
      updatedAt: new Date().toISOString(),
    };
    renderTestSummary();
    schedulePersist();
    showStatus(`运行脚本失败：${formatError(error)}`, 'error');
  } finally {
    setBusy(dom.runTestButton, false, '运行当前脚本');
  }
}

async function loginGithub() {
  syncStateFromForm();
  let token = state.github.token.trim();
  if (!token) {
    token = await readGithubTokenFromClipboard();
    if (token) {
      state.github.token = token;
      dom.githubTokenInput.value = token;
      schedulePersist();
      showStatus('已自动从剪贴板识别到 GitHub Token，正在继续登录…', 'success');
    }
  }
  if (!token) {
    chrome.tabs.create({ url: 'https://github.com/settings/personal-access-tokens/new' });
    showStatus('当前没有检测到 GitHub Token，已为你打开 GitHub PAT 创建页。创建并复制后，再点“一键登录 GitHub”即可。', 'warn');
    return;
  }
  try {
    setBusy(dom.githubLoginButton, true, '登录中...');
    const user = await ensureGithubLoginWithToken(token);
    showStatus(`GitHub 登录成功：${user.login}`, 'success');
  } catch (error) {
    showStatus(`GitHub 登录失败：${formatError(error)}`, 'error');
  } finally {
    setBusy(dom.githubLoginButton, false, '一键登录 GitHub');
  }
}

async function importGithubTokenFromClipboard() {
  try {
    const token = await readGithubTokenFromClipboard();
    if (!token) {
      showStatus('剪贴板里没有识别到 GitHub Token。', 'warn');
      return;
    }
    state.github.token = token;
    dom.githubTokenInput.value = token;
    schedulePersist();
    showStatus('已从剪贴板导入 GitHub Token。', 'success');
  } catch (error) {
    showStatus(`读取剪贴板失败：${formatError(error)}`, 'error');
  }
}

async function readGithubTokenFromClipboard() {
  try {
    const text = String(await navigator.clipboard.readText()).trim();
    return extractGithubToken(text);
  } catch (_) {
    return '';
  }
}

function extractGithubToken(text) {
  const source = String(text || '').trim();
  if (!source) {
    return '';
  }
  const directPrefixes = ['github_pat_', 'ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_'];
  if (directPrefixes.some((prefix) => source.startsWith(prefix))) {
    return source;
  }
  const match = source.match(/(github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9_]+)/);
  return match ? match[1] : '';
}

async function submitPullRequest() {
  syncStateFromForm();
  try {
    if (!window.confirm('确认把当前适配脚本与元数据提交到 fork 并创建 PR 吗？')) {
      return;
    }
    validateMetadataForSubmission();
    const token = state.github.token.trim();
    if (!token) {
      throw new Error('请先填写 GitHub Token，或先点击“一键登录 GitHub”');
    }
    if (!state.github.userLogin) {
      showStatus('正在自动校验 GitHub Token 并补登录状态...', 'success');
      await ensureGithubLoginWithToken(token);
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
    markStepCompleted('publish');
    chrome.tabs.create({ url: pr.html_url });
  } catch (error) {
    showStatus(`提交 PR 失败：${formatError(error)}`, 'error');
  } finally {
    setBusy(dom.submitPrButton, false, '提交到 fork 并发起 PR');
  }
}

async function ensureGithubLoginWithToken(token) {
  const user = await githubApi('/user', { token });
  state.github.userLogin = user.login;
  state.github.token = token;
  if (!state.adapter.maintainer.trim()) {
    state.adapter.maintainer = user.login;
    if (dom.maintainerInput) {
      dom.maintainerInput.value = user.login;
    }
  }
  const existingSession = await chrome.storage.session.get(SESSION_KEY);
  const previousSecrets = existingSession?.[SESSION_KEY] || {};
  await chrome.storage.session.set({
    [SESSION_KEY]: {
      ...previousSecrets,
      github: { token },
    },
  });
  renderGithubStatus();
  schedulePersist();
  return user;
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

function renderExportPreview() {
  const exportData = state.lastExportData;
  const weekOptions = getPreviewWeekOptions();
  dom.previewWeekSelect.innerHTML = '';

  if (!weekOptions.length || !Array.isArray(exportData?.courses) || !exportData.courses.length) {
    const option = document.createElement('option');
    option.value = '1';
    option.textContent = '暂无预览';
    dom.previewWeekSelect.appendChild(option);
    dom.previewWeekSelect.disabled = true;
    dom.previewMeta.textContent = '运行脚本成功后，这里会显示按周查看的课表预览。';
    dom.previewGrid.innerHTML = '<div class="preview-placeholder">还没有可预览的课表数据。</div>';
    return;
  }

  normalizePreviewWeek();
  dom.previewWeekSelect.disabled = false;
  weekOptions.forEach((week) => {
    const option = document.createElement('option');
    option.value = String(week);
    option.textContent = `第 ${week} 周`;
    option.selected = week === state.previewWeek;
    dom.previewWeekSelect.appendChild(option);
  });

  const courses = exportData.courses;
  const weekCourses = courses.filter((course) => courseMatchesWeek(course, state.previewWeek));
  const normalCourses = weekCourses.filter((course) => !course.isCustomTime);
  const customCourses = weekCourses.filter((course) => course.isCustomTime);
  const rows = buildPreviewRows(exportData, normalCourses);
  const hasDetailedTimeSlots = hasCompletePreviewTimeSlots(exportData, normalCourses);

  dom.previewMeta.textContent = hasDetailedTimeSlots
    ? `第 ${state.previewWeek} 周 · 共 ${weekCourses.length} 门课`
    : `第 ${state.previewWeek} 周 · 共 ${weekCourses.length} 门课 · 当前脚本没有返回完整时间模板，预览已按节次范围智能合并显示`;

  if (!rows.length && !customCourses.length) {
    dom.previewGrid.innerHTML = '<div class="preview-placeholder">这一周没有课程。</div>';
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'timetable-wrapper';

  if (rows.length) {
    const table = document.createElement('table');
    table.className = 'timetable-table';

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    ['节次', '周一', '周二', '周三', '周四', '周五', '周六', '周日'].forEach((label) => {
      const th = document.createElement('th');
      th.textContent = label;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    const skipUntilSectionByDay = new Map();
    rows.forEach((row, rowIndex) => {
      const tr = document.createElement('tr');
      const labelCell = document.createElement('td');
      labelCell.className = 'time-axis';
      labelCell.innerHTML = `<strong>${escapeHtml(row.label)}</strong><span>${escapeHtml(row.timeLabel)}</span>`;
      tr.appendChild(labelCell);

      for (let day = 1; day <= 7; day += 1) {
        const skipUntilSection = Number(skipUntilSectionByDay.get(day) || 0);
        if (row.startSection <= skipUntilSection) {
          continue;
        }

        const td = document.createElement('td');
        td.className = 'timetable-cell';
        const cellCourses = findCoursesStartingAtPreviewRow(normalCourses, day, row);
        if (cellCourses.length) {
          const spanEndSection = cellCourses.reduce(
            (max, course) => Math.max(max, normalizeSectionValue(course.endSection || course.startSection)),
            row.endSection
          );
          const rowSpan = countPreviewRowSpan(rows, rowIndex, spanEndSection);
          if (rowSpan > 1) {
            td.rowSpan = rowSpan;
          }
          skipUntilSectionByDay.set(day, spanEndSection);
          td.innerHTML = cellCourses
            .map((course) =>
              buildCourseCardHtml(course, {
                rowSpan,
                cellCourseCount: cellCourses.length,
                rowSectionSpan: row.endSection - row.startSection + 1,
              })
            )
            .join('');
        } else {
          td.innerHTML = '<span class="cell-empty">—</span>';
        }
        tr.appendChild(td);
      }

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    wrapper.appendChild(table);
  }

  if (customCourses.length) {
    const customBlock = document.createElement('div');
    customBlock.className = 'custom-course-block';
    customBlock.innerHTML = `
      <div class="custom-course-title">自定义时间课程</div>
      <div class="custom-course-list">
        ${customCourses.map((course) => buildCustomCourseHtml(course)).join('')}
      </div>
    `;
    wrapper.appendChild(customBlock);
  }

  dom.previewGrid.innerHTML = '';
  dom.previewGrid.appendChild(wrapper);
}

function buildPreviewRows(exportData, courses) {
  const slotMap = buildPreviewTimeSlotMap(exportData?.timeSlots);
  const maxCourseSection = courses.reduce(
    (max, course) => Math.max(max, normalizeSectionValue(course.endSection || course.startSection)),
    0
  );
  const maxSlotSection = Math.max(0, ...slotMap.keys());
  const total = Math.max(maxCourseSection, maxSlotSection, 0);
  if (!total) {
    return [];
  }

  if (hasCompletePreviewTimeSlots(exportData, courses)) {
    return Array.from({ length: total }, (_, index) => {
      const sectionNumber = index + 1;
      const slot = slotMap.get(sectionNumber);
      return {
        startSection: sectionNumber,
        endSection: sectionNumber,
        label: `第 ${sectionNumber} 节`,
        timeLabel: slot ? `${slot.startTime || '--:--'} - ${slot.endTime || '--:--'}` : '未提供时间模板',
      };
    });
  }

  const boundaries = new Set([1, total + 1]);
  courses.forEach((course) => {
    const startSection = normalizeSectionValue(course.startSection);
    const endSection = normalizeSectionValue(course.endSection || course.startSection);
    if (startSection > 0 && endSection >= startSection) {
      boundaries.add(startSection);
      boundaries.add(endSection + 1);
    }
  });

  const sortedBoundaries = Array.from(boundaries)
    .filter((value) => value > 0 && value <= total + 1)
    .sort((a, b) => a - b);

  const rows = [];
  for (let index = 0; index < sortedBoundaries.length - 1; index += 1) {
    const startSection = sortedBoundaries[index];
    const endSection = sortedBoundaries[index + 1] - 1;
    if (endSection < startSection) {
      continue;
    }
    rows.push({
      startSection,
      endSection,
      label: formatPreviewSectionRange(startSection, endSection),
      timeLabel: '脚本未返回时间模板',
    });
  }
  return rows;
}

function buildCourseCardHtml(course, options = {}) {
  const sectionText = course.endSection && Number(course.endSection) !== Number(course.startSection)
    ? `第 ${course.startSection}-${course.endSection} 节`
    : `第 ${course.startSection || '?'} 节`;
  const rowSpan = Number(options.rowSpan || 1);
  const cellCourseCount = Number(options.cellCourseCount || 1);
  const rowSectionSpan = Number(options.rowSectionSpan || 1);
  const courseSectionSpan = Math.max(
    1,
    Number(course?.endSection || course?.startSection || 1) - Number(course?.startSection || 1) + 1
  );
  const visualSectionSpan = Math.max(rowSpan, rowSectionSpan, courseSectionSpan);
  const shouldFillSpan = visualSectionSpan > 1 && cellCourseCount === 1;
  const minHeight = shouldFillSpan
    ? Math.max(92, visualSectionSpan * 48 - 8)
    : null;
  const className = shouldFillSpan ? 'course-card fill-span' : 'course-card';
  const styleAttr = minHeight ? ` style="min-height:${minHeight}px"` : '';
  return `
    <div class="${className}"${styleAttr}>
      <div class="course-name">${escapeHtml(course.name || '未命名课程')}</div>
      <div class="course-meta">${escapeHtml(sectionText)}</div>
      ${course.teacher ? `<div class="course-meta">${escapeHtml(course.teacher)}</div>` : ''}
      ${course.position ? `<div class="course-meta">${escapeHtml(course.position)}</div>` : ''}
    </div>
  `;
}

function normalizeSectionValue(value) {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : 0;
}

function buildPreviewTimeSlotMap(timeSlots) {
  const normalizedTimeSlots = Array.isArray(timeSlots) ? timeSlots : [];
  return new Map(
    normalizedTimeSlots
      .map((slot) => [normalizeSectionValue(slot.number), slot])
      .filter(([number]) => number > 0)
  );
}

function hasCompletePreviewTimeSlots(exportData, courses) {
  const slotMap = buildPreviewTimeSlotMap(exportData?.timeSlots);
  const maxCourseSection = (Array.isArray(courses) ? courses : []).reduce(
    (max, course) => Math.max(max, normalizeSectionValue(course.endSection || course.startSection)),
    0
  );
  if (!maxCourseSection) {
    return false;
  }
  for (let section = 1; section <= maxCourseSection; section += 1) {
    const slot = slotMap.get(section);
    if (!slot || !slot.startTime || !slot.endTime) {
      return false;
    }
  }
  return true;
}

function formatPreviewSectionRange(startSection, endSection) {
  return startSection === endSection
    ? `第 ${startSection} 节`
    : `第 ${startSection}-${endSection} 节`;
}

function findCoursesStartingAtPreviewRow(courses, day, row) {
  return (Array.isArray(courses) ? courses : [])
    .filter((course) =>
      Number(course.day) === day &&
      normalizeSectionValue(course.startSection) === row.startSection
    )
    .sort((left, right) => normalizeSectionValue(right.endSection || right.startSection) - normalizeSectionValue(left.endSection || left.startSection));
}

function countPreviewRowSpan(rows, startRowIndex, endSection) {
  let rowSpan = 1;
  for (let index = startRowIndex + 1; index < rows.length; index += 1) {
    if (rows[index].startSection > endSection) {
      break;
    }
    rowSpan += 1;
  }
  return rowSpan;
}

function buildCustomCourseHtml(course) {
  const teacherAndPosition = [course.teacher || '', course.position || ''].filter(Boolean).join(' · ');
  return `
    <div class="custom-course-item">
      <div class="course-name">${escapeHtml(course.name || '未命名课程')}</div>
      <div class="course-meta">周${toChineseWeekday(course.day)} · ${escapeHtml(course.customStartTime || '--:--')} - ${escapeHtml(course.customEndTime || '--:--')}</div>
      ${teacherAndPosition ? `<div class="course-meta">${escapeHtml(teacherAndPosition)}</div>` : ''}
    </div>
  `;
}

function getPreviewWeekOptions() {
  return getPreviewWeekOptionsFromExportData(state.lastExportData);
}

function getPreviewWeekOptionsFromExportData(exportData) {
  if (!exportData) {
    return [];
  }
  const weeks = new Set();
  const configuredWeeks = Number(exportData?.config?.semesterTotalWeeks || 0);
  if (configuredWeeks > 0) {
    for (let week = 1; week <= configuredWeeks; week += 1) {
      weeks.add(week);
    }
  }
  (Array.isArray(exportData.courses) ? exportData.courses : []).forEach((course) => {
    normalizeWeeksForAppCourse(course).forEach((week) => {
      const normalized = Number(week);
      if (normalized > 0) {
        weeks.add(normalized);
      }
    });
  });
  return Array.from(weeks).sort((a, b) => a - b);
}

function buildAiExportEffectText(exportData) {
  return buildAppReceivePreviewText(exportData);
}

function buildAppReceivePayloadForAi(exportData) {
  const rawCourses = Array.isArray(exportData?.courses) ? exportData.courses : [];
  const courses = rawCourses
    .map((course) => normalizeAppReceiveCourse(course))
    .filter(Boolean);
  const requiredSectionCount = courses.reduce(
    (max, course) => Math.max(max, Number(course?.endSection || 0)),
    0
  );
  return {
    schema: 'mikcb_extension_app_receive_v1',
    courses,
    timeSlots: Array.isArray(exportData?.timeSlots) ? exportData.timeSlots : [],
    config: exportData?.config && typeof exportData.config === 'object' ? exportData.config : null,
    requiredSectionCount,
  };
}

function normalizeAppReceiveCourse(course) {
  const name = String(course?.name || '').trim();
  const dayOfWeek = Number(course?.dayOfWeek || course?.day || 0);
  const startSection = Number(course?.startSection || 0);
  const endSection = Number(course?.endSection || course?.startSection || 0);
  const customWeeks = normalizeWeeksForAppCourse(course);
  if (!name || !(dayOfWeek >= 1 && dayOfWeek <= 7) || !(startSection >= 1) || !(endSection >= startSection) || !customWeeks.length) {
    return null;
  }
  return {
    name,
    teacher: String(course?.teacher || '').trim() || '未知',
    location: String(course?.position || course?.location || '').trim() || '未知地点',
    dayOfWeek,
    startSection,
    endSection,
    customWeeks,
    courseNature: String(course?.courseNature || '').trim() || 'required',
    note: String(course?.note || '').trim(),
    startWeek: customWeeks[0],
    endWeek: customWeeks[customWeeks.length - 1],
  };
}

function normalizeWeeksForAppCourse(course) {
  const rawWeeks = Array.isArray(course?.weeks)
    ? course.weeks
    : Array.isArray(course?.customWeeks)
      ? course.customWeeks
      : [];
  const weeks = rawWeeks
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > 0);
  return Array.from(new Set(weeks)).sort((a, b) => a - b);
}

function buildAppReceivePreviewText(exportData) {
  const payload = buildAppReceivePayloadForAi(exportData);
  const weeks = Array.from(
    new Set(payload.courses.flatMap((course) => course.customWeeks || []))
  ).sort((a, b) => a - b);
  const headerLines = [
    `软件接收课程数：${payload.courses.length}`,
    `软件接收时间段数：${payload.timeSlots.length}`,
    `软件接收配置：${payload.config ? '有' : '无'}`,
    `软件所需节次数：${payload.requiredSectionCount || 0}`,
  ];

  if (!payload.courses.length) {
    return `${headerLines.join('\n')}\n\n本次脚本没有生成任何可被软件接收的课程。`;
  }

  const lines = [];
  weeks.forEach((week) => {
    const weekCourses = payload.courses
      .filter((course) => (course.customWeeks || []).includes(week))
      .sort((left, right) =>
        left.dayOfWeek - right.dayOfWeek ||
        left.startSection - right.startSection ||
        left.endSection - right.endSection ||
        String(left.name).localeCompare(String(right.name), 'zh-CN')
      );
    if (!weekCourses.length) {
      return;
    }
    lines.push(`第 ${week} 周`);
    weekCourses.forEach((course) => {
      lines.push(`- ${buildAppPreviewLine(course)}`);
    });
  });

  return `${headerLines.join('\n')}\n\n${lines.join('\n')}`;
}

function buildAppPreviewLine(course) {
  const weeks = Array.isArray(course?.customWeeks) ? course.customWeeks : [];
  return `周${toChineseWeekday(course.dayOfWeek)} 第${course.startSection}-${course.endSection}节  ${course.name}  ${course.location || '未填写地点'}  周次：${formatAppPreviewWeeksText(weeks)}`;
}

function formatAppPreviewWeeksText(weeks) {
  if (!Array.isArray(weeks) || !weeks.length) {
    return '未提供周次';
  }
  return weeks.length <= 6
    ? weeks.join('、')
    : `${weeks[0]}-${weeks[weeks.length - 1]}（共 ${weeks.length} 周）`;
}

function analyzeExportDiagnostics(exportData, executionStatus) {
  const issues = [];
  const courses = Array.isArray(exportData?.courses) ? exportData.courses : [];
  const executionMessage = String(executionStatus?.message || '');

  if (/当前页面还没有进入测试会话|Extension context invalidated/i.test(executionMessage)) {
    issues.push({
      severity: 'error',
      type: 'invalid-run-path',
      message: '这次很可能不是从扩展“运行当前脚本”发起的有效测试，而是控制台/失效扩展上下文导致的无效执行。',
    });
  }

  const suspiciousNamePattern = /学期理论课表|理论课表|实践课表|课表查询|全部|筛选|查询|打印|导出|培养管理|我的课表/;
  const multiCoursePattern = /[；;].{1,}/;

  courses.forEach((course, index) => {
    const name = String(course?.name || '').trim();
    const teacher = String(course?.teacher || '').trim();
    const position = String(course?.position || course?.location || '').trim();
    const weeks = Array.isArray(course?.weeks) ? course.weeks : [];

    if (!name) {
      issues.push({
        severity: 'error',
        type: 'empty-name',
        message: `第 ${index + 1} 条课程没有课程名。`,
      });
      return;
    }

    if (suspiciousNamePattern.test(name)) {
      issues.push({
        severity: 'error',
        type: 'header-as-course',
        message: `第 ${index + 1} 条课程名“${truncateText(name, 28)}”像页面标题/筛选项，不像真实课程。`,
      });
    }

    if (multiCoursePattern.test(name)) {
      issues.push({
        severity: 'error',
        type: 'multi-course-merged',
        message: `第 ${index + 1} 条课程名“${truncateText(name, 32)}”包含分号，像多门课被错误合并成一条。`,
      });
    }

    if (name.length >= 26) {
      issues.push({
        severity: 'warn',
        type: 'overlong-name',
        message: `第 ${index + 1} 条课程名过长（${name.length} 字），可能把教师/周次/地点一起塞进课程名了。`,
      });
    }

    if (!teacher && !position && weeks.length <= 1) {
      issues.push({
        severity: 'warn',
        type: 'thin-course',
        message: `第 ${index + 1} 条课程缺少教师和地点，且周次很少，结果可信度偏低。`,
      });
    }
  });

  if (courses.length === 1) {
    issues.push({
      severity: 'warn',
      type: 'single-course-only',
      message: '本次只提取到 1 门课；如果真实课表明显不止 1 门，这通常说明脚本抓错了层级或只抓到了一个大块。',
    });
  }

  const severity = issues.some((issue) => issue.severity === 'error')
    ? 'error'
    : issues.length
        ? 'warn'
        : 'ok';

  const categories = Array.from(new Set(issues.map((issue) => issue.type)));

  const summaryText = issues.length
    ? `${severity === 'error' ? '高风险' : '需留意'}，发现 ${issues.length} 个可疑点。`
    : executionMessage
        ? '未发现明显提取异常。'
        : '';

  return {
    severity,
    issueCount: issues.length,
    categories,
    issues,
    summaryText,
  };
}

function buildRepairGuidanceText(diagnostics) {
  const categories = Array.isArray(diagnostics?.categories) ? diagnostics.categories : [];
  if (!categories.length) {
    return '暂未识别出明显异常类型。请优先对照真实页面、接口数据、iframe 与初始化 JSON，检查课程、周次、节次、地点、教师是否完整。';
  }

  const guidanceMap = {
    'invalid-run-path': '先保证测试链路有效：必须从扩展里点击“运行当前脚本”，不要直接在控制台执行；若扩展刚重载过，先刷新教务页再测试。',
    'header-as-course': '当前脚本把标题/筛选项/表头当成课程了。请收紧课程节点选择条件，并显式排除课表标题、筛选框文本、表头和提示文字。',
    'multi-course-merged': '当前脚本把一个视觉块里的多门课合并成了一条。请先按分号、换行、<br> 或重复课程结构拆分，再逐条解析课程名、教师、周次和地点。',
    'overlong-name': '课程名过长，通常说明教师/周次/地点被拼进了 name。请重新切分字段，而不是继续沿用当前字符串直取逻辑。',
    'thin-course': '当前结果字段过薄。请优先改为读取更底层的数据源（接口/初始化 JSON/iframe 内数据），不要只抓可见文本。',
    'single-course-only': '只提取到极少课程。请检查是否只抓到了单个大块、当前周视图、折叠区域，或没有进入真正的课表 iframe。',
    'empty-name': '出现空课程名。请在组装结果前增加基础校验，未能稳定识别课程名时不要输出该记录。',
  };

  return categories
    .map((category) => `- ${guidanceMap[category] || `请重点修复异常类型：${category}`}`)
    .join('\n');
}

function buildSnapshotStructureSummary(snapshot) {
  const structure = snapshot?.structureSummary || {};
  const iframeSummaries = Array.isArray(snapshot?.sameOriginIframes) ? snapshot.sameOriginIframes : [];
  const parts = [
    `页面 URL：${snapshot?.url || '未知'}`,
    `页面标题：${snapshot?.title || '未知'}`,
    `表格数：${structure.tableCount ?? snapshot?.tables?.length ?? 0}`,
    `iframe 数：${structure.iframeCount ?? iframeSummaries.length}`,
    `script 数：${structure.scriptCount ?? snapshot?.scripts?.length ?? 0}`,
    `绝对定位节点数：${structure.absolutePositionedNodeCount ?? 0}`,
  ];

  const courseLikeSamples = Array.isArray(structure.courseLikeTextBlocks)
    ? structure.courseLikeTextBlocks.slice(0, 6).map((item, index) => `${index + 1}. [${item.tag}] ${truncateText(item.text, 80)}`)
    : [];
  if (courseLikeSamples.length) {
    parts.push('课程样文本候选：');
    parts.push(...courseLikeSamples);
  }

  const absoluteSamples = Array.isArray(structure.absolutePositionedNodes)
    ? structure.absolutePositionedNodes.slice(0, 6).map((item, index) => `${index + 1}. [${item.tag}] ${truncateText(item.text, 80)}`)
    : [];
  if (absoluteSamples.length) {
    parts.push('绝对定位节点样本：');
    parts.push(...absoluteSamples);
  }

  if (iframeSummaries.length) {
    parts.push('同源 iframe 摘要：');
    iframeSummaries.slice(0, 4).forEach((iframe, index) => {
      parts.push(
        `${index + 1}. title=${iframe.title || '(无标题)'} src=${iframe.src || '(无src)'} tableCount=${iframe.tableCount ?? '?'} absoluteNodes=${iframe.absolutePositionedNodeCount ?? '?'}`
      );
      if (iframe.textPreview) {
        parts.push(`   text=${truncateText(iframe.textPreview, 120)}`);
      }
    });
  }

  return parts.join('\n');
}

function formatAiCourseEffectItem(course) {
  const name = course?.name || '未命名课程';
  const teacher = course?.teacher ? ` / ${course.teacher}` : '';
  const position = course?.position ? ` / ${course.position}` : '';
  if (course?.isCustomTime) {
    return `${name}${teacher}${position} / ${course.customStartTime || '--:--'}-${course.customEndTime || '--:--'}`;
  }
  const sectionText = course?.endSection && Number(course.endSection) !== Number(course.startSection)
    ? `第${course.startSection}-${course.endSection}节`
    : `第${course.startSection || '?'}节`;
  return `${name}${teacher}${position} / ${sectionText}`;
}

function normalizePreviewWeek() {
  const weeks = getPreviewWeekOptions();
  if (!weeks.length) {
    state.previewWeek = 1;
    return;
  }
  if (!weeks.includes(Number(state.previewWeek))) {
    state.previewWeek = weeks[0];
  }
}

function courseMatchesWeek(course, week) {
  return normalizeWeeksForAppCourse(course).includes(Number(week));
}

function toChineseWeekday(day) {
  return ['一', '二', '三', '四', '五', '六', '日'][Math.max(1, Number(day || 1)) - 1] || '?';
}

function truncateText(text, maxLength) {
  const source = String(text || '');
  if (source.length <= maxLength) {
    return source;
  }
  return `${source.slice(0, Math.max(0, maxLength - 1))}…`;
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

function renderScriptDraftActions() {
  if (!dom.downloadScriptButton) {
    return;
  }
  dom.downloadScriptButton.disabled = !stripCodeFences(state.scriptSource).trim();
}

function buildScriptDownloadFilename() {
  const prefix = 'course-importer-drafts';
  const resourceFolder = sanitizeDownloadPathSegment(state.school.resource_folder);
  const adapterId = sanitizeDownloadPathSegment(state.adapter.adapter_id);
  const adapterName = sanitizeDownloadPathSegment(state.adapter.adapter_name);
  const schoolId = sanitizeDownloadPathSegment(state.school.id);
  const schoolName = sanitizeDownloadPathSegment(state.school.name);
  const assetPath = sanitizeDownloadRelativeJsPath(state.adapter.asset_js_path);

  if (resourceFolder && assetPath) {
    return `${prefix}/resources/${resourceFolder}/${assetPath}`;
  }
  if (resourceFolder && adapterId) {
    return `${prefix}/${resourceFolder}/${adapterId}.js`;
  }

  const schoolPart = resourceFolder || schoolId || schoolName;
  const adapterPart = adapterId || adapterName;
  if (schoolPart && adapterPart) {
    return `${prefix}/${schoolPart}__${adapterPart}.js`;
  }
  if (schoolPart) {
    return `${prefix}/${schoolPart}.js`;
  }
  if (adapterPart) {
    return `${prefix}/${adapterPart}.js`;
  }
  return `${prefix}/script-draft-${formatTimestampForFilename(new Date())}.js`;
}

function ensureTrailingNewline(text) {
  return text.endsWith('\n') ? text : `${text}\n`;
}

function sanitizeDownloadPathSegment(value) {
  return String(value || '')
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.\-_\s]+|[.\-_\s]+$/g, '');
}

function sanitizeDownloadRelativeJsPath(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return '';
  }
  const segments = trimmed
    .split('/')
    .map((segment) => sanitizeDownloadPathSegment(segment))
    .filter(Boolean);
  if (!segments.length) {
    return '';
  }
  const lastIndex = segments.length - 1;
  if (!/\.js$/i.test(segments[lastIndex])) {
    segments[lastIndex] = `${segments[lastIndex]}.js`;
  }
  return segments.join('/');
}

function formatTimestampForFilename(date) {
  const parts = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0'),
  ];
  return `${parts[0]}${parts[1]}${parts[2]}-${parts[3]}${parts[4]}${parts[5]}`;
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

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

function isValidView(view) {
  return Object.prototype.hasOwnProperty.call(VIEW_META, view);
}

function ensureTabSupportsInjection(tab) {
  const url = String(tab?.url || '');
  if (!url) {
    throw new Error('当前标签页没有可用地址，请切回教务网页后重试。');
  }
  if (
    url.startsWith('chrome://') ||
    url.startsWith('edge://') ||
    url.startsWith('about:') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('devtools://')
  ) {
    throw new Error('当前页面不支持扩展注入，请切换到教务网页标签页后再试。');
  }
}

function isMissingReceiverError(error) {
  const message = String(error?.message || error || '');
  return message.includes('Could not establish connection') || message.includes('Receiving end does not exist');
}
