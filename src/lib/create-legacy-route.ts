import React from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { consumePageIntent, getPageIntent, getPanelState, loadProfiles, navigate, notify, subscribePanelState } from './panel-state';
import type { AppPageKey, PageProps } from '../pages/types';

export function createLegacyRoute(
  Component: React.ComponentType<PageProps>,
  pageKey: AppPageKey,
) {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;
  let unsubscribe: (() => void) | null = null;

  function renderComponent() {
    if (!root) {
      return;
    }

    const shell = getPanelState();
    root.render(
      React.createElement(Component, {
        consumePageIntent,
        navigate,
        notify,
        pageIntent: getPageIntent(pageKey),
        profile: shell.selectedProfile,
        profiles: shell.profiles,
        refreshProfiles: async (preferredProfile) => {
          await loadProfiles(preferredProfile);
        },
        key: `${pageKey}:${shell.selectedProfile}`,
      }),
    );
  }

  return async () => ({
    async render() {
      host = document.createElement('div');
      host.className = 'page-host';
      root = createRoot(host);
      unsubscribe = subscribePanelState(() => {
        renderComponent();
      });
      renderComponent();
      return host;
    },
    cleanup() {
      unsubscribe?.();
      unsubscribe = null;
      root?.unmount();
      root = null;
      host = null;
    },
  });
}
