import { useEffect, useState } from 'react';

import { api } from '../lib/api';
import type { ConfigDocuments } from '../types';
import { Button, KeyValueRow, LoadingState, Panel, Toolbar } from '../components/ui';
import type { PageProps } from './types';

export function ConfigPage({ notify, profile }: PageProps) {
  const [data, setData] = useState<ConfigDocuments | null>(null);
  const [configYaml, setConfigYaml] = useState('');
  const [envFile, setEnvFile] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<'config' | 'env' | null>(null);

  async function load() {
    setLoading(true);
    try {
      const next = await api.getConfigDocuments(profile);
      setData(next);
      setConfigYaml(next.configYaml);
      setEnvFile(next.envFile);
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setLoading(false);
    }
  }

  async function saveConfig() {
    setSaving('config');
    try {
      await api.saveConfigYaml(configYaml, profile);
      notify('success', 'config.yaml 已保存。');
      await load();
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setSaving(null);
    }
  }

  async function saveEnv() {
    setSaving('env');
    try {
      await api.saveEnvFile(envFile, profile);
      notify('success', '.env 已保存。');
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setSaving(null);
    }
  }

  useEffect(() => {
    void load();
  }, [profile]);

  if (loading || !data) {
    return <LoadingState label="正在读取配置文件。" />;
  }

  return (
    <div className="page-stack">
      <Panel
        title="配置中心"
        subtitle="直接管理 `config.yaml` 与 `.env`，不改 Hermes 内部结构。"
        aside={
          <Toolbar>
            <Button onClick={() => void load()}>重新读取</Button>
          </Toolbar>
        }
      >
        <div className="two-column">
          <div className="detail-list">
            <KeyValueRow label="Hermes Home" value={data.hermesHome} />
            <KeyValueRow label="Config Path" value={data.configPath} />
            <KeyValueRow label="Env Path" value={data.envPath} />
            <KeyValueRow label="默认模型" value={data.summary.modelDefault} />
            <KeyValueRow label="提供商" value={data.summary.modelProvider} />
            <KeyValueRow label="终端后端" value={data.summary.terminalBackend} />
            <KeyValueRow label="人格" value={data.summary.personality} />
          </div>
          <div className="detail-list">
            <KeyValueRow label="Base URL" value={data.summary.modelBaseUrl || '—'} />
            <KeyValueRow label="工作目录" value={data.summary.terminalCwd || '—'} />
            <KeyValueRow
              label="Toolsets"
              value={data.summary.toolsets.length ? data.summary.toolsets.join(', ') : '—'}
            />
            <KeyValueRow label="记忆功能" value={String(data.summary.memoryEnabled ?? false)} />
            <KeyValueRow label="流式输出" value={String(data.summary.streamingEnabled ?? false)} />
          </div>
        </div>
      </Panel>

      <div className="two-column">
        <Panel
          title="config.yaml"
          aside={
            <Toolbar>
              <Button kind="primary" onClick={() => void saveConfig()} disabled={saving !== null}>
                {saving === 'config' ? '保存中…' : '保存 YAML'}
              </Button>
            </Toolbar>
          }
        >
          <textarea
            className="editor"
            value={configYaml}
            onChange={(event) => setConfigYaml(event.target.value)}
            spellCheck={false}
          />
        </Panel>

        <Panel
          title=".env"
          aside={
            <Toolbar>
              <Button kind="primary" onClick={() => void saveEnv()} disabled={saving !== null}>
                {saving === 'env' ? '保存中…' : '保存 ENV'}
              </Button>
            </Toolbar>
          }
        >
          <textarea
            className="editor"
            value={envFile}
            onChange={(event) => setEnvFile(event.target.value)}
            spellCheck={false}
          />
        </Panel>
      </div>
    </div>
  );
}
