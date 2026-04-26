import { Router, Route } from 'preact-router';
import { Dashboard } from './routes/dashboard.js';
import { Drives } from './routes/drives.js';
import { Scans } from './routes/scans.js';
import { Browse } from './routes/browse.js';
import { Sidebar } from './components/sidebar.js';

export function App() {
  return (
    <div class="layout">
      <Sidebar />
      <main class="main">
        <Router>
          <Route path="/" component={Dashboard} />
          <Route path="/drives" component={Drives} />
          <Route path="/scans" component={Scans} />
          <Route path="/browse" component={Browse} />
        </Router>
      </main>
    </div>
  );
}
