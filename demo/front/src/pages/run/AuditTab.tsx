import type { Run } from '../../api/agent';
import { Empty } from '../../components/ui';

export default function AuditTab(_props: { run: Run }) {
  return <div className="card"><Empty icon="layers" title="Em construção">Esta aba entra na próxima fase.</Empty></div>;
}
