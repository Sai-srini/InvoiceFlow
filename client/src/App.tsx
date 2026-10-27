import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Landing from './pages/Landing';
import AcceptInvite from './pages/AcceptInvite';
import Dashboard from './pages/Dashboard';
import Approvals from './pages/Approvals';
import { InvoiceList, InvoiceNew, InvoiceDetail } from './pages/Invoices';
import Intake from './pages/Intake';
import Vendors from './pages/Vendors';
import { RunList, RunDetail } from './pages/PaymentRuns';
import Reconciliation from './pages/Reconciliation';
import Reports from './pages/Reports';
import UsersRoles from './pages/UsersRoles';
import ApprovalRules from './pages/ApprovalRules';
import Settings from './pages/Settings';
import AuditLog from './pages/AuditLog';
import { Spinner } from './components/ui';

function Guard({ any, children }: { any?: string[]; children: JSX.Element }) {
  const { canAny } = useAuth();
  if (any && !canAny(...any)) return <div className="page"><div className="alert error">You do not have access to this page.</div></div>;
  return children;
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  return (
    <Routes>
      <Route path="/accept-invite" element={<AcceptInvite />} />
      {!user ? <><Route path="/" element={<Landing />} /><Route path="/login" element={<Login />} /><Route path="*" element={<Navigate to="/login" replace />} /></> : (
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/approvals" element={<Guard any={['invoice.approve', 'invoice.reject', 'invoice.hold']}><Approvals /></Guard>} />
          <Route path="/invoices" element={<InvoiceList />} />
          <Route path="/invoices/new" element={<InvoiceNew />} />
          <Route path="/invoices/:id" element={<InvoiceDetail />} />
          <Route path="/intake" element={<Guard any={['invoice.upload', 'invoice.review_extraction']}><Intake /></Guard>} />
          <Route path="/vendors" element={<Guard any={['vendor.view']}><Vendors /></Guard>} />
          <Route path="/payment-runs" element={<Guard any={['payment.view']}><RunList /></Guard>} />
          <Route path="/payment-runs/:id" element={<Guard any={['payment.view']}><RunDetail /></Guard>} />
          <Route path="/reconciliation" element={<Guard any={['bank.view']}><Reconciliation /></Guard>} />
          <Route path="/reports" element={<Guard any={['report.view_own', 'report.view_ops', 'report.view_all']}><Reports /></Guard>} />
          <Route path="/approval-rules" element={<Guard any={['rules.manage']}><ApprovalRules /></Guard>} />
          <Route path="/users" element={<Guard any={['user.manage', 'role.manage']}><UsersRoles /></Guard>} />
          <Route path="/settings" element={<Guard any={['org.settings', 'tax.configure', 'bank.configure']}><Settings /></Guard>} />
          <Route path="/audit" element={<Guard any={['audit.view']}><AuditLog /></Guard>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      )}
    </Routes>
  );
}
