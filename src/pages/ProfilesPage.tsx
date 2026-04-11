import { useEffect, useMemo, useState } from 'react';

import { api } from '../lib/api';
import type {
  CommandRunResult,
  ProfileCreateRequest,
  ProfileDeleteRequest,
  ProfileExportRequest,
  ProfileImportRequest,
  ProfileRenameRequest,
  ProfileSummary,
} from '../types';
import { Button, EmptyState, Panel, Pill, Toolbar } from '../components/ui';
import type { PageProps } from './types';

type CreateMode = 'fresh' | 'clone' | 'clone-all';

export function ProfilesPage({ notify, profiles, refreshProfiles }: PageProps) {
  const [selectedName, setSelectedName] = useState<string | null>(null);

  const [createName, setCreateName] = useState('');
  const [createMode, setCreateMode] = useState<CreateMode>('fresh');
  const [cloneFrom, setCloneFrom] = useState('default');
  const [noAlias, setNoAlias] = useState(false);

  const [renameTo, setRenameTo] = useState('');
  const [exportOutput, setExportOutput] = useState('');
  const [importArchive, setImportArchive] = useState('');
  const [importName, setImportName] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');

  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [lastCommand, setLastCommand] = useState<CommandRunResult | null>(null);

  const profileItems = profiles?.profiles ?? [];

  useEffect(() => {
    if (!profileItems.length) {
      setSelectedName(null);
      return;
    }
    if (!selectedName || !profileItems.some((item) => item.name === selectedName)) {
      setSelectedName(profiles?.activeProfile ?? profileItems[0]?.name ?? null);
    }
  }, [profileItems, profiles?.activeProfile, selectedName]);

  const selectedProfile = useMemo<ProfileSummary | null>(() => (
    profileItems.find((item) => item.name === selectedName)
    ?? profileItems[0]
    ?? null
  ), [profileItems, selectedName]);

  useEffect(() => {
    setRenameTo(selectedProfile && !selectedProfile.isDefault ? selectedProfile.name : '');
    setDeleteConfirm('');
    setExportOutput(selectedProfile ? `${selectedProfile.name}.tar.gz` : '');
  }, [selectedProfile?.name, selectedProfile?.isDefault]);

  async function createProfile() {
    const normalizedName = createName.trim();
    if (!normalizedName) {
      notify('error', 'profile 名称不能为空。');
      return;
    }

    setRunningAction('create-profile');
    try {
      const request: ProfileCreateRequest = {
        profileName: normalizedName,
        clone: createMode === 'clone',
        cloneAll: createMode === 'clone-all',
        cloneFrom: createMode === 'fresh' ? null : cloneFrom,
        noAlias,
      };
      const result = await api.createProfile(request);
      setLastCommand(result);
      notify(result.success ? 'success' : 'error', `profile ${normalizedName} 创建命令已执行。`);
      await refreshProfiles(normalizedName);
      setSelectedName(normalizedName);
      setCreateName('');
      setCreateMode('fresh');
      setCloneFrom('default');
      setNoAlias(false);
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setRunningAction(null);
    }
  }

  async function activateProfile(name: string) {
    setRunningAction(`activate:${name}`);
    try {
      await api.setActiveProfile(name);
      await refreshProfiles(name);
      notify('success', `已将 ${name} 设为 Hermes 默认 profile。`);
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setRunningAction(null);
    }
  }

  async function renameProfile() {
    if (!selectedProfile || selectedProfile.isDefault) {
      notify('error', 'default profile 不支持重命名。');
      return;
    }

    const normalizedName = renameTo.trim();
    if (!normalizedName || normalizedName === selectedProfile.name) {
      notify('error', '请输入新的 profile 名称。');
      return;
    }

    setRunningAction('rename-profile');
    try {
      const request: ProfileRenameRequest = {
        oldName: selectedProfile.name,
        newName: normalizedName,
      };
      const result = await api.renameProfile(request);
      setLastCommand(result);
      notify(result.success ? 'success' : 'error', `profile ${selectedProfile.name} 重命名命令已执行。`);
      await refreshProfiles(normalizedName);
      setSelectedName(normalizedName);
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setRunningAction(null);
    }
  }

  async function exportProfile() {
    if (!selectedProfile) return;

    setRunningAction('export-profile');
    try {
      const request: ProfileExportRequest = {
        profileName: selectedProfile.name,
        output: exportOutput.trim() || null,
      };
      const result = await api.exportProfile(request);
      setLastCommand(result);
      notify(result.success ? 'success' : 'error', `profile ${selectedProfile.name} 导出命令已执行。`);
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setRunningAction(null);
    }
  }

  async function importProfile() {
    const archive = importArchive.trim();
    if (!archive) {
      notify('error', 'archive 路径不能为空。');
      return;
    }

    setRunningAction('import-profile');
    try {
      const request: ProfileImportRequest = {
        archive,
        importName: importName.trim() || null,
      };
      const result = await api.importProfile(request);
      setLastCommand(result);
      const preferredProfile = importName.trim() || undefined;
      await refreshProfiles(preferredProfile);
      if (preferredProfile) {
        setSelectedName(preferredProfile);
      }
      setImportArchive('');
      setImportName('');
      notify(result.success ? 'success' : 'error', 'profile 导入命令已执行。');
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setRunningAction(null);
    }
  }

  async function deleteProfile() {
    if (!selectedProfile || selectedProfile.isDefault) {
      notify('error', 'default profile 不支持删除。');
      return;
    }
    if (deleteConfirm.trim() !== selectedProfile.name) {
      notify('error', '请先输入完整的 profile 名称完成确认。');
      return;
    }

    setRunningAction('delete-profile');
    try {
      const request: ProfileDeleteRequest = {
        profileName: selectedProfile.name,
        confirmName: deleteConfirm.trim(),
      };
      const result = await api.deleteProfile(request);
      setLastCommand(result);
      await refreshProfiles(profiles?.activeProfile ?? 'default');
      setDeleteConfirm('');
      notify(result.success ? 'success' : 'error', `profile ${request.profileName} 删除命令已执行。`);
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setRunningAction(null);
    }
  }

  async function openInFinder(path: string, label: string, revealInFinder = false) {
    setRunningAction(`open:${label}`);
    try {
      const result = await api.openInFinder({ path, revealInFinder });
      setLastCommand(result);
      notify(
        result.success ? 'success' : 'error',
        result.success ? `${label} 已在 Finder 中打开。` : `${label} 打开失败，请检查命令输出。`,
      );
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setRunningAction(null);
    }
  }

  return (
    <div className="two-column wide-left">
      <Panel
        title="Profile 管理"
        subtitle="管理 Hermes 的多实例 profile。所有生命周期操作都复用 Hermes 原生命令。"
        aside={
          <Toolbar>
            <Button onClick={() => void refreshProfiles(selectedProfile?.name)}>刷新列表</Button>
          </Toolbar>
        }
      >
        {profileItems.length === 0 ? (
          <EmptyState title="未发现 profile" description="当前还没有可管理的 Hermes profile。" />
        ) : (
          <div className="list-stack">
            {profileItems.map((item) => (
              <button
                key={item.name}
                type="button"
                className={`list-card session-card ${selectedProfile?.name === item.name ? 'selected' : ''}`}
                onClick={() => setSelectedName(item.name)}
              >
                <div className="list-card-title">
                  <strong>{item.name}</strong>
                  <div className="pill-row">
                    {item.isDefault && <Pill>default</Pill>}
                    {item.isActive && <Pill tone="good">active</Pill>}
                  </div>
                </div>
                <p>{item.homePath}</p>
                <div className="meta-line">
                  <span>{item.modelDefault || '未配置模型'}</span>
                  <span>{item.gatewayState || 'gateway unknown'}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </Panel>

      <div className="page-stack">
        <Panel
          title="Profile 详情"
          subtitle={selectedProfile?.homePath}
          aside={
            selectedProfile ? (
              <Toolbar>
                <Button
                  disabled={runningAction !== null}
                  onClick={() => void openInFinder(selectedProfile.homePath, `${selectedProfile.name} 目录`)}
                >
                  打开目录
                </Button>
                <Button
                  disabled={runningAction !== null || !selectedProfile.aliasPath}
                  onClick={() => selectedProfile.aliasPath && void openInFinder(selectedProfile.aliasPath, `${selectedProfile.name} Alias`, true)}
                >
                  定位 Alias
                </Button>
                <Button
                  kind="primary"
                  disabled={selectedProfile.isActive || runningAction !== null}
                  onClick={() => void activateProfile(selectedProfile.name)}
                >
                  {runningAction === `activate:${selectedProfile.name}` ? '同步中…' : selectedProfile.isActive ? '已是默认' : '设为默认'}
                </Button>
              </Toolbar>
            ) : undefined
          }
        >
          {selectedProfile ? (
            <div className="detail-list">
              <div className="key-value-row"><span>名称</span><strong>{selectedProfile.name}</strong></div>
              <div className="key-value-row"><span>默认实例</span><strong>{String(selectedProfile.isDefault)}</strong></div>
              <div className="key-value-row"><span>当前活跃</span><strong>{String(selectedProfile.isActive)}</strong></div>
              <div className="key-value-row"><span>模型</span><strong>{selectedProfile.modelDefault || '—'}</strong></div>
              <div className="key-value-row"><span>Gateway</span><strong>{selectedProfile.gatewayState || '—'}</strong></div>
              <div className="key-value-row"><span>会话数</span><strong>{selectedProfile.sessionCount}</strong></div>
              <div className="key-value-row"><span>技能数</span><strong>{selectedProfile.skillCount}</strong></div>
              <div className="key-value-row"><span>.env</span><strong>{selectedProfile.envExists ? 'exists' : 'missing'}</strong></div>
              <div className="key-value-row"><span>SOUL.md</span><strong>{selectedProfile.soulExists ? 'exists' : 'missing'}</strong></div>
              <div className="key-value-row"><span>Alias</span><strong>{selectedProfile.aliasPath || '—'}</strong></div>
            </div>
          ) : (
            <EmptyState title="未选择 profile" description="从左侧选择一个 Hermes profile 查看详情。" />
          )}
        </Panel>

        <Panel
          title="创建 Profile"
          className="panel-nested"
          aside={
            <Toolbar>
              <Button kind="primary" onClick={() => void createProfile()} disabled={runningAction !== null}>
                {runningAction === 'create-profile' ? '创建中…' : '创建'}
              </Button>
            </Toolbar>
          }
        >
          <div className="form-grid">
            <label className="field-stack">
              <span>Profile 名称</span>
              <input
                className="search-input"
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                placeholder="ops / research / coding"
              />
            </label>

            <label className="field-stack">
              <span>创建模式</span>
              <select
                className="select-input"
                value={createMode}
                onChange={(event) => setCreateMode(event.target.value as CreateMode)}
              >
                <option value="fresh">空白新建</option>
                <option value="clone">克隆配置</option>
                <option value="clone-all">完整克隆</option>
              </select>
            </label>

            <label className="field-stack">
              <span>克隆来源</span>
              <select
                className="select-input"
                value={cloneFrom}
                onChange={(event) => setCloneFrom(event.target.value)}
                disabled={createMode === 'fresh'}
              >
                {profileItems.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="field-stack">
              <span>Alias 策略</span>
              <div className="checkbox-row single">
                <label>
                  <input
                    type="checkbox"
                    checked={noAlias}
                    onChange={(event) => setNoAlias(event.target.checked)}
                  />
                  <span>跳过 wrapper alias 创建</span>
                </label>
              </div>
            </label>
          </div>

          <p className="helper-text">
            `克隆配置` 对齐 `hermes profile create --clone`，`完整克隆` 对齐 `--clone-all`。
          </p>
        </Panel>

        <div className="two-column profile-actions-grid">
          <Panel
            title="重命名 Profile"
            className="panel-nested"
            aside={
              <Toolbar>
                <Button
                  onClick={() => void renameProfile()}
                  disabled={!selectedProfile || selectedProfile.isDefault || runningAction !== null}
                >
                  {runningAction === 'rename-profile' ? '重命名中…' : '重命名'}
                </Button>
              </Toolbar>
            }
          >
            <label className="field-stack">
              <span>新名称</span>
              <input
                className="search-input"
                value={renameTo}
                onChange={(event) => setRenameTo(event.target.value)}
                disabled={!selectedProfile || selectedProfile.isDefault}
                placeholder="新的 profile 名称"
              />
            </label>
            {selectedProfile?.isDefault && (
              <p className="helper-text">`default` 是 Hermes 保留实例，不能重命名。</p>
            )}
          </Panel>

          <Panel
            title="导出 Profile"
            className="panel-nested"
            aside={
              <Toolbar>
                <Button
                  onClick={() => void exportProfile()}
                  disabled={!selectedProfile || runningAction !== null}
                >
                  {runningAction === 'export-profile' ? '导出中…' : '导出'}
                </Button>
              </Toolbar>
            }
          >
            <label className="field-stack">
              <span>输出路径</span>
              <input
                className="search-input"
                value={exportOutput}
                onChange={(event) => setExportOutput(event.target.value)}
                placeholder="ops-backup.tar.gz"
              />
            </label>
            <p className="helper-text">留空则交给 Hermes 使用默认 `&lt;name&gt;.tar.gz`。</p>
          </Panel>
        </div>

        <Panel
          title="导入 Profile"
          className="panel-nested"
          aside={
            <Toolbar>
              <Button
                kind="primary"
                onClick={() => void importProfile()}
                disabled={runningAction !== null}
              >
                {runningAction === 'import-profile' ? '导入中…' : '导入'}
              </Button>
            </Toolbar>
          }
        >
          <div className="form-grid">
            <label className="field-stack">
              <span>Archive 路径</span>
              <input
                className="search-input"
                value={importArchive}
                onChange={(event) => setImportArchive(event.target.value)}
                placeholder="/Users/you/backups/ops.tar.gz"
              />
            </label>

            <label className="field-stack">
              <span>导入名称</span>
              <input
                className="search-input"
                value={importName}
                onChange={(event) => setImportName(event.target.value)}
                placeholder="留空则由 Hermes 自动推断"
              />
            </label>
          </div>
        </Panel>

        <Panel
          title="危险区"
          className="panel-nested panel-danger"
          aside={
            <Toolbar>
              <Button
                kind="danger"
                onClick={() => void deleteProfile()}
                disabled={
                  !selectedProfile
                  || selectedProfile.isDefault
                  || deleteConfirm.trim() !== selectedProfile.name
                  || runningAction !== null
                }
              >
                {runningAction === 'delete-profile' ? '删除中…' : '删除 Profile'}
              </Button>
            </Toolbar>
          }
        >
          {selectedProfile ? (
            <>
              <div className="danger-copy">
                <strong>⚠️ 危险操作检测！</strong>
                <p>操作类型：删除 Hermes profile</p>
                <p>影响范围：{selectedProfile.homePath}</p>
                <p>风险评估：会删除该 profile 目录及其会话、技能、配置、记忆和运行状态。</p>
              </div>
              <label className="field-stack">
                <span>请输入 `{selectedProfile.name}` 以确认删除</span>
                <input
                  className="search-input"
                  value={deleteConfirm}
                  onChange={(event) => setDeleteConfirm(event.target.value)}
                  disabled={selectedProfile.isDefault}
                  placeholder={selectedProfile.name}
                />
              </label>
              {selectedProfile.isDefault && (
                <p className="helper-text">`default` 是 Hermes 的保留 profile，客户端不允许删除。</p>
              )}
            </>
          ) : (
            <EmptyState title="未选择 profile" description="选择一个非 default profile 后才能进入删除确认。" />
          )}
        </Panel>

        <Panel title="命令输出" className="panel-nested">
          {lastCommand ? (
            <>
              <div className="detail-list compact">
                <div className="key-value-row"><span>命令</span><strong>{lastCommand.command}</strong></div>
                <div className="key-value-row"><span>退出码</span><strong>{lastCommand.exitCode}</strong></div>
                <div className="key-value-row"><span>结果</span><strong>{String(lastCommand.success)}</strong></div>
              </div>
              <pre className="code-block">{lastCommand.stdout || lastCommand.stderr || '无输出'}</pre>
            </>
          ) : (
            <EmptyState title="尚未执行命令" description="这里会显示 profile create / rename / export / import / delete 的 Hermes CLI 输出。" />
          )}
        </Panel>
      </div>
    </div>
  );
}
