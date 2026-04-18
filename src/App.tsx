/**
 * HermesPanel 主应用
 *
 * - Welcome → EnvCheck → Dashboard 流程
 * - Zustand 状态管理
 * - MainLayout 侧边栏布局
 */

import { useEffect } from 'react';
import { useAppStore, useDashboardStore, AppPageKey } from './stores';
import { MainLayout } from './components/shared';
import {
  WelcomePage,
  EnvCheckPage,
  DashboardPage,
  ChatPage,
  SkillsPage,
  SessionsPage,
  ConfigPage,
  GatewayPage,
  ProfilesPage,
  ExtensionsPage,
  MemoryPage,
  CronPage,
  LogsPage,
  DiagnosticsPage,
} from './pages';

// 页面组件映射（不包括 Welcome 和 EnvCheck，它们是特殊流程页面）
const PAGE_COMPONENTS: Partial<Record<AppPageKey, React.FC>> = {
  dashboard: DashboardPage,
  chat: ChatPage,
  skills: SkillsPage,
  sessions: SessionsPage,
  config: ConfigPage,
  gateway: GatewayPage,
  profiles: ProfilesPage,
  extensions: ExtensionsPage,
  memory: MemoryPage,
  cron: CronPage,
  logs: LogsPage,
  diagnostics: DiagnosticsPage,
};

// 页面路由组件
function PageRoute() {
  const activePage = useAppStore(state => state.activePage);
  const PageComponent = PAGE_COMPONENTS[activePage];

  if (PageComponent) {
    return <PageComponent />;
  }

  // 未知页面，返回 Dashboard
  return <DashboardPage />;
}

export default function App() {
  const { welcomeConfirmed, envChecked, setWelcomeConfirmed, setEnvChecked, setPage } =
    useAppStore();
  const { loadAll } = useDashboardStore();

  // 初始化加载
  useEffect(() => {
    // 检查是否有存储的状态
    if (welcomeConfirmed && envChecked) {
      loadAll();
      setPage('dashboard');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Welcome 页面流程
  if (!welcomeConfirmed) {
    return (
      <div className="app-root">
        <WelcomePage onConfirm={() => setWelcomeConfirmed(true)} />
      </div>
    );
  }

  // EnvCheck 页面流程
  if (!envChecked) {
    return (
      <div className="app-root">
        <EnvCheckPage
          onComplete={() => {
            setEnvChecked(true);
            loadAll();
            setPage('dashboard');
          }}
        />
      </div>
    );
  }

  // 正常布局 - MainLayout + 页面路由
  return (
    <div className="app-root">
      <MainLayout>
        <PageRoute />
      </MainLayout>
    </div>
  );
}
