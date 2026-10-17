import { Empty, PageHead } from '../components/ui';

export default function RunPagePage(_props: { tab?: string }) {
  return (
    <>
      <PageHead title="Execução" />
      <div className="card"><Empty icon="layers" title="Em construção">Esta tela entra na próxima fase do redesign.</Empty></div>
    </>
  );
}
