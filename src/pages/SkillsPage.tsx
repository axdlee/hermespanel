import { useEffect, useMemo, useState } from 'react';

import { api } from '../lib/api';
import { handoffToTerminal, openFinderLocation } from '../lib/desktop';
import { formatTimestamp, truncate } from '../lib/format';
import type { CommandRunResult, CronJobsSnapshot, DashboardSnapshot, ExtensionsSnapshot, InstallationSnapshot, SkillItem } from '../types';
import { Button, EmptyState, InfoTip, KeyValueRow, LoadingState, MetricCard, Panel, Pill, Toolbar } from '../components/ui';
import type { PageProps } from './types';

function directoryOf(path: string) {
  const normalized = path.trim();
  const index = normalized.lastIndexOf('/');
  return index > 0 ? normalized.slice(0, index) : normalized;
}

export function SkillsPage({ notify, profile, navigate }: PageProps) {
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [installation, setInstallation] = useState<InstallationSnapshot | null>(null);
  const [extensions, setExtensions] = useState<ExtensionsSnapshot | null>(null);
  const [cronSnapshot, setCronSnapshot] = useState<CronJobsSnapshot | null>(null);
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [registryQuery, setRegistryQuery] = useState('');
  const [installTarget, setInstallTarget] = useState('');
  const [runningDesktopAction, setRunningDesktopAction] = useState<string | null>(null);
  const [lastCommandLabel, setLastCommandLabel] = useState<string | null>(null);
  const [lastCommand, setLastCommand] = useState<CommandRunResult | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [nextSkills, nextSnapshot, nextInstallation, nextExtensions, nextCron] = await Promise.all([
        api.listSkills(profile),
        api.getDashboardSnapshot(profile),
        api.getInstallationSnapshot(profile),
        api.getExtensionsSnapshot(profile),
        api.getCronJobs(profile),
      ]);
      setSkills(nextSkills);
      setSnapshot(nextSnapshot);
      setInstallation(nextInstallation);
      setExtensions(nextExtensions);
      setCronSnapshot(nextCron);

      setSelectedPath((current) => {
        if (current && nextSkills.some((item) => item.filePath === current)) {
          return current;
        }
        return nextSkills[0]?.filePath ?? null;
      });
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setLoading(false);
    }
  }

  async function openInFinder(path: string, label: string, revealInFinder = false) {
    await openFinderLocation({
      actionKey: `skills:finder:${label}`,
      label,
      notify,
      onResult: (resultLabel, result) => {
        setLastCommandLabel(resultLabel);
        setLastCommand(result);
      },
      path,
      revealInFinder,
      setBusy: setRunningDesktopAction,
    });
  }

  async function openInTerminal(actionKey: string, label: string, command: string, confirmMessage?: string) {
    await handoffToTerminal({
      actionKey,
      command,
      confirmMessage,
      label,
      notify,
      onResult: (resultLabel, result) => {
        setLastCommandLabel(resultLabel);
        setLastCommand(result);
      },
      profile,
      setBusy: setRunningDesktopAction,
      workingDirectory: installation?.hermesHomeExists ? installation.hermesHome : null,
    });
  }

  useEffect(() => {
    setLastCommand(null);
    setLastCommandLabel(null);
    void load();
  }, [profile]);

  const categories = useMemo(
    () => ['all', ...Array.from(new Set(skills.map((skill) => skill.category).filter(Boolean))).sort()],
    [skills],
  );

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return skills.filter((skill) => {
      if (categoryFilter !== 'all' && skill.category !== categoryFilter) {
        return false;
      }
      if (!term) {
        return true;
      }
      return [skill.name, skill.description, skill.category, skill.relativePath, skill.preview]
        .join(' ')
        .toLowerCase()
        .includes(term);
    });
  }, [categoryFilter, query, skills]);

  const selectedSkill = useMemo(
    () => filtered.find((skill) => skill.filePath === selectedPath)
      ?? skills.find((skill) => skill.filePath === selectedPath)
      ?? filtered[0]
      ?? skills[0]
      ?? null,
    [filtered, selectedPath, skills],
  );

  const jobs = cronSnapshot?.jobs ?? [];
  const skillUsageJobs = selectedSkill
    ? jobs.filter((job) => job.skills.includes(selectedSkill.name))
    : [];
  const usedSkillNames = new Set(jobs.flatMap((job) => job.skills));
  const uniqueCategories = new Set(skills.map((skill) => skill.category)).size;
  const currentToolsets = snapshot?.config.toolsets ?? [];
  const runtimeLocalSkills = extensions?.skillSourceCounts.find((item) => item.name === 'local')?.count ?? 0;
  const capabilityWarnings: string[] = [];

  if (!skills.length) {
    capabilityWarnings.push('当前 profile 下没有扫描到任何技能，很多 agent 能力会退化到纯基础工具。');
  }
  if (!currentToolsets.length) {
    capabilityWarnings.push('当前没有配置任何 toolsets，说明模型可见工具面可能非常窄。');
  }
  if (snapshot?.config.memoryEnabled === false) {
    capabilityWarnings.push('记忆功能当前关闭，skills 很难和长期记忆形成闭环。');
  }
  if (snapshot?.gateway?.gatewayState !== 'running' && jobs.some((job) => job.deliver !== 'local' && job.deliver !== 'origin')) {
    capabilityWarnings.push('存在远端投递作业，但 gateway 当前未运行，技能的消息平台调用链还没法真实验证。');
  }
  if (selectedSkill && skillUsageJobs.length === 0 && jobs.length > 0) {
    capabilityWarnings.push(`当前选中的 skill「${selectedSkill.name}」还没有被任何 cron 作业显式引用。`);
  }
  if (extensions && runtimeLocalSkills !== skills.length) {
    capabilityWarnings.push(`CLI 运行态 local skills 为 ${runtimeLocalSkills} 个，本地目录扫描为 ${skills.length} 个，说明技能安装态与文件态存在偏差。`);
  }

  if (loading || !installation) {
    return <LoadingState label="正在扫描 Hermes 技能目录。" />;
  }

  return (
    <div className="page-stack">
      <Panel
        title="技能工作台"
        subtitle="扫描、安装、运行态"
        tip={(
          <InfoTip content="技能页只保留技能相关闭环：扫描、安装、运行态和目录物料。跨页导航交给左侧主导航，不再在页内重复摆一圈入口。"/>
        )}
        aside={(
          <Toolbar>
            <Button onClick={() => void load()}>刷新</Button>
          </Toolbar>
        )}
      >
        <div className="compact-overview-grid">
          <div className="shell-card">
            <div className="shell-card-header">
              <strong>运行摘要</strong>
              <div className="pill-row">
                <Pill tone={snapshot?.config.memoryEnabled ? 'good' : 'warn'}>
                  {snapshot?.config.memoryEnabled ? 'Memory On' : 'Memory Off'}
                </Pill>
                <Pill tone={snapshot?.gateway?.gatewayState === 'running' ? 'good' : 'warn'}>
                  {snapshot?.gateway?.gatewayState ?? 'Gateway ?'}
                </Pill>
              </div>
            </div>
            <div className="detail-list compact">
              <KeyValueRow label="当前 Profile" value={profile} />
              <KeyValueRow label="终端后端" value={snapshot?.config.terminalBackend ?? '—'} />
              <KeyValueRow label="默认模型" value={snapshot?.config.modelDefault ?? '—'} />
              <KeyValueRow label="提供商" value={snapshot?.config.modelProvider ?? '—'} />
              <KeyValueRow label="Toolsets" value={currentToolsets.length ? currentToolsets.join(', ') : '—'} />
            </div>
          </div>
          <div className="metrics-grid">
            <MetricCard label="技能数" value={skills.length} hint="扫描自 ~/.hermes/skills/**/SKILL.md" />
            <MetricCard label="分类数" value={uniqueCategories} hint="按 category 聚合能力簇" />
            <MetricCard label="当前筛后" value={filtered.length} hint="当前查询与分类过滤结果" />
            <MetricCard label="被 Cron 引用" value={usedSkillNames.size} hint="至少被一个作业显式引用的技能数" />
          </div>
        </div>
      </Panel>

      <Panel
        title="技能运营与安装"
        subtitle="参考 ClawPanel 的闭环思路，把 skills 的浏览、搜索、安装、检查、更新和开关都拉进同一页。"
      >
        <div className="control-card-grid">
          <section className="action-card action-card-compact">
            <div className="action-card-header">
              <div>
                <p className="eyebrow">Registry</p>
                <h3 className="action-card-title">技能浏览与治理</h3>
              </div>
              <Pill tone={installation.binaryFound ? 'good' : 'bad'}>
                {installation.binaryFound ? 'CLI 就绪' : 'CLI 缺失'}
              </Pill>
            </div>
            <p className="action-card-copy">
              浏览、检查、更新、安装。
            </p>
            <p className="command-line">
              hermes skills browse · {installation.skillsConfigCommand} · hermes skills check · hermes skills update · hermes skills audit
            </p>
            <Toolbar>
              <Button
                kind="primary"
                onClick={() => void openInTerminal('skills:browse', '技能浏览器', 'hermes skills browse')}
                disabled={runningDesktopAction !== null || !installation.binaryFound}
              >
                {runningDesktopAction === 'skills:browse' ? '技能浏览器…' : '技能浏览器'}
              </Button>
              <Button
                onClick={() => void openInTerminal('skills:config', '技能开关', installation.skillsConfigCommand)}
                disabled={runningDesktopAction !== null || !installation.binaryFound}
              >
                {runningDesktopAction === 'skills:config' ? '技能开关…' : '技能开关'}
              </Button>
              <Button
                onClick={() => void openInTerminal('skills:check', '检查技能更新', 'hermes skills check')}
                disabled={runningDesktopAction !== null || !installation.binaryFound}
              >
                {runningDesktopAction === 'skills:check' ? '检查技能更新…' : '检查技能更新'}
              </Button>
              <Button
                onClick={() => void openInTerminal('skills:update', '更新已安装技能', 'hermes skills update')}
                disabled={runningDesktopAction !== null || !installation.binaryFound}
              >
                {runningDesktopAction === 'skills:update' ? '更新已安装技能…' : '更新已安装技能'}
              </Button>
            </Toolbar>
          </section>

          <section className="action-card action-card-compact">
            <div className="action-card-header">
              <div>
                <p className="eyebrow">Search</p>
                <h3 className="action-card-title">搜索 / 安装 / 预检</h3>
              </div>
              <Pill tone={installTarget.trim() ? 'good' : 'warn'}>
                {installTarget.trim() || '等待输入技能 ID'}
              </Pill>
            </div>
            <div className="form-grid">
              <label className="field-stack">
                <span>搜索关键词</span>
                <input
                  className="search-input"
                  value={registryQuery}
                  onChange={(event) => setRegistryQuery(event.target.value)}
                  placeholder="react / kubernetes / official/security/1password"
                  disabled={runningDesktopAction !== null}
                />
              </label>
              <label className="field-stack">
                <span>安装目标</span>
                <input
                  className="search-input"
                  value={installTarget}
                  onChange={(event) => setInstallTarget(event.target.value)}
                  placeholder="official/security/1password"
                  disabled={runningDesktopAction !== null}
                />
              </label>
            </div>
            <p className="command-line">
              {registryQuery.trim() ? `hermes skills search ${registryQuery.trim()}` : '先输入关键词做 skills search'}
              {' · '}
              {installTarget.trim() ? `hermes skills inspect ${installTarget.trim()} / hermes skills install ${installTarget.trim()}` : '输入技能 ID 后可 inspect / install'}
            </p>
            <Toolbar>
              <Button
                kind="primary"
                onClick={() => void openInTerminal('skills:search', '搜索技能', `hermes skills search ${registryQuery.trim()}`)}
                disabled={runningDesktopAction !== null || !installation.binaryFound || !registryQuery.trim()}
              >
                {runningDesktopAction === 'skills:search' ? '搜索技能…' : '搜索技能'}
              </Button>
              <Button
                onClick={() => void openInTerminal('skills:inspect', '预检技能', `hermes skills inspect ${installTarget.trim()}`)}
                disabled={runningDesktopAction !== null || !installation.binaryFound || !installTarget.trim()}
              >
                {runningDesktopAction === 'skills:inspect' ? '预检技能…' : '预检技能'}
              </Button>
              <Button
                onClick={() => void openInTerminal('skills:install', '安装技能', `hermes skills install ${installTarget.trim()}`)}
                disabled={runningDesktopAction !== null || !installation.binaryFound || !installTarget.trim()}
              >
                {runningDesktopAction === 'skills:install' ? '安装技能…' : '安装技能'}
              </Button>
              <Button
                onClick={() => void openInTerminal('skills:audit', '审计已安装技能', 'hermes skills audit')}
                disabled={runningDesktopAction !== null || !installation.binaryFound}
              >
                {runningDesktopAction === 'skills:audit' ? '审计已安装技能…' : '审计已安装技能'}
              </Button>
            </Toolbar>
          </section>

          <section className="action-card action-card-compact">
            <div className="action-card-header">
              <div>
                <p className="eyebrow">Runtime</p>
                <h3 className="action-card-title">运行能力面联动</h3>
              </div>
              <Pill tone={runtimeLocalSkills === skills.length ? 'good' : 'warn'}>
                {runtimeLocalSkills}/{skills.length}
              </Pill>
            </div>
            <p className="action-card-copy">
              目录态不等于运行态。
            </p>
            <p className="command-line">
              toolsets [{currentToolsets.length ? currentToolsets.join(', ') : '未配置'}] · memory {snapshot?.config.memoryEnabled ? 'on' : 'off'} · gateway {snapshot?.gateway?.gatewayState ?? 'unknown'}
            </p>
            <div className="detail-list compact">
              <KeyValueRow label="运行态 Local" value={runtimeLocalSkills} />
              <KeyValueRow label="目录扫描" value={skills.length} />
              <KeyValueRow label="Cron 作业" value={jobs.length} />
              <KeyValueRow label="已编排技能" value={usedSkillNames.size} />
            </div>
          </section>

          <section className="action-card action-card-compact">
            <div className="action-card-header">
              <div>
                <p className="eyebrow">Workspace</p>
                <h3 className="action-card-title">技能目录与运行物料</h3>
              </div>
              <Pill tone={skills.length > 0 ? 'good' : 'warn'}>
                {skills.length > 0 ? '已扫描' : '空目录'}
              </Pill>
            </div>
            <p className="action-card-copy">
              先定位文件，再决定安装或更新。
            </p>
            <p className="command-line">
              {selectedSkill?.filePath || '先从下方选择一个技能文件'}
            </p>
            <Toolbar>
              <Button
                onClick={() => selectedSkill && void openInFinder(selectedSkill.filePath, `${selectedSkill.name} 技能文件`, true)}
                disabled={runningDesktopAction !== null || !selectedSkill}
              >
                定位技能文件
              </Button>
              <Button
                onClick={() => selectedSkill && void openInFinder(directoryOf(selectedSkill.filePath), `${selectedSkill.name} 技能目录`)}
                disabled={runningDesktopAction !== null || !selectedSkill}
              >
                打开技能目录
              </Button>
              <Button onClick={() => snapshot && void openInFinder(snapshot.hermesHome, 'Hermes Home')} disabled={runningDesktopAction !== null || !snapshot}>
                打开 Home
              </Button>
            </Toolbar>
          </section>
        </div>
      </Panel>

      <div className="two-column wide-left">
        <Panel title="能力状态" subtitle="这里不是安装状态，而是当前 profile 的能力组织方式和自动化接入程度。">
          <div className="health-grid">
            <section className="health-card">
              <div className="health-card-header">
                <strong>Gateway</strong>
                <Pill tone={snapshot?.gateway?.gatewayState === 'running' ? 'good' : 'warn'}>
                  {snapshot?.gateway?.gatewayState ?? '未检测到'}
                </Pill>
              </div>
              <p>技能在消息平台侧是否被真正调用，最终还要看 gateway 运行态和平台连接情况。</p>
            </section>
            <section className="health-card">
              <div className="health-card-header">
                <strong>Memory</strong>
                <Pill tone={snapshot?.config.memoryEnabled ? 'good' : 'warn'}>
                  {snapshot?.config.memoryEnabled ? '已开启' : '已关闭'}
                </Pill>
              </div>
              <p>记忆开启后，skills 更容易和 `SOUL / MEMORY / USER` 形成闭环。</p>
            </section>
            <section className="health-card">
              <div className="health-card-header">
                <strong>Streaming</strong>
                <Pill tone={snapshot?.config.streamingEnabled ? 'good' : 'neutral'}>
                  {snapshot?.config.streamingEnabled ? '已开启' : '未开启'}
                </Pill>
              </div>
              <p>流式输出更利于观察长链工具调用，但不会改变 skills 本身的可用性。</p>
            </section>
            <section className="health-card">
              <div className="health-card-header">
                <strong>Cron Integration</strong>
                <Pill tone={jobs.length > 0 ? 'good' : 'neutral'}>
                  {jobs.length > 0 ? `${jobs.length} 个作业` : '未接入'}
                </Pill>
              </div>
              <p>{usedSkillNames.size} 个技能已经进入自动化作业链路，剩余技能仍停留在“可用但未编排”状态。</p>
            </section>
          </div>
          {capabilityWarnings.length > 0 ? (
            <div className="warning-stack">
              {capabilityWarnings.map((warning) => (
                <div className="warning-item" key={warning}>
                  {warning}
                </div>
              ))}
            </div>
          ) : null}
        </Panel>

        <Panel
          title="筛选器"
          subtitle="按分类和关键词缩小技能面，适合找特定能力或排查某个 toolset 下缺了什么。"
          aside={(
            <Toolbar>
              <input
                className="search-input"
                placeholder="搜索技能名、分类、描述、路径"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <select
                className="select-input"
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
              >
                {categories.map((item) => (
                  <option key={item} value={item}>
                    {item === 'all' ? '全部分类' : item}
                  </option>
                ))}
              </select>
            </Toolbar>
          )}
        >
          <p className="helper-text">
            如果发现技能很多，但当前 `toolsets` 很少，通常意味着“目录里有能力”不等于“模型当前真的能看见这些能力”。如果一个 skill 已被 cron 引用却仍跑不起来，优先回到 Cron 页或诊断页排查。
          </p>
        </Panel>
      </div>

      <div className="two-column wide-left">
        <Panel title="技能列表" subtitle="优先定位当前 profile 真正在用、或者最值得验证的技能。">
          {filtered.length === 0 ? (
            <EmptyState title="未发现技能" description="当前筛选条件下没有匹配技能。" />
          ) : (
            <div className="list-stack">
              {filtered.map((skill) => {
                const referencedByCron = jobs.some((job) => job.skills.includes(skill.name));
                return (
                  <button
                    type="button"
                    className={`list-card session-card ${selectedSkill?.filePath === skill.filePath ? 'selected' : ''}`}
                    key={skill.filePath}
                    onClick={() => setSelectedPath(skill.filePath)}
                  >
                    <div className="list-card-title">
                      <strong>{skill.name}</strong>
                      <div className="pill-row">
                        <Pill>{skill.category}</Pill>
                        {referencedByCron ? <Pill tone="good">Cron 中</Pill> : <Pill tone="neutral">未编排</Pill>}
                      </div>
                    </div>
                    <p>{skill.description || '无描述'}</p>
                    <p className="skill-preview">{truncate(skill.preview || '无预览', 120)}</p>
                    <div className="meta-line">
                      <span>{skill.relativePath}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Panel>

        <Panel
          title="技能详情"
          subtitle="这里把单个 skill 的文件位置、能力说明、运行配置和自动化引用放到一起。"
        >
          {selectedSkill ? (
            <div className="page-stack">
              <div className="detail-list">
                <KeyValueRow label="名称" value={selectedSkill.name} />
                <KeyValueRow label="分类" value={selectedSkill.category} />
                <KeyValueRow label="相对路径" value={selectedSkill.relativePath} />
                <KeyValueRow label="文件路径" value={selectedSkill.filePath} />
                <KeyValueRow label="终端后端" value={snapshot?.config.terminalBackend ?? '—'} />
                <KeyValueRow label="Toolsets" value={currentToolsets.length ? currentToolsets.join(', ') : '—'} />
                <KeyValueRow label="被 Cron 引用" value={skillUsageJobs.length} />
              </div>

              <Panel className="panel-nested" title="描述与预览">
                <p className="helper-text">{selectedSkill.description || '无描述'}</p>
                <pre className="code-block">{selectedSkill.preview || '无预览内容'}</pre>
              </Panel>

              <Panel className="panel-nested" title="自动化引用">
                {skillUsageJobs.length > 0 ? (
                  <div className="list-stack">
                    {skillUsageJobs.map((job) => (
                      <div className="list-card" key={job.id}>
                        <div className="list-card-title">
                          <strong>{job.name}</strong>
                          <div className="pill-row">
                            <Pill tone={job.state === 'scheduled' ? 'good' : job.state === 'paused' ? 'warn' : 'bad'}>
                              {job.state}
                            </Pill>
                            <Pill tone={job.deliver === 'local' || job.deliver === 'origin' ? 'neutral' : 'warn'}>
                              {job.deliver}
                            </Pill>
                          </div>
                        </div>
                        <p>{truncate(job.prompt || '无 prompt', 120)}</p>
                        <div className="meta-line">
                          <span>{job.scheduleDisplay}</span>
                          <span>{formatTimestamp(job.nextRunAt)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="尚未接入自动化" description="这个 skill 当前还没有被任何 cron 作业显式引用。" />
                )}
              </Panel>

              <Toolbar>
                <Button onClick={() => void openInFinder(selectedSkill.filePath, `${selectedSkill.name} 技能文件`, true)}>
                  定位技能文件
                </Button>
                <Button onClick={() => void openInFinder(directoryOf(selectedSkill.filePath), `${selectedSkill.name} 技能目录`)}>
                  打开技能目录
                </Button>
                <Button onClick={() => navigate('cron')}>查看 Cron</Button>
                <Button onClick={() => navigate('diagnostics')}>去做诊断</Button>
              </Toolbar>
            </div>
          ) : (
            <EmptyState title="未选择技能" description="从左侧列表选择一个 skill 查看详情。" />
          )}
        </Panel>
      </div>
    </div>
  );
}
