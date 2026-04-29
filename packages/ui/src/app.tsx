import { useEffect, useState } from 'preact/hooks';
import { Router, Route } from 'preact-router';
import type { DriveRecord, ScanRecord } from '@fileorganizer/shared';
import { Sidebar } from './components/sidebar.js';
import { TopBar } from './components/topbar.js';
import { defaultApiClient } from './api/client.js';
import { Dashboard } from './routes/dashboard.js';
import { Drives } from './routes/drives.js';
import { Scans } from './routes/scans.js';
import { Browse } from './routes/browse.js';
import { Duplicates } from './routes/duplicates.js';
import { Organize } from './routes/organize.js';
import { Roles } from './routes/roles.js';
import { Throttle } from './routes/throttle.js';
import { History } from './routes/history.js';
import { Cleanup } from './routes/cleanup.js';
import { Quarantine } from './routes/quarantine.js';
import { useKeyboardShortcuts, defaultShortcuts } from './hooks/use-keyboard.js';

function pathToSection(path: string): string {
  const seg = path.replace(/^\//, '').split('/')[0] || 'dashboard';
  return seg;
}

export function App() {
  useKeyboardShortcuts(defaultShortcuts());
  const api = defaultApiClient();
  const [section, setSection] = useState<string>(pathToSection(window.location.pathname));
  const [drives, setDrives] = useState<DriveRecord[]>([]);
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [ruleCount, setRuleCount] = useState<number>(0);
  const [roleCount, setRoleCount] = useState<number>(0);

  const reloadGlobal = () => {
    api.listDrives().then(setDrives).catch(() => {});
    api.listScans().then((s) => setScans(s as ScanRecord[])).catch(() => {});
    api.listRules().then((rs) => setRuleCount(rs.length)).catch(() => {});
    api.listRoles().then((rs) => setRoleCount(rs.length)).catch(() => {});
  };

  useEffect(() => {
    reloadGlobal();
    const interval = window.setInterval(reloadGlobal, 3000);
    return () => clearInterval(interval);
  }, []);

  const scanIsLive = scans.some((s) => s.status === 'running');

  return (
    <div class="fo-root">
      <Sidebar
        active={section}
        driveCount={drives.length}
        scanIsLive={scanIsLive}
        ruleCount={ruleCount}
        roleCount={roleCount}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        <TopBar section={section} drives={drives} />
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <Router onChange={(e) => setSection(pathToSection(e.url))}>
            <Route path="/" component={Dashboard} />
            <Route path="/drives" component={Drives} />
            <Route path="/scans" component={Scans} />
            <Route path="/browse" component={Browse} />
            <Route path="/duplicates" component={Duplicates} />
            <Route path="/organize" component={Organize} />
            <Route path="/roles" component={Roles} />
            <Route path="/throttle" component={Throttle} />
            <Route path="/history" component={History} />
            <Route path="/cleanup" component={Cleanup} />
            <Route path="/quarantine" component={Quarantine} />
          </Router>
        </div>
      </div>
    </div>
  );
}
