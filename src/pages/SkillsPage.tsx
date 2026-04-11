import { useEffect, useState } from 'react';

import { api } from '../lib/api';
import { truncate } from '../lib/format';
import type { SkillItem } from '../types';
import { EmptyState, LoadingState, Panel, Pill, Toolbar, Button } from '../components/ui';
import type { PageProps } from './types';

export function SkillsPage({ notify, profile }: PageProps) {
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const next = await api.listSkills(profile);
      setSkills(next);
    } catch (reason) {
      notify('error', String(reason));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [profile]);

  const filtered = skills.filter((skill) => {
    const term = query.trim().toLowerCase();
    if (!term) return true;
    return [skill.name, skill.description, skill.category, skill.relativePath]
      .join(' ')
      .toLowerCase()
      .includes(term);
  });

  if (loading) {
    return <LoadingState label="正在扫描技能目录。" />;
  }

  return (
    <Panel
      title="技能目录"
      subtitle="扫描 `~/.hermes/skills/**/SKILL.md`，用来理解当前 Hermes 的可用能力面。"
      aside={
        <Toolbar>
          <input
            className="search-input"
            placeholder="搜索技能名、分类、描述"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button onClick={() => void load()}>刷新</Button>
        </Toolbar>
      }
    >
      {filtered.length === 0 ? (
        <EmptyState title="未发现技能" description="如果技能目录为空，这里会保持空白。" />
      ) : (
        <div className="skill-grid">
          {filtered.map((skill) => (
            <article className="skill-card" key={skill.filePath}>
              <div className="list-card-title">
                <strong>{skill.name}</strong>
                <Pill>{skill.category}</Pill>
              </div>
              <p>{skill.description || '无描述'}</p>
              <p className="skill-preview">{truncate(skill.preview || '无预览', 100)}</p>
              <div className="meta-line">
                <span>{skill.relativePath}</span>
              </div>
            </article>
          ))}
        </div>
      )}
    </Panel>
  );
}
