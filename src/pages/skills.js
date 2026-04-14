import { api } from '../lib/api';
import { openFinderLocation } from '../lib/desktop';
import {
  buildConfigDrilldownIntent,
  buildDiagnosticsDrilldownIntent,
  buildExtensionsDrilldownIntent,
  buildLogsDrilldownIntent,
} from '../lib/drilldown';
import { getPanelState, loadShell, navigate, notify, subscribePanelState } from '../lib/panel-state';
import {
  buttonHtml,
  emptyStateHtml,
  pillHtml,
} from './native-helpers';
import {
  cloneSkillImportDraft,
  cloneSkillDraft,
  deriveSkillsWorkbenchState,
  relaySeed,
  renderSkillsWorkbench,
} from './skills-workbench';

let activeView = null;

function directoryOf(path) {
  const normalized = String(path ?? '').trim();
  const index = normalized.lastIndexOf('/');
  return index > 0 ? normalized.slice(0, index) : normalized;
}

function currentSkill(view) {
  return view.skills.find((item) => item.filePath === view.selectedPath)
    ?? view.skills[0]
    ?? null;
}

function selectedJobs(view, skill = currentSkill(view)) {
  if (!skill || !view.cron) {
    return [];
  }

  return view.cron.jobs.filter((job) => job.skills.includes(skill.name));
}

function createSkillFrontmatterDraft(detail) {
  if (!detail) {
    return null;
  }

  return {
    category: detail.category || '',
    description: detail.description || '',
    filePath: detail.filePath || '',
    name: detail.name || '',
    relativePath: detail.relativePath || '',
  };
}

function applySkillFileDetail(view, detail) {
  view.skillFile = detail;
  view.skillFileSavedContent = detail.content;
  view.skillFrontmatterDraft = createSkillFrontmatterDraft(detail);
  view.skillDeleteConfirm = '';
}

function syncSkillInlineControls(view) {
  const skill = currentSkill(view);
  const jobs = selectedJobs(view, skill);
  const frontmatterDraft = view.skillFrontmatterDraft;
  const frontmatterDirty = Boolean(
    skill
    && frontmatterDraft
    && frontmatterDraft.filePath === skill.filePath
    && (
      frontmatterDraft.name.trim() !== String(view.skillFile?.name || skill.name || '').trim()
      || frontmatterDraft.description.trim() !== String(view.skillFile?.description || skill.description || '').trim()
    ),
  );
  const fileDirty = Boolean(view.skillFile && view.skillFile.content !== view.skillFileSavedContent);
  const deleteReady = Boolean(skill && view.skillDeleteConfirm.trim() === skill.name && jobs.length === 0);

  const frontmatterPill = view.page.querySelector('#skill-frontmatter-dirty-pill');
  const filePill = view.page.querySelector('#skill-file-dirty-pill');
  const frontmatterSave = view.page.querySelector('#skill-frontmatter-save');
  const fileSave = view.page.querySelector('#skill-file-save');
  const deleteButton = view.page.querySelector('#skill-delete-submit');

  if (frontmatterPill) {
    frontmatterPill.innerHTML = pillHtml(frontmatterDirty ? '未保存' : '已同步', frontmatterDirty ? 'warn' : 'good');
  }
  if (filePill) {
    filePill.innerHTML = pillHtml(fileDirty ? '未保存' : '已同步', fileDirty ? 'warn' : 'good');
  }
  if (frontmatterSave) {
    frontmatterSave.disabled = Boolean(view.runningAction) || !frontmatterDraft?.name?.trim() || !frontmatterDirty;
  }
  if (fileSave) {
    fileSave.disabled = Boolean(view.runningAction) || !view.skillFile || !fileDirty;
  }
  if (deleteButton) {
    deleteButton.disabled = Boolean(view.runningAction) || !deleteReady;
  }
}

function renderSkeleton(view) {
  view.page.innerHTML = `
    <div class="page-header page-header-compact">
      <div class="panel-title-row">
        <h1 class="page-title">技能工作台</h1>
      </div>
      <p class="page-desc">正在同步技能目录、运行态和安装面。</p>
    </div>
    <div class="stat-cards">
      ${Array.from({ length: 6 }).map(() => '<div class="stat-card loading-placeholder" style="min-height:104px"></div>').join('')}
    </div>
  `;
}

function renderPage(view) {
  if (view.destroyed) {
    return;
  }

  if (view.loading && !view.dashboard) {
    renderSkeleton(view);
    return;
  }

  if (view.error || !view.dashboard || !view.installation || !view.extensions || !view.cron) {
    view.page.innerHTML = `
      <div class="page-header page-header-compact">
        <div class="panel-title-row">
          <h1 class="page-title">技能工作台</h1>
        </div>
        <p class="page-desc">围绕技能目录、安装和运行态做统一治理。</p>
      </div>
      <section class="config-section">
        <div class="config-section-header">
          <div>
            <h2 class="config-section-title">读取失败</h2>
            <p class="config-section-desc">技能快照暂时不可用，可以重新拉取状态后再继续治理。</p>
          </div>
          <div class="toolbar">
            ${buttonHtml({ action: 'refresh', label: view.refreshing ? '同步中…' : '重新读取', kind: 'primary', disabled: view.refreshing })}
          </div>
        </div>
        ${emptyStateHtml('未能读取技能工作台快照', view.error || '请稍后重试。')}
      </section>
    `;
    bindEvents(view);
    return;
  }

  const state = deriveSkillsWorkbenchState(view);
  const { skill } = state;
  const seed = relaySeed(view, skill);
  const logsIntent = buildLogsDrilldownIntent(seed, {
    logName: 'agent',
    contains: skill?.name ?? view.query ?? '',
    limit: '160',
  });
  const diagnosticsIntent = buildDiagnosticsDrilldownIntent(seed, {
    suggestedCommand: skill ? 'tools-summary' : 'doctor',
    logName: 'agent',
  });
  const configToolsetsIntent = buildConfigDrilldownIntent(seed, {
    description: '继续在配置中心核对 toolsets、外部 skills 目录和技能暴露范围。',
    focus: 'toolsets',
  });
  const configMemoryIntent = buildConfigDrilldownIntent(seed, {
    description: '继续在配置中心核对记忆开关、provider 与长期记忆链路。',
    focus: 'memory',
  });
  const extensionsIntent = buildExtensionsDrilldownIntent(seed, {
    description: skill
      ? `继续核对技能 ${skill.name} 关联的 runtime source、插件和扩展状态。`
      : '继续核对技能层关联的 runtime source、插件和扩展状态。',
    rawKind: 'skills',
    query: skill?.name ?? view.query,
    sourceFilter: view.extensions.runtimeSkills.some((item) => item.source === 'local') ? 'local' : 'all',
  });
  view.page.innerHTML = renderSkillsWorkbench(view, state);

  bindEvents(view, {
    configMemoryIntent,
    configToolsetsIntent,
    diagnosticsIntent,
    extensionsIntent,
    logsIntent,
    skill,
  });

  const queryInput = view.page.querySelector('#skills-query');
  const categorySelect = view.page.querySelector('#skills-category-filter');
  const registryInput = view.page.querySelector('#skills-registry-query');
  const installInput = view.page.querySelector('#skills-install-target');

  if (queryInput) {
    queryInput.value = view.query;
  }
  if (categorySelect) {
    categorySelect.value = view.categoryFilter;
  }
  if (registryInput) {
    registryInput.value = view.registryQuery;
  }
  if (installInput) {
    installInput.value = view.installTarget;
  }
}

async function loadData(view, options = {}) {
  const { silent = false } = options;
  const hasData = Boolean(view.dashboard && view.installation && view.extensions && view.cron);

  if (!silent && !hasData) {
    view.loading = true;
  } else {
    view.refreshing = true;
  }
  view.error = null;
  renderPage(view);

  try {
    const profile = view.profile;
    const [skills, dashboard, installation, extensions, cron] = await Promise.all([
      api.listSkills(profile),
      api.getDashboardSnapshot(profile),
      api.getInstallationSnapshot(profile),
      api.getExtensionsSnapshot(profile),
      api.getCronJobs(profile),
    ]);

    if (view.destroyed || profile !== view.profile) {
      return;
    }

    view.skills = skills;
    view.dashboard = dashboard;
    view.installation = installation;
    view.extensions = extensions;
    view.cron = cron;
    view.selectedPath = skills.some((item) => item.filePath === view.selectedPath)
      ? view.selectedPath
      : skills[0]?.filePath ?? null;

    if (view.selectedPath) {
      await loadSkillFile(view, view.selectedPath, { silent: true });
    } else {
      view.skillFile = null;
      view.skillFrontmatterDraft = null;
      view.skillFileSavedContent = '';
      view.skillDeleteConfirm = '';
    }
  } catch (reason) {
    if (view.destroyed) {
      return;
    }
    view.error = String(reason);
    if (hasData && !silent) {
      notify('error', view.error);
    }
  } finally {
    view.loading = false;
    view.refreshing = false;
    renderPage(view);
  }
}

async function loadSkillFile(view, filePath, options = {}) {
  const { silent = false } = options;
  if (!filePath) {
    view.skillFile = null;
    view.skillFrontmatterDraft = null;
    view.skillFileSavedContent = '';
    view.skillDeleteConfirm = '';
    renderPage(view);
    return;
  }

  view.skillFileLoading = true;
  if (!silent) {
    renderPage(view);
  }
  try {
    const detail = await api.readSkillFile(filePath, view.profile);
    if (view.destroyed) {
      return;
    }
    if (filePath !== view.selectedPath) {
      return;
    }
    applySkillFileDetail(view, detail);
  } catch (reason) {
    if (!silent) {
      notify('error', String(reason));
    }
  } finally {
    view.skillFileLoading = false;
    renderPage(view);
  }
}

function storeResult(view, label, result) {
  view.lastResult = {
    label,
    result,
  };
}

async function executeSkillAction(view, action, value, options = {}) {
  const actionId = options.actionId ?? `skills:${action}`;
  const label = options.label ?? `skills ${action}`;

  view.runningAction = actionId;
  renderPage(view);
  try {
    const result = await api.runSkillAction(action, value || null, view.profile);
    storeResult(view, label, result);
    notify(
      result.success ? 'success' : 'error',
      result.success
        ? `${label} 已在客户端执行。`
        : `${label} 执行失败，请查看命令输出。`,
    );
    if (options.refresh) {
      await Promise.all([
        loadShell(view.profile, { silent: true }),
        loadData(view, { silent: true }),
      ]);
    }
  } catch (reason) {
    notify('error', String(reason));
  } finally {
    view.runningAction = null;
    renderPage(view);
  }
}

async function openInFinder(view, path, label, revealInFinder = false) {
  view.runningAction = `finder:${label}`;
  renderPage(view);
  try {
    await openFinderLocation({
      actionKey: `finder:${label}`,
      label,
      notify,
      onResult: (nextLabel, result) => {
        storeResult(view, nextLabel, result);
      },
      path,
      revealInFinder,
      setBusy: (value) => {
        view.runningAction = value;
        renderPage(view);
      },
    });
  } finally {
    view.runningAction = null;
    renderPage(view);
  }
}

async function saveSkillFile(view) {
  if (!view.skillFile) {
    notify('error', '请先选择要保存的技能文件。');
    return;
  }

  view.runningAction = 'skills:save-file';
  renderPage(view);
  try {
    const detail = await api.saveSkillFile({
      content: view.skillFile.content,
      filePath: view.skillFile.filePath,
    }, view.profile);
    applySkillFileDetail(view, detail);
    notify('success', `${detail.name} 已保存。`);
    await loadData(view, { silent: true });
  } catch (reason) {
    notify('error', String(reason));
  } finally {
    view.runningAction = null;
    renderPage(view);
  }
}

async function saveSkillFrontmatter(view) {
  const skill = currentSkill(view);
  const draft = view.skillFrontmatterDraft;
  if (!skill || !draft || draft.filePath !== skill.filePath) {
    notify('error', '请先选择要接管的技能。');
    return;
  }

  if (!draft.name.trim()) {
    notify('error', '技能名称不能为空。');
    return;
  }

  view.runningAction = 'skills:save-frontmatter';
  renderPage(view);
  try {
    const detail = await api.saveSkillFrontmatter({
      description: draft.description.trim(),
      filePath: draft.filePath,
      name: draft.name.trim(),
    }, view.profile);
    applySkillFileDetail(view, detail);
    notify('success', `${detail.name} 的 frontmatter 已保存。`);
    await loadData(view, { silent: true });
  } catch (reason) {
    notify('error', String(reason));
  } finally {
    view.runningAction = null;
    renderPage(view);
  }
}

async function createLocalSkill(view) {
  const draft = view.createDraft ?? cloneSkillDraft();
  if (!draft.name.trim()) {
    notify('error', '请先填写技能名称。');
    return;
  }

  view.runningAction = 'skills:create-local';
  renderPage(view);
  try {
    const detail = await api.createSkill({
      category: draft.category.trim() || 'custom',
      content: draft.content,
      description: draft.description.trim(),
      name: draft.name.trim(),
      overwrite: false,
    }, view.profile);
    notify('success', `${detail.name} 已创建到本地 skills 目录。`);
    view.createDraft = cloneSkillDraft();
    view.selectedPath = detail.filePath;
    await loadData(view, { silent: true });
  } catch (reason) {
    notify('error', String(reason));
  } finally {
    view.runningAction = null;
    renderPage(view);
  }
}

async function importLocalSkill(view) {
  const draft = view.importDraft ?? cloneSkillImportDraft();
  if (!draft.sourcePath.trim()) {
    notify('error', '请先填写技能目录或 SKILL.md 路径。');
    return;
  }

  view.runningAction = 'skills:import-local';
  renderPage(view);
  try {
    const result = await api.importSkill({
      category: draft.category.trim(),
      overwrite: Boolean(draft.overwrite),
      sourcePath: draft.sourcePath.trim(),
    }, view.profile);
    view.lastImportedSkill = result;
    storeResult(view, `导入技能 · ${result.imported.name}`, {
      command: 'local://skills/import',
      exitCode: 0,
      stderr: '',
      stdout: `source: ${result.sourcePath}\ntarget: ${result.targetDirectory}\nfiles: ${result.copiedFiles}`,
      success: true,
    });
    notify('success', `${result.imported.name} 已导入，复制了 ${result.copiedFiles} 个文件。`);
    view.importDraft = cloneSkillImportDraft({
      category: result.imported.category,
    });
    view.selectedPath = result.imported.filePath;
    await loadData(view, { silent: true });
  } catch (reason) {
    notify('error', String(reason));
  } finally {
    view.runningAction = null;
    renderPage(view);
  }
}

async function deleteLocalSkill(view) {
  const skill = currentSkill(view);
  if (!skill) {
    notify('error', '请先选择要删除的技能。');
    return;
  }

  if (selectedJobs(view, skill).length > 0) {
    notify('error', '当前技能仍被 cron 作业引用，请先解除编排绑定。');
    return;
  }

  if (view.skillDeleteConfirm.trim() !== skill.name) {
    notify('error', `请输入 ${skill.name} 以确认删除。`);
    return;
  }

  view.runningAction = 'skills:delete-local';
  renderPage(view);
  try {
    const result = await api.deleteLocalSkill({
      filePath: skill.filePath,
      name: skill.name,
    }, view.profile);
    storeResult(view, `删除本地技能 · ${result.name}`, {
      command: 'local://skills/delete',
      exitCode: 0,
      stderr: '',
      stdout: `name: ${result.name}\ndirectory: ${result.directoryPath}\nfiles: ${result.removedFiles}`,
      success: true,
    });
    notify('success', `${result.name} 已从当前 profile 删除。`);
    view.selectedPath = null;
    view.skillFile = null;
    view.skillFrontmatterDraft = null;
    view.skillDeleteConfirm = '';
    view.skillFileSavedContent = '';
    await loadData(view, { silent: true });
  } catch (reason) {
    notify('error', String(reason));
  } finally {
    view.runningAction = null;
    renderPage(view);
  }
}

function syncWithPanelState(view) {
  const nextProfile = getPanelState().selectedProfile;
  if (nextProfile !== view.profile) {
    view.profile = nextProfile;
    view.dashboard = null;
    view.installation = null;
    view.extensions = null;
    view.cron = null;
    view.importDraft = cloneSkillImportDraft();
    view.skills = [];
    view.error = null;
    view.lastResult = null;
    view.lastImportedSkill = null;
    view.skillFile = null;
    view.skillFrontmatterDraft = null;
    view.skillFileSavedContent = '';
    view.skillDeleteConfirm = '';
    void loadData(view);
    return;
  }

  renderPage(view);
}

function bindEvents(view, intents = {}) {
  const queryInput = view.page.querySelector('#skills-query');
  const categorySelect = view.page.querySelector('#skills-category-filter');
  const registryInput = view.page.querySelector('#skills-registry-query');
  const installInput = view.page.querySelector('#skills-install-target');
  const skillFrontmatterDisclosure = view.page.querySelector('#skills-frontmatter-disclosure');
  const skillFrontmatterName = view.page.querySelector('#skill-frontmatter-name');
  const skillFrontmatterDescription = view.page.querySelector('#skill-frontmatter-description');
  const skillContentDisclosure = view.page.querySelector('#skills-content-disclosure');
  const skillLocalOpsDisclosure = view.page.querySelector('#skills-localops-disclosure');
  const skillDeleteConfirm = view.page.querySelector('#skill-delete-confirm');

  if (queryInput) {
    queryInput.oninput = (event) => {
      view.query = event.target.value;
      renderPage(view);
    };
  }

  if (categorySelect) {
    categorySelect.onchange = (event) => {
      view.categoryFilter = event.target.value;
      renderPage(view);
    };
  }

  if (registryInput) {
    registryInput.oninput = (event) => {
      view.registryQuery = event.target.value;
      renderPage(view);
    };
    registryInput.onkeydown = (event) => {
      if (event.key === 'Enter' && view.registryQuery.trim()) {
        event.preventDefault();
        void executeSkillAction(view, 'search', view.registryQuery.trim(), {
          actionId: 'skills:search',
          label: `搜索技能 · ${view.registryQuery.trim()}`,
        });
      }
    };
  }

  if (installInput) {
    installInput.oninput = (event) => {
      view.installTarget = event.target.value;
      renderPage(view);
    };
    installInput.onkeydown = (event) => {
      if (event.key === 'Enter' && view.installTarget.trim()) {
        event.preventDefault();
        void executeSkillAction(view, 'inspect', view.installTarget.trim(), {
          actionId: 'skills:inspect',
          label: `预检技能 · ${view.installTarget.trim()}`,
        });
      }
    };
  }

  if (skillFrontmatterDisclosure) {
    skillFrontmatterDisclosure.ontoggle = () => {
      view.skillFrontmatterExpanded = skillFrontmatterDisclosure.open;
    };
  }

  if (skillContentDisclosure) {
    skillContentDisclosure.ontoggle = () => {
      view.skillContentExpanded = skillContentDisclosure.open;
    };
  }

  if (skillLocalOpsDisclosure) {
    skillLocalOpsDisclosure.ontoggle = () => {
      view.skillLocalOpsExpanded = skillLocalOpsDisclosure.open;
    };
  }

  if (skillFrontmatterName) {
    skillFrontmatterName.oninput = (event) => {
      if (!view.skillFrontmatterDraft) {
        return;
      }
      view.skillFrontmatterDraft.name = event.target.value;
      syncSkillInlineControls(view);
    };
  }

  if (skillFrontmatterDescription) {
    skillFrontmatterDescription.oninput = (event) => {
      if (!view.skillFrontmatterDraft) {
        return;
      }
      view.skillFrontmatterDraft.description = event.target.value;
      syncSkillInlineControls(view);
    };
  }

  view.page.querySelector('#skill-create-name')?.addEventListener('input', (event) => {
    view.createDraft.name = event.target.value;
    const submit = view.page.querySelector('#skill-create-submit');
    if (submit) {
      submit.disabled = Boolean(view.runningAction) || !view.createDraft.name.trim();
    }
  });
  view.page.querySelector('#skill-create-category')?.addEventListener('input', (event) => {
    view.createDraft.category = event.target.value;
  });
  view.page.querySelector('#skill-create-description')?.addEventListener('input', (event) => {
    view.createDraft.description = event.target.value;
  });
  view.page.querySelector('#skill-create-content')?.addEventListener('input', (event) => {
    view.createDraft.content = event.target.value;
  });
  view.page.querySelector('#skill-import-source')?.addEventListener('input', (event) => {
    view.importDraft.sourcePath = event.target.value;
    const submit = view.page.querySelector('#skill-import-submit');
    if (submit) {
      submit.disabled = Boolean(view.runningAction) || !view.importDraft.sourcePath.trim();
    }
  });
  view.page.querySelector('#skill-import-category')?.addEventListener('input', (event) => {
    view.importDraft.category = event.target.value;
  });
  view.page.querySelector('#skill-import-overwrite')?.addEventListener('change', (event) => {
    view.importDraft.overwrite = Boolean(event.target.checked);
  });
  view.page.querySelector('#skill-content-editor')?.addEventListener('input', (event) => {
    if (view.skillFile) {
      view.skillFile.content = event.target.value;
      syncSkillInlineControls(view);
    }
  });
  skillDeleteConfirm?.addEventListener('input', (event) => {
    view.skillDeleteConfirm = event.target.value;
    syncSkillInlineControls(view);
  });

  syncSkillInlineControls(view);

  view.page.querySelectorAll('[data-action]').forEach((element) => {
    element.onclick = async () => {
      const action = element.getAttribute('data-action');
      if (!action) {
        return;
      }

      switch (action) {
        case 'refresh':
          await loadData(view);
          return;
        case 'switch-workspace-tab':
          view.workspaceTab = element.getAttribute('data-tab') || 'overview';
          renderPage(view);
          return;
        case 'select-skill':
          view.selectedPath = element.getAttribute('data-path');
          await loadSkillFile(view, view.selectedPath);
          return;
        case 'filter-category':
          view.categoryFilter = element.getAttribute('data-value') || 'all';
          renderPage(view);
          return;
        case 'create-local-skill':
          await createLocalSkill(view);
          return;
        case 'import-local-skill':
          await importLocalSkill(view);
          return;
        case 'reset-local-skill-draft':
          view.createDraft = cloneSkillDraft();
          renderPage(view);
          return;
        case 'reset-skill-import-draft':
          view.importDraft = cloneSkillImportDraft();
          renderPage(view);
          return;
        case 'save-skill-frontmatter':
          await saveSkillFrontmatter(view);
          return;
        case 'reset-skill-frontmatter':
          view.skillFrontmatterDraft = createSkillFrontmatterDraft(view.skillFile);
          renderPage(view);
          return;
        case 'save-skill-file':
          await saveSkillFile(view);
          return;
        case 'reload-skill-file':
          await loadSkillFile(view, view.selectedPath);
          return;
        case 'delete-local-skill':
          await deleteLocalSkill(view);
          return;
        case 'skills-check':
          await executeSkillAction(view, 'check', null, {
            actionId: 'skills:check',
            label: '检查技能更新',
          });
          return;
        case 'skills-update':
          await executeSkillAction(view, 'update', null, {
            actionId: 'skills:update',
            label: '更新已装技能',
            refresh: true,
          });
          return;
        case 'skills-search':
          await executeSkillAction(view, 'search', view.registryQuery.trim(), {
            actionId: 'skills:search',
            label: `搜索技能 · ${view.registryQuery.trim()}`,
          });
          return;
        case 'skills-inspect':
          await executeSkillAction(view, 'inspect', view.installTarget.trim(), {
            actionId: 'skills:inspect',
            label: `预检技能 · ${view.installTarget.trim()}`,
          });
          return;
        case 'skills-install':
          await executeSkillAction(view, 'install', view.installTarget.trim(), {
            actionId: 'skills:install',
            label: `安装技能 · ${view.installTarget.trim()}`,
            refresh: true,
          });
          return;
        case 'skills-audit':
          await executeSkillAction(view, 'audit', null, {
            actionId: 'skills:audit',
            label: '审计已装技能',
          });
          return;
        case 'use-selected-skill-name':
          if (intents.skill) {
            view.registryQuery = intents.skill.name;
            view.installTarget = intents.skill.name;
            renderPage(view);
          }
          return;
        case 'use-selected-skill-category':
          if (intents.skill) {
            view.createDraft.category = intents.skill.category || view.createDraft.category;
            view.importDraft.category = intents.skill.category || view.importDraft.category;
            renderPage(view);
          }
          return;
        case 'open-skill-file':
          if (intents.skill) {
            await openInFinder(view, intents.skill.filePath, `${intents.skill.name} 技能文件`, true);
          }
          return;
        case 'open-skill-dir':
          if (intents.skill) {
            await openInFinder(view, directoryOf(intents.skill.filePath), `${intents.skill.name} 技能目录`);
          }
          return;
        case 'open-home':
          await openInFinder(view, view.dashboard.hermesHome, 'Hermes Home');
          return;
        case 'goto-logs':
          navigate('logs', intents.logsIntent);
          return;
        case 'goto-cron':
          navigate('cron');
          return;
        case 'goto-diagnostics':
          navigate('diagnostics', intents.diagnosticsIntent);
          return;
        case 'goto-config-toolsets':
          navigate('config', intents.configToolsetsIntent);
          return;
        case 'goto-config-memory':
          navigate('config', intents.configMemoryIntent);
          return;
        case 'goto-extensions':
          navigate('extensions', intents.extensionsIntent);
          return;
        default:
          return;
      }
    };
  });
}

export async function render() {
  cleanup();

  const page = document.createElement('div');
  page.className = 'page';

  activeView = {
    categoryFilter: 'all',
    cron: null,
    createDraft: cloneSkillDraft(),
    dashboard: null,
    destroyed: false,
    error: null,
    extensions: null,
    importDraft: cloneSkillImportDraft(),
    installation: null,
    lastImportedSkill: null,
    lastResult: null,
    loading: true,
    page,
    profile: getPanelState().selectedProfile,
    query: '',
    refreshing: false,
    registryQuery: '',
    runningAction: null,
    selectedPath: null,
    skillContentExpanded: true,
    skillDeleteConfirm: '',
    skillFile: null,
    skillFileLoading: false,
    skillFileSavedContent: '',
    skillFrontmatterDraft: null,
    skillFrontmatterExpanded: true,
    skillLocalOpsExpanded: false,
    skills: [],
    installTarget: '',
    unsubscribe: null,
    workspaceTab: 'studio',
  };

  activeView.unsubscribe = subscribePanelState(() => {
    syncWithPanelState(activeView);
  });

  renderSkeleton(activeView);
  await loadData(activeView);
  return page;
}

export function cleanup() {
  if (!activeView) {
    return;
  }

  activeView.destroyed = true;
  activeView.unsubscribe?.();
  activeView = null;
}
