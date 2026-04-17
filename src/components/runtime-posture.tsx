import type { ReactNode } from 'react';

import type { RuntimePostureSnapshot, RuntimePostureTargetPage } from '../lib/posture';
import { Button, EmptyState, Pill, Toolbar } from './ui';
import type { AppPageKey } from '../pages/types';

function pageLabel(page: RuntimePostureTargetPage) {
  switch (page) {
    case 'config':
      return '配置页';
    case 'gateway':
      return '网关页';
    case 'extensions':
      return '扩展页';
    case 'memory':
      return '记忆页';
    case 'sessions':
      return '会话页';
    case 'diagnostics':
      return '诊断页';
    case 'logs':
      return '日志页';
    case 'dashboard':
    default:
      return '总览页';
  }
}

function toneLabel(tone: RuntimePostureSnapshot['tone']) {
  switch (tone) {
    case 'bad':
      return '高风险';
    case 'warn':
      return '关注';
    case 'neutral':
      return '观察';
    case 'good':
    default:
      return '稳定';
  }
}

function buttonKind(tone: RuntimePostureSnapshot['tone']): 'primary' | 'secondary' | 'danger' {
  if (tone === 'bad') {
    return 'danger';
  }
  if (tone === 'good') {
    return 'primary';
  }
  return 'secondary';
}

export function RuntimePostureView(props: {
  posture: RuntimePostureSnapshot;
  navigate: (page: AppPageKey) => void;
  extraAside?: ReactNode;
}) {
  return (
    <div className="page-stack">
      <div className="result-header">
        <div>
          <p className="eyebrow">Runtime Posture</p>
          <h3 className="action-card-title">{props.posture.headline}</h3>
        </div>
        <Pill tone={props.posture.tone}>{toneLabel(props.posture.tone)}</Pill>
      </div>
      <p className="helper-text">{props.posture.summary}</p>
      {props.extraAside}
      <div className="health-grid">
        {props.posture.items.map(item => {
          const targetPage = item.page;

          return (
            <section className="health-card" key={item.key}>
              <div className="health-card-header">
                <strong>{item.title}</strong>
                <Pill tone={item.tone}>{item.summary}</Pill>
              </div>
              <p>{item.detail}</p>
              {targetPage ? (
                <Toolbar>
                  <Button kind={buttonKind(item.tone)} onClick={() => props.navigate(targetPage)}>
                    {item.actionLabel ?? `进入${pageLabel(targetPage)}`}
                  </Button>
                </Toolbar>
              ) : null}
            </section>
          );
        })}
      </div>
      {props.posture.priorities.length > 0 ? (
        <div className="warning-stack">
          {props.posture.priorities.slice(0, 4).map(item => (
            <div className="warning-item" key={`priority:${item.key}`}>
              {item.title}：{item.detail}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          title="当前无需优先修正"
          description="核心运行链路已具备继续验证与细化治理的基础。"
        />
      )}
    </div>
  );
}
